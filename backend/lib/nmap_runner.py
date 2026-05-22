"""Nmap runner — structured options → argv, async subprocess streaming, XML parsing.

Strategy:
    Spawn `nmap -oX <tmp.xml> --stats-every 2s ...` so we get both:
      1. Live human-readable output on stdout (for the Raw tab + progress lines)
      2. A clean XML file we parse on completion for structured results

We never shell-interpolate user input — every argv entry is a separate token.
Targets and most option values are validated with strict regexes; unrecognized
free-text fields (script args, raw extras) are tokenised with shlex.
"""
from __future__ import annotations

import asyncio
import ipaddress
import re
import shlex
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

NMAP_BIN_CANDIDATES = ("/opt/homebrew/bin/nmap", "/usr/local/bin/nmap", "/usr/bin/nmap")


def find_nmap() -> str | None:
    for c in NMAP_BIN_CANDIDATES:
        if Path(c).is_file():
            return c
    return shutil.which("nmap")


def nmap_version(binary: str) -> str:
    try:
        r = subprocess.run([binary, "--version"], capture_output=True,
                           text=True, timeout=3)
        m = re.search(r"Nmap version ([\d.]+)", r.stdout or "")
        return m.group(1) if m else ""
    except Exception:
        return ""


def scripts_dir(binary: str) -> str | None:
    """Resolve the NSE scripts directory for the given nmap binary."""
    try:
        r = subprocess.run([binary, "--datadir-info"], capture_output=True,
                           text=True, timeout=3)
        # Older nmap doesn't ship --datadir-info; fall back to known paths
    except Exception:
        pass
    for c in ("/opt/homebrew/share/nmap/scripts",
              "/usr/local/share/nmap/scripts",
              "/usr/share/nmap/scripts"):
        if Path(c).is_dir():
            return c
    return None


# ── NSE script catalog ────────────────────────────────────────────────────────

_SCRIPTDB_ENTRY = re.compile(
    r'Entry\s*\{\s*filename\s*=\s*"([^"]+)"\s*,\s*'
    r'categories\s*=\s*\{\s*([^}]*)\}\s*\}',
)


def list_scripts(sdir: str) -> list[dict[str, Any]]:
    """Return list of {name, categories} parsed from script.db."""
    db = Path(sdir) / "script.db"
    if not db.is_file():
        # Fallback: list .nse files with empty categories
        return [{"name": p.stem, "categories": []}
                for p in sorted(Path(sdir).glob("*.nse"))]
    out: list[dict[str, Any]] = []
    text = db.read_text(errors="replace")
    for m in _SCRIPTDB_ENTRY.finditer(text):
        fname = m.group(1)
        cats_raw = m.group(2)
        cats = re.findall(r'"([^"]+)"', cats_raw)
        out.append({"name": fname.removesuffix(".nse"),
                    "filename": fname,
                    "categories": cats})
    out.sort(key=lambda d: d["name"])
    return out


def script_help(binary: str, name: str) -> str:
    """Return `nmap --script-help <name>` output, truncated."""
    if not re.fullmatch(r"[A-Za-z0-9_\-*?,]+", name):
        return ""
    try:
        r = subprocess.run([binary, "--script-help", name],
                           capture_output=True, text=True, timeout=10)
        return (r.stdout or "")[:8000]
    except Exception:
        return ""


# ── Target validation ────────────────────────────────────────────────────────

# IP, IP/CIDR, IP-range (1.2.3.4-10 or 1.2.3.4-1.2.3.20),
# hostname (letters/digits/-/. and wildcards * for nmap), IPv6 (basic)
_TARGET_TOKEN = re.compile(
    r"^[A-Za-z0-9_.:\-/*]+$",
)


def parse_targets(text: str) -> tuple[list[str], list[str]]:
    """Split free-form target text into (valid, rejected) lists."""
    raw = re.split(r"[\s,]+", (text or "").strip())
    valid: list[str] = []
    bad: list[str] = []
    for t in raw:
        if not t:
            continue
        if _TARGET_TOKEN.match(t):
            valid.append(t)
        else:
            bad.append(t)
    return valid, bad


def expand_for_policy(targets: list[str]) -> list[str]:
    """Return concrete IPs / hostnames the policy gate should validate.

    CIDR ranges are returned as the network address (the policy checks IP
    family and private/loopback/tailscale state from there).
    """
    out: list[str] = []
    for t in targets:
        if "/" in t:
            try:
                net = ipaddress.ip_network(t, strict=False)
                out.append(str(net.network_address))
                continue
            except ValueError:
                pass
        # Strip nmap range suffix for policy lookup ("1.2.3.4-10" → "1.2.3.4")
        out.append(t.split("-", 1)[0])
    return out


# ── Options → argv ───────────────────────────────────────────────────────────


@dataclass
class NmapOptions:
    targets: list[str] = field(default_factory=list)
    exclude: list[str] = field(default_factory=list)

    # Discovery
    skip_discovery: bool = False              # -Pn
    ping_only: bool = False                   # -sn
    no_dns: bool = True                       # -n
    force_dns: bool = False                   # -R
    traceroute: bool = False                  # --traceroute
    discovery_probes: list[str] = field(default_factory=list)
    # values like "PS22,80", "PA80", "PU53", "PE", "PP", "PM"

    # Scan type
    scan_type: str = "syn"                    # syn|connect|udp|null|fin|xmas|ack|window|maimon|sctp_init|sctp_cookie|ip
    port_spec: str = ""                       # "" / "22,80" / "1-1024" / "U:53,T:80"
    top_ports: int = 0                        # 0 disables; uses --top-ports N
    fast_mode: bool = False                   # -F
    all_ports: bool = False                   # -p- shortcut → "1-65535"
    exclude_ports: str = ""

    # Service / version
    service_version: bool = False             # -sV
    version_intensity: int = -1               # 0..9, -1 = not set
    version_light: bool = False               # --version-light
    version_all: bool = False                 # --version-all

    # OS detection
    os_detect: bool = False                   # -O
    osscan_limit: bool = False
    osscan_guess: bool = False

    # Timing & performance
    timing_template: int = 3                  # -T0..-T5
    min_rate: int = 0
    max_rate: int = 0
    host_timeout: str = ""                    # e.g. "30s", "5m"
    max_retries: int = -1

    # NSE
    nse_categories: list[str] = field(default_factory=list)
    nse_scripts: list[str] = field(default_factory=list)
    nse_args: str = ""                        # raw --script-args value

    # Evasion
    fragment: bool = False                    # -f
    mtu: int = 0
    decoys: str = ""                          # "RND:5" or "1.2.3.4,5.6.7.8,ME"
    spoof_ip: str = ""
    source_port: int = 0
    spoof_mac: str = ""
    badsum: bool = False
    data_length: int = 0

    # Output / misc
    verbose: int = 0                          # 0..3 → "", "-v", "-vv", "-vvv"
    debug: int = 0                            # 0..3
    show_reason: bool = False                 # --reason
    open_only: bool = False                   # --open
    packet_trace: bool = False
    disable_arp_ping: bool = False            # --disable-arp-ping

    # Privileged required (-sS, -sU, -O, -sN, -sF, -sX, -sA, -sW, -sM)
    use_sudo: bool = False

    # Free-form: anything we don't surface. Tokenised with shlex; never shell-eval'd.
    extra_args: str = ""


_VALID_SCAN_TYPES = {
    "syn": "-sS", "connect": "-sT", "udp": "-sU",
    "null": "-sN", "fin": "-sF", "xmas": "-sX",
    "ack": "-sA", "window": "-sW", "maimon": "-sM",
    "sctp_init": "-sY", "sctp_cookie": "-sZ", "ip": "-sO",
}
_PRIV_SCAN_TYPES = {"syn", "udp", "null", "fin", "xmas", "ack", "window",
                    "maimon", "sctp_init", "sctp_cookie", "ip"}
_VALID_PROBE_RE = re.compile(r"^P[SAUEMNPYO][\d,\-]*$")
_TIMING = re.compile(r"^[0-5]$")
_PORTS_RE = re.compile(r"^[UTS:,\-\d]+$")
_DURATION_RE = re.compile(r"^\d+(\.\d+)?[smh]?$")


def needs_privileged(opts: NmapOptions) -> bool:
    if opts.scan_type in _PRIV_SCAN_TYPES:
        return True
    if opts.os_detect or opts.fragment or opts.spoof_mac:
        return True
    return False


def build_argv(opts: NmapOptions, nmap_bin: str, xml_path: str) -> list[str]:
    argv: list[str] = []

    if opts.use_sudo:
        argv += ["sudo", "-n", nmap_bin]
    else:
        argv += [nmap_bin]

    # Always XML to file + machine-friendly stats lines on stdout
    argv += ["-oX", xml_path, "--stats-every", "2s"]

    # Discovery
    if opts.skip_discovery:
        argv.append("-Pn")
    if opts.ping_only:
        argv.append("-sn")
    if opts.no_dns:
        argv.append("-n")
    elif opts.force_dns:
        argv.append("-R")
    if opts.traceroute:
        argv.append("--traceroute")
    if opts.disable_arp_ping:
        argv.append("--disable-arp-ping")
    for p in opts.discovery_probes:
        p = p.strip()
        if not p:
            continue
        if not _VALID_PROBE_RE.match(p):
            raise ValueError(f"invalid discovery probe: {p!r}")
        argv.append(f"-{p}")

    # Scan type (skip if -sn ping-only is set; nmap rejects both together)
    if not opts.ping_only:
        st = _VALID_SCAN_TYPES.get(opts.scan_type)
        if not st:
            raise ValueError(f"unknown scan type: {opts.scan_type!r}")
        argv.append(st)

    # Ports
    if opts.all_ports:
        argv += ["-p-"]
    elif opts.port_spec.strip():
        if not _PORTS_RE.match(opts.port_spec.strip()):
            raise ValueError("invalid port spec")
        argv += ["-p", opts.port_spec.strip()]
    elif opts.top_ports > 0:
        argv += ["--top-ports", str(int(opts.top_ports))]
    if opts.fast_mode:
        argv.append("-F")
    if opts.exclude_ports.strip():
        if not _PORTS_RE.match(opts.exclude_ports.strip()):
            raise ValueError("invalid exclude-ports spec")
        argv += ["--exclude-ports", opts.exclude_ports.strip()]

    # Service version
    if opts.service_version:
        argv.append("-sV")
        if 0 <= opts.version_intensity <= 9:
            argv += ["--version-intensity", str(opts.version_intensity)]
        if opts.version_light:
            argv.append("--version-light")
        if opts.version_all:
            argv.append("--version-all")

    # OS
    if opts.os_detect:
        argv.append("-O")
        if opts.osscan_limit:
            argv.append("--osscan-limit")
        if opts.osscan_guess:
            argv.append("--osscan-guess")

    # Timing
    if not _TIMING.match(str(opts.timing_template)):
        raise ValueError("timing template must be 0-5")
    argv.append(f"-T{int(opts.timing_template)}")
    if opts.min_rate > 0:
        argv += ["--min-rate", str(int(opts.min_rate))]
    if opts.max_rate > 0:
        argv += ["--max-rate", str(int(opts.max_rate))]
    if opts.host_timeout.strip():
        if not _DURATION_RE.match(opts.host_timeout.strip()):
            raise ValueError("invalid host-timeout (use 30s / 5m / 1h)")
        argv += ["--host-timeout", opts.host_timeout.strip()]
    if opts.max_retries >= 0:
        argv += ["--max-retries", str(int(opts.max_retries))]

    # NSE
    scripts: list[str] = []
    for c in opts.nse_categories:
        c = c.strip()
        if c and re.fullmatch(r"[A-Za-z0-9_\-]+", c):
            scripts.append(c)
    for s in opts.nse_scripts:
        s = s.strip()
        if s and re.fullmatch(r"[A-Za-z0-9_\-*?,./]+", s):
            scripts.append(s)
    if scripts:
        argv += ["--script", ",".join(scripts)]
    if opts.nse_args.strip():
        # Reject shell metas; --script-args itself is a single arg
        bad = set("`$;&|<>\n\r") & set(opts.nse_args)
        if bad:
            raise ValueError(f"script-args contains forbidden chars: {bad}")
        argv += ["--script-args", opts.nse_args.strip()]

    # Evasion
    if opts.fragment:
        argv.append("-f")
    if opts.mtu > 0:
        if opts.mtu % 8 != 0:
            raise ValueError("mtu must be a multiple of 8")
        argv += ["--mtu", str(int(opts.mtu))]
    if opts.decoys.strip():
        if not re.fullmatch(r"[A-Za-z0-9_.:,\-]+", opts.decoys.strip()):
            raise ValueError("invalid decoy spec")
        argv += ["-D", opts.decoys.strip()]
    if opts.spoof_ip.strip():
        if not re.fullmatch(r"[A-Za-z0-9_.:\-]+", opts.spoof_ip.strip()):
            raise ValueError("invalid spoof-ip")
        argv += ["-S", opts.spoof_ip.strip()]
    if opts.source_port > 0:
        argv += ["--source-port", str(int(opts.source_port))]
    if opts.spoof_mac.strip():
        if not re.fullmatch(r"[A-Za-z0-9:.\-]+", opts.spoof_mac.strip()):
            raise ValueError("invalid spoof-mac")
        argv += ["--spoof-mac", opts.spoof_mac.strip()]
    if opts.badsum:
        argv.append("--badsum")
    if opts.data_length > 0:
        argv += ["--data-length", str(int(opts.data_length))]

    # Output / misc
    if opts.verbose > 0:
        argv.append("-" + "v" * min(int(opts.verbose), 4))
    if opts.debug > 0:
        argv.append("-" + "d" * min(int(opts.debug), 4))
    if opts.show_reason:
        argv.append("--reason")
    if opts.open_only:
        argv.append("--open")
    if opts.packet_trace:
        argv.append("--packet-trace")

    # Excludes
    if opts.exclude:
        argv += ["--exclude", ",".join(opts.exclude)]

    # Free-form extras — tokenise but reject shell metas
    if opts.extra_args.strip():
        bad = set("`$;&|<>\n\r") & set(opts.extra_args)
        if bad:
            raise ValueError(f"extra_args contains forbidden chars: {bad}")
        argv += shlex.split(opts.extra_args)

    # Targets (last)
    if not opts.targets:
        raise ValueError("at least one target is required")
    for t in opts.targets:
        if not _TARGET_TOKEN.match(t):
            raise ValueError(f"invalid target: {t!r}")
    argv += list(opts.targets)

    return argv


# ── XML parsing ──────────────────────────────────────────────────────────────


def _text(node: ET.Element | None, attr: str = "", default: str = "") -> str:
    if node is None:
        return default
    if attr:
        return node.get(attr, default) or default
    return (node.text or default) if node.text else default


def parse_xml(xml_path: str) -> dict[str, Any]:
    """Parse the nmap -oX output file into a structured dict."""
    tree = ET.parse(xml_path)
    root = tree.getroot()

    scaninfo = root.find("scaninfo")
    runstats = root.find("runstats")
    finished = runstats.find("finished") if runstats is not None else None
    hosts_stat = runstats.find("hosts") if runstats is not None else None

    hosts_out: list[dict[str, Any]] = []
    for h in root.findall("host"):
        status = h.find("status")
        state = _text(status, "state", "unknown")
        reason = _text(status, "reason", "")

        addrs: list[dict[str, str]] = []
        for a in h.findall("address"):
            addrs.append({"addr": a.get("addr", ""),
                          "type": a.get("addrtype", ""),
                          "vendor": a.get("vendor", "")})

        ip = next((a["addr"] for a in addrs if a["type"] in ("ipv4", "ipv6")), "")
        mac = next((a["addr"] for a in addrs if a["type"] == "mac"), "")
        vendor = next((a["vendor"] for a in addrs if a["type"] == "mac"), "")

        hostnames: list[str] = [
            hn.get("name", "") for hn in h.findall("hostnames/hostname")
            if hn.get("name")
        ]

        ports_out: list[dict[str, Any]] = []
        for p in h.findall("ports/port"):
            ps = p.find("state")
            sv = p.find("service")
            scripts = []
            for sc in p.findall("script"):
                scripts.append({
                    "id": sc.get("id", ""),
                    "output": (sc.get("output") or "").strip(),
                })
            ports_out.append({
                "port": int(p.get("portid", "0") or 0),
                "proto": p.get("protocol", ""),
                "state": _text(ps, "state", ""),
                "reason": _text(ps, "reason", ""),
                "service": _text(sv, "name", ""),
                "product": _text(sv, "product", ""),
                "version": _text(sv, "version", ""),
                "extra_info": _text(sv, "extrainfo", ""),
                "tunnel": _text(sv, "tunnel", ""),
                "cpe": [c.text for c in sv.findall("cpe") if c is not None and c.text] if sv is not None else [],
                "scripts": scripts,
            })
        # Sort ports for stable display
        ports_out.sort(key=lambda d: (d["proto"], d["port"]))

        os_guesses: list[dict[str, Any]] = []
        for om in h.findall("os/osmatch"):
            os_guesses.append({
                "name": om.get("name", ""),
                "accuracy": int(om.get("accuracy", "0") or 0),
            })

        host_scripts = []
        for sc in h.findall("hostscript/script"):
            host_scripts.append({"id": sc.get("id", ""),
                                 "output": (sc.get("output") or "").strip()})

        times = h.find("times")
        rtt = ""
        if times is not None:
            srtt = times.get("srtt")
            if srtt:
                try:
                    rtt = f"{int(srtt) / 1000:.1f} ms"
                except ValueError:
                    rtt = ""

        hosts_out.append({
            "ip": ip,
            "mac": mac,
            "vendor": vendor,
            "hostnames": hostnames,
            "state": state,
            "reason": reason,
            "rtt": rtt,
            "ports": ports_out,
            "os_guesses": os_guesses[:5],
            "host_scripts": host_scripts,
        })

    elapsed = 0.0
    if finished is not None:
        try:
            elapsed = float(finished.get("elapsed", "0") or 0)
        except ValueError:
            elapsed = 0.0

    return {
        "args": root.get("args", ""),
        "version": root.get("version", ""),
        "scaninfo": {
            "type":     _text(scaninfo, "type", ""),
            "protocol": _text(scaninfo, "protocol", ""),
            "numservices": _text(scaninfo, "numservices", ""),
        } if scaninfo is not None else {},
        "elapsed": elapsed,
        "summary": _text(finished, "summary", ""),
        "hosts_up": int(_text(hosts_stat, "up", "0") or 0) if hosts_stat is not None else 0,
        "hosts_down": int(_text(hosts_stat, "down", "0") or 0) if hosts_stat is not None else 0,
        "hosts_total": int(_text(hosts_stat, "total", "0") or 0) if hosts_stat is not None else 0,
        "hosts": hosts_out,
    }


# ── Stats-line parser (for live progress) ────────────────────────────────────

_STATS_LINE = re.compile(r"About ([\d.]+)% done")
_STATS_HOSTS = re.compile(
    r"(\d+) hosts completed.*?\((\d+) up\)",
)


def parse_stats(line: str) -> dict[str, Any] | None:
    pct = None
    m = _STATS_LINE.search(line)
    if m:
        try:
            pct = float(m.group(1))
        except ValueError:
            pct = None
    m2 = _STATS_HOSTS.search(line)
    done = up = None
    if m2:
        try:
            done = int(m2.group(1)); up = int(m2.group(2))
        except ValueError:
            pass
    if pct is None and done is None:
        return None
    out: dict[str, Any] = {}
    if pct is not None: out["pct"] = pct
    if done is not None: out["hosts_done"] = done
    if up is not None: out["hosts_up"] = up
    return out


# ── Async runner ─────────────────────────────────────────────────────────────


async def run_scan(
    opts: NmapOptions,
    nmap_bin: str,
    on_event: Callable[[dict[str, Any]], Awaitable[None]],
    should_stop: Callable[[], bool],
) -> dict[str, Any]:
    """Run nmap to completion (or until should_stop()).

    Emits events via on_event:
      {"type": "started", "cmd": "...", "argv": [...], "xml_path": "..."}
      {"type": "line",    "text": "..."}                       # raw stdout line
      {"type": "progress","pct": 12.3, "hosts_done": 2, "hosts_up": 1}
      {"type": "stderr",  "text": "..."}
      {"type": "done",    "rc": 0, "stopped": bool, "report": {...}}
      {"type": "error",   "detail": "..."}
    """
    tmp = tempfile.NamedTemporaryFile(prefix="nt-nmap-", suffix=".xml", delete=False)
    tmp.close()
    xml_path = tmp.name

    try:
        argv = build_argv(opts, nmap_bin, xml_path)
    except ValueError as e:
        await on_event({"type": "error", "detail": str(e)})
        return {"rc": -1, "stopped": False, "report": None}

    cmd_str = " ".join(shlex.quote(a) for a in argv)
    await on_event({"type": "started", "cmd": cmd_str, "argv": argv,
                    "xml_path": xml_path})

    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as e:
        await on_event({"type": "error", "detail": f"nmap not found: {e}"})
        return {"rc": -1, "stopped": False, "report": None}
    except Exception as e:
        await on_event({"type": "error", "detail": str(e)})
        return {"rc": -1, "stopped": False, "report": None}

    stopped_flag = False

    async def pump_stdout() -> None:
        assert proc.stdout is not None
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            text = line.decode("utf-8", "replace").rstrip()
            stats = parse_stats(text)
            if stats:
                await on_event({"type": "progress", **stats})
            await on_event({"type": "line", "text": text})

    async def pump_stderr() -> None:
        assert proc.stderr is not None
        while True:
            line = await proc.stderr.readline()
            if not line:
                break
            text = line.decode("utf-8", "replace").rstrip()
            if text:
                await on_event({"type": "stderr", "text": text})

    async def watch_stop() -> None:
        nonlocal stopped_flag
        while proc.returncode is None:
            if should_stop():
                stopped_flag = True
                try:
                    proc.terminate()
                except ProcessLookupError:
                    pass
                # If it doesn't exit within 2s, hard-kill
                try:
                    await asyncio.wait_for(proc.wait(), timeout=2.0)
                except asyncio.TimeoutError:
                    try: proc.kill()
                    except Exception: pass
                return
            await asyncio.sleep(0.2)

    tasks = [asyncio.create_task(pump_stdout()),
             asyncio.create_task(pump_stderr()),
             asyncio.create_task(watch_stop())]
    rc = await proc.wait()
    for t in tasks:
        if not t.done():
            t.cancel()
    # Let the pumps drain. Both CancelledError and other exceptions are
    # safe to swallow here — the subprocess is already done.
    await asyncio.gather(*tasks, return_exceptions=True)

    report: dict[str, Any] | None = None
    try:
        if Path(xml_path).is_file() and Path(xml_path).stat().st_size > 0:
            report = parse_xml(xml_path)
    except ET.ParseError as e:
        await on_event({"type": "stderr",
                        "text": f"(xml parse warning: {e})"})

    await on_event({"type": "done", "rc": rc,
                    "stopped": stopped_flag, "report": report})
    return {"rc": rc, "stopped": stopped_flag, "report": report,
            "xml_path": xml_path}
