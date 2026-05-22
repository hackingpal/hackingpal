"""Shared helpers for forensics features (persistence + process inspector)."""
from __future__ import annotations

import plistlib
import re
import subprocess
from pathlib import Path

# Substrings in a codesign authority line that mark the binary as Apple-shipped.
_APPLE_AUTHORITIES = (
    "apple root ca",
    "software signing",
    "apple mac os application signing",
    "developer id installer: apple",
)

# Cache codesign results keyed by file identity. The key includes mtime, size,
# and inode so any modification to the binary invalidates the entry naturally.
# Plateaus at the set of installed binaries on the machine.
_codesign_cache: dict[tuple, dict[str, str]] = {}


def _file_identity(p: Path) -> tuple | None:
    try:
        st = p.stat()
    except OSError:
        return None
    return (str(p), st.st_mtime_ns, st.st_size, st.st_ino)


def codesign_check(path: str | Path) -> dict[str, str]:
    """Return {status, team, authority} for a binary.

    status ∈ {"apple", "developer-id", "ad-hoc", "unsigned", "invalid", "missing"}
    """
    p = Path(path)
    key = _file_identity(p)
    if key is None:
        return {"status": "missing", "team": "", "authority": ""}

    cached = _codesign_cache.get(key)
    if cached is not None:
        return cached

    # First: cheap verify pass
    verify = subprocess.run(
        ["codesign", "--verify", "--no-strict", str(p)],
        capture_output=True, text=True, timeout=8,
    )
    valid = verify.returncode == 0

    # Then: detailed display
    show = subprocess.run(
        ["codesign", "-dvv", str(p)],
        capture_output=True, text=True, timeout=8,
    )
    raw = (show.stdout + show.stderr).strip()
    if "code object is not signed" in raw.lower():
        result = {"status": "unsigned", "team": "", "authority": ""}
        _codesign_cache[key] = result
        return result

    authorities = re.findall(r"Authority=(.+)", raw)
    team = ""
    tm = re.search(r"TeamIdentifier=(\S+)", raw)
    if tm and tm.group(1) != "not":
        team = tm.group(1)

    primary = authorities[0] if authorities else ""
    lo = primary.lower()
    if not valid:
        status = "invalid"
    elif any(k in lo for k in _APPLE_AUTHORITIES):
        status = "apple"
    elif "developer id application" in lo or "developer id installer" in lo:
        status = "developer-id"
    elif primary == "" or "ad hoc" in lo:
        status = "ad-hoc"
    else:
        status = "developer-id"   # signed but non-Apple — treat as devid-class

    result = {"status": status, "team": team, "authority": primary}
    _codesign_cache[key] = result
    return result


# ── plist helpers ──────────────────────────────────────────────────────────────

def load_plist(path: Path) -> dict | None:
    try:
        with path.open("rb") as fh:
            return plistlib.load(fh)
    except Exception:
        return None


def plist_program(data: dict) -> str:
    """Extract the executable a launchd plist points at."""
    p = data.get("Program")
    if isinstance(p, str):
        return p
    args = data.get("ProgramArguments")
    if isinstance(args, list) and args:
        return str(args[0])
    return ""


# ── path heuristics ────────────────────────────────────────────────────────────

SUSPICIOUS_DIR_PREFIXES = (
    "/tmp/", "/var/tmp/", "/private/tmp/", "/private/var/tmp/",
    "/Users/Shared/",
)


def is_suspicious_path(path: str) -> bool:
    return any(path.startswith(p) for p in SUSPICIOUS_DIR_PREFIXES)
