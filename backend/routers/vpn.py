"""VPN Manager — WireGuard server status / start / stop.

The desktop tool manages a wg0 server set up under ~/vpn-setup. Endpoints
expose the same controls the old GUI offered. Operations that need root
(`wg-quick up/down`) use the platform's standard admin-prompt helper:

  - macOS: osascript "do shell script ... with administrator privileges"
  - Linux: pkexec (PolicyKit) if present, falling back to sudo with the
           SUDO_ASKPASS helper. If neither is available we surface a 501
           with a manual command the user can paste.

There's no sudoers shortcut here because wg-quick varies by environment.
"""
from __future__ import annotations

import logging
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from lib import hids_notify
from lib.auth import require_local_auth
from lib.errors import ErrorCode, MhpError
from lib.platform_util import IS_DARWIN, require_unix

logger = logging.getLogger(__name__)

router = APIRouter(tags=["vpn"], dependencies=[Depends(require_local_auth)])

SERVER_CFG  = Path.home() / "vpn-setup" / "wg0.conf"
CLIENTS_DIR = Path.home() / "vpn-setup" / "clients"

_WG_VPN_HINT = ("VPN Manager wraps wg-quick on macOS/Linux. Windows uses the "
                "WireGuard service / Tunnel app instead — native port pending.")


def _find_wg() -> tuple[str | None, str | None]:
    """Locate wg + wg-quick. Returns (wg_path, wg_quick_path) or (None, None)."""
    wg = shutil.which("wg")
    wg_quick = shutil.which("wg-quick")
    if IS_DARWIN:
        # Homebrew on Apple Silicon installs outside the default PATH for GUI
        # apps, so check the canonical location too.
        wg = wg or ("/opt/homebrew/bin/wg" if Path("/opt/homebrew/bin/wg").exists() else None)
        wg_quick = wg_quick or ("/opt/homebrew/bin/wg-quick"
                                if Path("/opt/homebrew/bin/wg-quick").exists() else None)
    return wg, wg_quick


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


def _is_installed() -> tuple[bool, list[str], str | None, str | None]:
    missing: list[str] = []
    wg, wg_quick = _find_wg()
    if wg is None:
        missing.append("wg")
    if wg_quick is None:
        missing.append("wg-quick")
    if not SERVER_CFG.exists():
        missing.append(str(SERVER_CFG))
    return (len(missing) == 0, missing, wg, wg_quick)


def _admin_run(cmd: str) -> tuple[int, str]:
    """Run `cmd` as root via the OS-native admin prompt. Returns (rc, output)."""
    if IS_DARWIN:
        script = f'do shell script "{cmd}" with administrator privileges'
        r = subprocess.run(["osascript", "-e", script],
                           capture_output=True, text=True, timeout=120)
        return r.returncode, (r.stdout or "") + (r.stderr or "")

    # Linux: prefer pkexec (PolicyKit prompt, works under GNOME/KDE/etc.).
    pkexec = shutil.which("pkexec")
    if pkexec:
        # pkexec wants an absolute path to the binary and individual args, not
        # a shell string. The caller passes a pre-shell-quoted command, so we
        # bounce it through `sh -c` — that costs us nothing and keeps the
        # call sites uniform.
        r = subprocess.run(
            [pkexec, "/bin/sh", "-c", cmd],
            capture_output=True, text=True, timeout=120,
        )
        return r.returncode, (r.stdout or "") + (r.stderr or "")

    # Fall back to sudo with SUDO_ASKPASS (works if the user configured a
    # graphical askpass like ssh-askpass / lxqt-openssh-askpass). If askpass
    # isn't set, sudo will fail non-interactively rather than hang.
    sudo = shutil.which("sudo")
    if sudo:
        r = subprocess.run(
            [sudo, "-A", "/bin/sh", "-c", cmd],
            capture_output=True, text=True, timeout=120,
        )
        return r.returncode, (r.stdout or "") + (r.stderr or "")

    return 127, ("no admin-prompt helper found — install polkit (pkexec) "
                 "or configure sudo with SUDO_ASKPASS")


@router.get("/vpn/status", response_model=VpnStatus)
def status() -> VpnStatus:
    require_unix(_WG_VPN_HINT)
    ok, missing, wg, _ = _is_installed()
    if not ok:
        return VpnStatus(available=False, running=False,
                         config_path=str(SERVER_CFG), missing=missing)

    show = subprocess.run([wg, "show", "wg0"], capture_output=True, text=True, timeout=10)
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
    require_unix(_WG_VPN_HINT)
    ok, missing, _, wg_quick = _is_installed()
    if not ok:
        raise HTTPException(status_code=400,
                            detail=f"wireguard not set up — missing: {missing}")
    cmd = f"{shlex.quote(wg_quick)} {direction} {shlex.quote(str(SERVER_CFG))}"
    rc, out = _admin_run(cmd)
    if rc != 0:
        low = out.lower()
        if "-128" in out or "canceled" in low or "cancelled" in low or "dismissed" in low:
            raise HTTPException(status_code=400, detail="cancelled by user")
        logger.warning("vpn _toggle direction=%s rc=%s out=%s", direction, rc, out[:300])
        raise MhpError(
            "wg-quick command failed",
            code=ErrorCode.TOOL_FAILED,
            status_code=500,
        )
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
