"""Persistence audit — scan macOS auto-start locations.

REST: GET /persistence/audit  → structured report of every LaunchAgent /
LaunchDaemon (and a few other persistence locations), each enriched with the
codesign status of the target executable.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from lib import forensics

router = APIRouter(tags=["forensics"])


# Locations to scan. We skip /System/Library/* — those are Apple-managed and
# would create overwhelming noise.
PERSISTENCE_LOCATIONS: list[tuple[str, Path]] = [
    ("User LaunchAgents",  Path.home() / "Library" / "LaunchAgents"),
    ("Global LaunchAgents", Path("/Library/LaunchAgents")),
    ("LaunchDaemons",       Path("/Library/LaunchDaemons")),
    ("StartupItems",        Path("/Library/StartupItems")),
]


class PersistenceEntry(BaseModel):
    source: str            # category label (e.g. "LaunchDaemons")
    plist: str             # full path to the plist
    label: str             # Label from the plist
    program: str           # resolved executable path
    run_at_load: bool
    keep_alive: bool
    start_interval: int | None = None
    sign_status: str       # apple / developer-id / ad-hoc / unsigned / invalid / missing
    sign_team: str = ""
    sign_authority: str = ""
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


@router.get("/persistence/audit")
def audit() -> dict[str, list[PersistenceEntry]]:
    entries: list[PersistenceEntry] = []

    for source, base in PERSISTENCE_LOCATIONS:
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

    # Sort so noisier (high/warn) entries float to the top
    sev_order = {"high": 0, "warn": 1, "info": 2}
    entries.sort(key=lambda e: (sev_order[e.severity], e.source, e.label))
    return {"entries": entries}
