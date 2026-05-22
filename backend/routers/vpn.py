"""VPN Manager — WireGuard server status / start / stop.

The desktop tool manages a wg0 server set up under ~/vpn-setup. Endpoints
expose the same controls the old GUI offered. Operations that need root
(`wg-quick up/down`) use osascript to prompt for admin once — there's no
sudoers shortcut here because wg-quick varies by environment.
"""
from __future__ import annotations

import shlex
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from lib import hids_notify

router = APIRouter(tags=["vpn"])

SERVER_CFG  = Path.home() / "vpn-setup" / "wg0.conf"
CLIENTS_DIR = Path.home() / "vpn-setup" / "clients"
WG          = "/opt/homebrew/bin/wg"
WG_QUICK    = "/opt/homebrew/bin/wg-quick"


class VpnClient(BaseModel):
    name: str
    address: str = ""


class VpnStatus(BaseModel):
    available: bool                  # paths exist + wg installed
    running: bool
    config_path: str
    wg_show: str = ""
    clients: list[VpnClient] = []
    missing: list[str] = []


def _is_installed() -> tuple[bool, list[str]]:
    missing: list[str] = []
    for path in (WG, WG_QUICK):
        if not Path(path).exists():
            missing.append(path)
    if not SERVER_CFG.exists():
        missing.append(str(SERVER_CFG))
    return (len(missing) == 0, missing)


def _admin_run(cmd: str) -> tuple[int, str]:
    """Run `cmd` via osascript admin prompt. Returns (rc, output)."""
    script = f'do shell script "{cmd}" with administrator privileges'
    r = subprocess.run(["osascript", "-e", script],
                       capture_output=True, text=True, timeout=120)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


@router.get("/vpn/status", response_model=VpnStatus)
def status() -> VpnStatus:
    ok, missing = _is_installed()
    if not ok:
        return VpnStatus(available=False, running=False,
                         config_path=str(SERVER_CFG), missing=missing)

    show = subprocess.run([WG, "show", "wg0"], capture_output=True, text=True)
    is_up = show.returncode == 0
    clients: list[VpnClient] = []
    if CLIENTS_DIR.exists():
        for cfg in sorted(CLIENTS_DIR.glob("*.conf")):
            addr = ""
            for line in cfg.read_text().splitlines():
                if line.strip().startswith("Address"):
                    addr = line.split("=", 1)[-1].strip()
            clients.append(VpnClient(name=cfg.stem, address=addr))

    return VpnStatus(
        available=True,
        running=is_up,
        config_path=str(SERVER_CFG),
        wg_show=show.stdout.strip(),
        clients=clients,
    )


def _toggle(direction: str) -> dict[str, Any]:
    ok, missing = _is_installed()
    if not ok:
        raise HTTPException(status_code=400,
                            detail=f"wireguard not set up — missing: {missing}")
    cmd = f"{shlex.quote(WG_QUICK)} {direction} {shlex.quote(str(SERVER_CFG))}"
    rc, out = _admin_run(cmd)
    if rc != 0:
        if "-128" in out or "canceled" in out.lower() or "cancelled" in out.lower():
            raise HTTPException(status_code=400, detail="cancelled by user")
        raise HTTPException(status_code=500, detail=out.strip() or "command failed")
    sev = "info" if direction == "up" else "warning"
    title = "WireGuard wg0 started" if direction == "up" else "WireGuard wg0 stopped"
    hids_notify.notify_threadsafe(sev, "vpn", title, {"direction": direction})
    return {"ok": True, "output": out.strip()}


@router.post("/vpn/start")
def start() -> dict[str, Any]:
    return _toggle("up")


@router.post("/vpn/stop")
def stop() -> dict[str, Any]:
    return _toggle("down")
