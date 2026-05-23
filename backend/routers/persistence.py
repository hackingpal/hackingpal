"""Persistence audit — scan auto-start locations on macOS or Linux.

REST: GET /persistence/audit  → structured report of every persistence entry,
each enriched with target-binary integrity (codesign on macOS, package
provenance on Linux).

The response shape is the same on both platforms; the `sign_status` field uses
the same vocabulary (apple / developer-id / unsigned / invalid / missing) so
the frontend renders identically.
"""
from __future__ import annotations

import configparser
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from lib import forensics

router = APIRouter(tags=["forensics"])

IS_DARWIN = sys.platform == "darwin"


# ── Mac persistence locations ─────────────────────────────────────────────────
# We skip /System/Library/* — those are Apple-managed and would be overwhelming.
MAC_PERSISTENCE_LOCATIONS: list[tuple[str, Path]] = [
    ("User LaunchAgents",   Path.home() / "Library" / "LaunchAgents"),
    ("Global LaunchAgents", Path("/Library/LaunchAgents")),
    ("LaunchDaemons",       Path("/Library/LaunchDaemons")),
    ("StartupItems",        Path("/Library/StartupItems")),
]


class PersistenceEntry(BaseModel):
    source: str            # category label (e.g. "LaunchDaemons" or "Systemd System")
    plist: str             # path to the source file (kept name for FE compat)
    label: str             # unit name / launchd Label
    program: str           # resolved executable path
    run_at_load: bool      # autostarts on boot/login
    keep_alive: bool       # auto-restarts on exit
    start_interval: int | None = None
    sign_status: str       # apple / developer-id / ad-hoc / unsigned / invalid / missing
    sign_team: str = ""    # codesign team OR Linux package name
    sign_authority: str = ""  # codesign authority OR package manager
    suspicious_path: bool = False
    severity: str          # "info" | "warn" | "high"


def _classify(sign_status: str, suspicious: bool) -> str:
    if sign_status in ("missing", "invalid"):
        return "high"
    if suspicious:
        return "high"
    if sign_status in ("unsigned", "ad-hoc"):
        return "warn"
    return "info"


# ── Mac scanner (unchanged behaviour) ─────────────────────────────────────────

def _audit_mac() -> list[PersistenceEntry]:
    entries: list[PersistenceEntry] = []
    for source, base in MAC_PERSISTENCE_LOCATIONS:
        if not base.exists() or not base.is_dir():
            continue
        for path in sorted(base.glob("*.plist")):
            data = forensics.load_plist(path)
            if not data:
                continue
            program = forensics.plist_program(data)
            sign = (forensics.codesign_check(program) if program
                    else {"status": "missing", "team": "", "authority": ""})
            sus  = bool(program) and forensics.is_suspicious_path(program)
            entries.append(PersistenceEntry(
                source=source,
                plist=str(path),
                label=str(data.get("Label", path.stem)),
                program=program,
                run_at_load=bool(data.get("RunAtLoad", False)),
                keep_alive=bool(data.get("KeepAlive", False) if not isinstance(
                    data.get("KeepAlive"), dict) else True),
                start_interval=(data.get("StartInterval") if isinstance(
                    data.get("StartInterval"), int) else None),
                sign_status=sign["status"],
                sign_team=sign["team"],
                sign_authority=sign["authority"],
                suspicious_path=sus,
                severity=_classify(sign["status"], sus),
            ))
    return entries


# ── Linux scanner ─────────────────────────────────────────────────────────────

LINUX_SYSTEMD_SYSTEM_DIRS = [
    Path("/etc/systemd/system"),
    Path("/usr/lib/systemd/system"),
    Path("/lib/systemd/system"),
]
LINUX_SYSTEMD_USER_DIRS = [
    Path.home() / ".config" / "systemd" / "user",
    Path("/etc/systemd/user"),
    Path("/usr/lib/systemd/user"),
]
LINUX_CRON_FILES = [
    Path("/etc/crontab"),
]
LINUX_CRON_DROPIN_DIRS = [
    Path("/etc/cron.d"),
    Path("/etc/cron.hourly"),
    Path("/etc/cron.daily"),
    Path("/etc/cron.weekly"),
    Path("/etc/cron.monthly"),
]
LINUX_AUTOSTART_DIRS = [
    (Path.home() / ".config" / "autostart", "XDG Autostart (user)"),
    (Path("/etc/xdg/autostart"),            "XDG Autostart (system)"),
]


def _systemd_enabled(scope: str) -> set[str]:
    """Return the set of unit basenames enabled in the given scope.

    scope: "system" or "user". Falls back to an empty set if systemctl is
    unavailable or the user-bus isn't reachable (common in headless sessions).
    """
    systemctl = shutil.which("systemctl")
    if not systemctl:
        return set()
    cmd = [systemctl]
    if scope == "user":
        cmd.append("--user")
    cmd += ["list-unit-files", "--no-legend", "--no-pager", "--state=enabled,static,alias"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=6)
    except Exception:
        return set()
    out: set[str] = set()
    for line in r.stdout.splitlines():
        parts = line.split()
        if parts:
            out.add(parts[0])
    return out


def _parse_unit(path: Path) -> dict[str, str]:
    """Parse a systemd unit file into a flat dict {section.key: value}.

    systemd allows multiple ExecStart= lines; we keep the first one (good
    enough for the program target). configparser also lets multiple values
    coexist by appending.
    """
    cp = configparser.ConfigParser(interpolation=None, strict=False,
                                   inline_comment_prefixes=("#", ";"))
    cp.optionxform = str
    try:
        cp.read(path, encoding="utf-8")
    except Exception:
        return {}
    out: dict[str, str] = {}
    for section in cp.sections():
        for k, v in cp.items(section):
            # If a key repeats, configparser joins with \n — take the first line.
            out[f"{section}.{k}"] = v.split("\n", 1)[0].strip()
    return out


_EXEC_PREFIX_FLAGS = "-@:+!"   # systemd ExecStart= prefix characters


def _resolve_exec(execline: str) -> str:
    """Pull the binary path out of an ExecStart= value, stripping prefix flags.

    If the resulting first token isn't an absolute path, try `shutil.which()`
    so common bare names like `systemctl`, `udevadm`, `kmod` resolve to their
    real location instead of being misclassified as missing binaries.
    """
    s = execline.strip()
    while s and s[0] in _EXEC_PREFIX_FLAGS:
        s = s[1:].strip()
    if not s:
        return ""
    token = s.split()[0]
    if token.startswith("/"):
        return token
    resolved = shutil.which(token)
    return resolved if resolved else token


def _parse_oncalendar(spec: str) -> int | None:
    """Best-effort: convert common OnCalendar= specs to seconds. Returns None
    when the spec isn't a simple interval we recognise."""
    s = spec.strip().lower()
    if s in ("hourly", "*-*-* *:00:00"):
        return 3600
    if s in ("daily", "*-*-* 00:00:00"):
        return 86400
    if s == "weekly":
        return 7 * 86400
    if s == "monthly":
        return 30 * 86400
    return None


def _scan_systemd(dirs: list[Path], scope: str, source_label: str) -> list[PersistenceEntry]:
    enabled = _systemd_enabled(scope)
    seen: set[str] = set()
    entries: list[PersistenceEntry] = []
    for base in dirs:
        if not base.exists() or not base.is_dir():
            continue
        for path in sorted(list(base.glob("*.service")) + list(base.glob("*.timer"))):
            name = path.name
            if name in seen:                 # earlier dir wins (etc > usr/lib > lib)
                continue
            seen.add(name)

            # Skip generated/symlinked instance units (foo@.service) — the @
            # template itself never runs; its instantiations show up enabled.
            if "@" in name and not name.endswith("@.service"):
                pass  # instances are interesting, keep
            elif name.endswith("@.service"):
                continue

            fields = _parse_unit(path)
            execstart = fields.get("Service.ExecStart", "")
            program = _resolve_exec(execstart) if execstart else ""

            # Timer units have OnCalendar= / OnBootSec=; resolve their target
            # via the matching .service if present.
            interval: int | None = None
            if path.suffix == ".timer":
                cal = fields.get("Timer.OnCalendar", "")
                if cal:
                    interval = _parse_oncalendar(cal)
                # Best-effort: timers usually drive same-name services.
                if not program:
                    svc = path.with_suffix(".service")
                    if svc.exists():
                        program = _resolve_exec(_parse_unit(svc).get("Service.ExecStart", ""))

            restart = fields.get("Service.Restart", "no").lower()
            keep_alive = restart in ("always", "on-failure", "on-abnormal",
                                     "on-watchdog", "on-abort")
            run_at_load = name in enabled

            # No ExecStart resolved — could be a unit driven by ExecStartPre
            # only, a non-executable target wrapper, or an alias. Don't flag
            # as "missing binary" — that produces HIGH false-positives.
            if program:
                sign = forensics.linux_pkg_owner(program)
                sus = forensics.is_suspicious_path(program)
            else:
                sign = {"status": "", "team": "", "authority": "no-exec"}
                sus = False

            label = fields.get("Unit.Description") or path.stem
            entries.append(PersistenceEntry(
                source=source_label,
                plist=str(path),
                label=label,
                program=program,
                run_at_load=run_at_load,
                keep_alive=keep_alive,
                start_interval=interval,
                sign_status=sign["status"],
                sign_team=sign["team"],
                sign_authority=sign["authority"],
                suspicious_path=sus,
                severity=_classify(sign["status"], sus),
            ))
    return entries


_CRON_LINE_RE = re.compile(
    r"^\s*([^#@\s][^\s]*\s+[^\s]+\s+[^\s]+\s+[^\s]+\s+[^\s]+)\s+(?:(\w+)\s+)?(.+)$"
)
_CRON_AT_RE = re.compile(r"^\s*(@\w+)\s+(?:(\w+)\s+)?(.+)$")


def _scan_cron_file(path: Path, source_label: str,
                    has_user_field: bool) -> list[PersistenceEntry]:
    """Parse a crontab-style file. /etc/crontab and /etc/cron.d/* have a user
    field; per-user crontabs don't."""
    entries: list[PersistenceEntry] = []
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return entries

    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#") or "=" in line.split(None, 1)[0]:
            # skip blanks, comments, and FOO=bar env lines
            continue

        schedule = ""
        cmd = ""
        if line.startswith("@"):
            m = _CRON_AT_RE.match(line)
            if not m:
                continue
            schedule = m.group(1)
            cmd = m.group(3) if has_user_field else " ".join(filter(None, [m.group(2), m.group(3)]))
        else:
            m = _CRON_LINE_RE.match(line)
            if not m:
                continue
            schedule = m.group(1)
            cmd = m.group(3) if has_user_field else " ".join(filter(None, [m.group(2), m.group(3)]))

        program = cmd.split()[0] if cmd else ""
        if program and not program.startswith("/"):
            resolved = shutil.which(program)
            if resolved:
                program = resolved

        interval = {
            "@hourly":  3600,
            "@daily":   86400,
            "@midnight":86400,
            "@weekly":  7 * 86400,
            "@monthly": 30 * 86400,
            "@yearly":  365 * 86400,
            "@annually":365 * 86400,
            "@reboot":  None,
        }.get(schedule)

        sign = (forensics.linux_pkg_owner(program) if program
                else {"status": "missing", "team": "", "authority": ""})
        sus = bool(program) and forensics.is_suspicious_path(program)

        entries.append(PersistenceEntry(
            source=source_label,
            plist=f"{path}:{lineno}",
            label=f"cron · {schedule}",
            program=program,
            run_at_load=(schedule == "@reboot"),
            keep_alive=False,
            start_interval=interval,
            sign_status=sign["status"],
            sign_team=sign["team"],
            sign_authority=sign["authority"],
            suspicious_path=sus,
            severity=_classify(sign["status"], sus),
        ))
    return entries


def _scan_cron_dropin_dir(path: Path, source_label: str) -> list[PersistenceEntry]:
    """For /etc/cron.hourly etc. — each executable file in the dir runs."""
    entries: list[PersistenceEntry] = []
    if not path.exists() or not path.is_dir():
        return entries
    interval = {
        "cron.hourly":  3600,
        "cron.daily":   86400,
        "cron.weekly":  7 * 86400,
        "cron.monthly": 30 * 86400,
    }.get(path.name)
    for f in sorted(path.iterdir()):
        if not f.is_file():
            continue
        # Skip placeholder/readme files.
        if f.name in ("0anacron", ".placeholder", "README"):
            continue
        program = str(f)
        sign = forensics.linux_pkg_owner(program)
        sus = forensics.is_suspicious_path(program)
        entries.append(PersistenceEntry(
            source=source_label,
            plist=str(f),
            label=f.name,
            program=program,
            run_at_load=False,
            keep_alive=False,
            start_interval=interval,
            sign_status=sign["status"],
            sign_team=sign["team"],
            sign_authority=sign["authority"],
            suspicious_path=sus,
            severity=_classify(sign["status"], sus),
        ))
    return entries


def _scan_user_crontab() -> list[PersistenceEntry]:
    crontab = shutil.which("crontab")
    if not crontab:
        return []
    try:
        r = subprocess.run([crontab, "-l"], capture_output=True, text=True, timeout=4)
    except Exception:
        return []
    if r.returncode != 0 or not r.stdout.strip():
        return []
    # Reuse the file parser by writing to /dev/stdin-style buffer — easiest is
    # to materialise a temp Path-like object. Keep it simple: write to a tmp
    # file and parse, then delete. Tiny — fine.
    import tempfile
    user = os.environ.get("USER", "user")
    with tempfile.NamedTemporaryFile("w", suffix=".cron", delete=False) as fh:
        fh.write(r.stdout)
        tmp = Path(fh.name)
    try:
        out = _scan_cron_file(tmp, f"Cron (user {user})", has_user_field=False)
    finally:
        try: tmp.unlink()
        except Exception: pass
    return out


def _scan_autostart(base: Path, source_label: str) -> list[PersistenceEntry]:
    """Parse .desktop entries. Skip Hidden=true and X-GNOME-Autostart-enabled=false."""
    entries: list[PersistenceEntry] = []
    if not base.exists() or not base.is_dir():
        return entries
    for path in sorted(base.glob("*.desktop")):
        cp = configparser.ConfigParser(interpolation=None, strict=False,
                                       inline_comment_prefixes=("#",))
        cp.optionxform = str
        try:
            cp.read(path, encoding="utf-8")
        except Exception:
            continue
        if "Desktop Entry" not in cp:
            continue
        sect = cp["Desktop Entry"]
        if sect.get("Hidden", "false").lower() == "true":
            continue
        if sect.get("X-GNOME-Autostart-enabled", "true").lower() == "false":
            continue
        exec_line = sect.get("Exec", "")
        program = _resolve_exec(exec_line) if exec_line else ""
        if program and not program.startswith("/"):
            resolved = shutil.which(program)
            if resolved:
                program = resolved
        sign = (forensics.linux_pkg_owner(program) if program
                else {"status": "missing", "team": "", "authority": ""})
        sus = bool(program) and forensics.is_suspicious_path(program)
        entries.append(PersistenceEntry(
            source=source_label,
            plist=str(path),
            label=sect.get("Name", path.stem),
            program=program,
            run_at_load=True,
            keep_alive=False,
            sign_status=sign["status"],
            sign_team=sign["team"],
            sign_authority=sign["authority"],
            suspicious_path=sus,
            severity=_classify(sign["status"], sus),
        ))
    return entries


def _scan_rc_local() -> list[PersistenceEntry]:
    rc = Path("/etc/rc.local")
    if not rc.exists() or not rc.is_file():
        return []
    # rc.local is a shell script. We surface it as a single entry pointing at
    # the file itself — flag if world-writable or contains a /tmp invocation.
    try:
        st = rc.stat()
    except OSError:
        return []
    program = "/etc/rc.local"
    sign = forensics.linux_pkg_owner(program)
    sus = False
    try:
        body = rc.read_text(encoding="utf-8", errors="replace")
        sus = any(p in body for p in ("/tmp/", "/var/tmp/", "/dev/shm/"))
    except Exception:
        pass
    # World-writable rc.local → high.
    if st.st_mode & 0o002:
        sign = {"status": "invalid", "team": "", "authority": "world-writable"}
    return [PersistenceEntry(
        source="rc.local",
        plist=program,
        label="rc.local",
        program=program,
        run_at_load=True,
        keep_alive=False,
        sign_status=sign["status"],
        sign_team=sign["team"],
        sign_authority=sign["authority"],
        suspicious_path=sus,
        severity=_classify(sign["status"], sus),
    )]


def _audit_linux() -> list[PersistenceEntry]:
    entries: list[PersistenceEntry] = []
    entries += _scan_systemd(LINUX_SYSTEMD_SYSTEM_DIRS, "system", "Systemd (system)")
    entries += _scan_systemd(LINUX_SYSTEMD_USER_DIRS,   "user",   "Systemd (user)")
    for cron_file in LINUX_CRON_FILES:
        if cron_file.exists():
            entries += _scan_cron_file(cron_file, "Cron (/etc/crontab)", has_user_field=True)
    for d in LINUX_CRON_DROPIN_DIRS:
        if d.name == "cron.d":
            for f in sorted(d.glob("*")):
                if f.is_file():
                    entries += _scan_cron_file(f, "Cron (/etc/cron.d)", has_user_field=True)
        else:
            entries += _scan_cron_dropin_dir(d, f"Cron ({d.name})")
    entries += _scan_user_crontab()
    for base, label in LINUX_AUTOSTART_DIRS:
        entries += _scan_autostart(base, label)
    entries += _scan_rc_local()
    return entries


# ── public endpoint ───────────────────────────────────────────────────────────

@router.get("/persistence/audit")
def audit() -> dict[str, list[PersistenceEntry]]:
    entries = _audit_mac() if IS_DARWIN else _audit_linux()
    sev_order = {"high": 0, "warn": 1, "info": 2}
    entries.sort(key=lambda e: (sev_order[e.severity], e.source, e.label))
    return {"entries": entries}
