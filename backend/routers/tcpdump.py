"""TCPDump — passwordless sudo check + capture stream.

REST:
    GET  /tcpdump/status       — {passwordless: bool, sudoers_path: str}
    POST /tcpdump/install      — install one-time passwordless sudoers entry
                                  (shows native macOS password dialog once)
    POST /tcpdump/revoke       — remove the sudoers entry (admin prompt)
    GET  /tcpdump/interfaces   — list available interface names

WS (`/ws/tcpdump`):
    client -> server:
        {"iface": "en0", "filter": "tcp port 80", "count": 0,
         "verbose": false, "resolve": false}
        {"action": "stop"}

    server -> server:
        {"type": "started",  "iface": ..., "cmd": ...}
        {"type": "line",     "text": "..."}
        {"type": "stopped",  "captured": 42}
        {"type": "error",    "detail": "..."}
"""
from __future__ import annotations

import asyncio
import getpass
import logging
import re
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from lib import audit_log
from lib.auth import require_local_auth
from lib.errors import ErrorCode, MhpError, ws_error
from lib.platform_util import require_unix

logger = logging.getLogger(__name__)

router = APIRouter(tags=["tcpdump"], dependencies=[Depends(require_local_auth)])

# Interface names: alnum + underscore + dot + colon + hyphen, max 32 chars.
# Covers en0/wlan0/eth0.1/veth-foo and "any"; rejects anything with shell-meta.
_IFACE_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,32}$")

_TCPDUMP_HINT = ("tcpdump wraps the libpcap-based tcpdump binary on macOS/Linux. "
                 "Windows would need npcap + windump (separate install) — "
                 "native port pending.")

SUDOERS_PATH = "/etc/sudoers.d/network-tools-tcpdump"

# Resolve once at import. shutil.which() checks PATH; on Linux tcpdump lives
# in /usr/sbin/ but is often not on a non-root user's PATH — fall back to the
# canonical path so the sudoers entry and command both match.
import shutil as _shutil
TCPDUMP = _shutil.which("tcpdump") or "/usr/sbin/tcpdump"


def _is_passwordless() -> bool:
    try:
        r = subprocess.run(
            ["sudo", "-n", TCPDUMP, "--version"],
            capture_output=True, timeout=3,
        )
        return r.returncode == 0
    except Exception:
        return False


@router.get("/tcpdump/status")
def status() -> dict[str, Any]:
    require_unix(_TCPDUMP_HINT)
    return {
        "passwordless": _is_passwordless(),
        "sudoers_path": SUDOERS_PATH,
        "user":         getpass.getuser(),
    }


_IFACE_SKIP_PREFIXES = (
    # macOS pseudo-interfaces / tunnels
    "utun", "ipsec", "stf", "gif",
    # Linux tunnel / encapsulation interfaces from iproute2
    "tunl", "gre", "erspan", "ip6tnl", "sit", "ip_vti", "ip6_vti",
)


@router.get("/tcpdump/interfaces")
def interfaces() -> dict[str, list[str]]:
    require_unix(_TCPDUMP_HINT)
    names: list[str] = []

    # On Linux prefer `ip -o link show up`. iproute2 is universally present
    # on modern distros, while net-tools (ifconfig) is increasingly absent.
    ip_bin = _shutil.which("ip")
    if ip_bin and sys.platform.startswith("linux"):
        try:
            r = subprocess.run([ip_bin, "-o", "link", "show", "up"],
                               capture_output=True, text=True, timeout=4)
            # Line shape: "11: eth0@if103: <BROADCAST,...>" — capture up to the
            # first ':' or '@' so veth pair names come back clean.
            names = [m.group(1) for m in re.finditer(
                r"^\d+:\s+([^:@\s]+)[:@]", r.stdout, re.MULTILINE)]
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

    if not names:
        try:
            out = subprocess.run(["ifconfig"], capture_output=True,
                                 text=True, timeout=4).stdout
            names = re.findall(r"^(\w+):", out, re.MULTILINE)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return {"interfaces": ["any"]}

    keep = ["any"] + [n for n in names if not n.startswith(_IFACE_SKIP_PREFIXES)]
    return {"interfaces": keep}


@router.post("/tcpdump/install")
def install_sudoers() -> dict[str, Any]:
    """Drop a `<user> ALL=(root) NOPASSWD: <tcpdump>` entry.

    Shows the OS-native admin prompt: osascript on macOS, pkexec (polkit) on
    Linux. Returns whether the install succeeded.
    """
    if _is_passwordless():
        return {"installed": True, "already": True}

    user = getpass.getuser()
    tmp = Path(tempfile.gettempdir()) / "_nt_tcpdump_sudoers"
    tmp.write_text(f"{user} ALL=(root) NOPASSWD: {TCPDUMP}\n")

    if sys.platform == "darwin":
        install_cmd = (
            f"/usr/sbin/visudo -cf {shlex.quote(str(tmp))} && "
            f"/bin/mv {shlex.quote(str(tmp))} {shlex.quote(SUDOERS_PATH)} && "
            f"/usr/sbin/chown root:wheel {shlex.quote(SUDOERS_PATH)} && "
            f"/bin/chmod 0440 {shlex.quote(SUDOERS_PATH)}"
        )
        script = f'do shell script "{install_cmd}" with administrator privileges'
        try:
            r = subprocess.run(["osascript", "-e", script],
                               capture_output=True, text=True, timeout=120)
        except Exception:
            logger.exception("tcpdump sudoers install via osascript failed")
            raise MhpError(
                "sudoers install failed",
                code=ErrorCode.INTERNAL,
                status_code=500,
            )
        if r.returncode != 0:
            err = (r.stderr or "").strip()
            if "-128" in err or "canceled" in err.lower() or "cancelled" in err.lower():
                raise HTTPException(status_code=400,
                                    detail="install cancelled by user")
            raise HTTPException(status_code=500, detail=err or "install failed")
        return {"installed": _is_passwordless()}

    if sys.platform.startswith("linux"):
        pkexec = _shutil.which("pkexec")
        if not pkexec:
            raise HTTPException(
                status_code=501,
                detail=("pkexec not installed. Install policykit-1 (Debian/Ubuntu) "
                        "or polkit (RHEL/Arch), or add a sudoers entry manually: "
                        f"echo '{user} ALL=(root) NOPASSWD: {TCPDUMP}' "
                        f"| sudo tee {SUDOERS_PATH} && "
                        f"sudo chmod 0440 {SUDOERS_PATH}"),
            )
        visudo = _shutil.which("visudo") or "/usr/sbin/visudo"
        install_cmd = (
            f"{shlex.quote(visudo)} -cf {shlex.quote(str(tmp))} && "
            f"/bin/mv {shlex.quote(str(tmp))} {shlex.quote(SUDOERS_PATH)} && "
            # Linux's superuser group is `root`, not Mac's `wheel`.
            f"/bin/chown root:root {shlex.quote(SUDOERS_PATH)} && "
            f"/bin/chmod 0440 {shlex.quote(SUDOERS_PATH)}"
        )
        try:
            r = subprocess.run(
                [pkexec, "/bin/sh", "-c", install_cmd],
                capture_output=True, text=True, timeout=120,
            )
        except Exception:
            logger.exception("tcpdump sudoers install via pkexec failed")
            raise MhpError(
                "sudoers install failed",
                code=ErrorCode.INTERNAL,
                status_code=500,
            )
        if r.returncode != 0:
            err = ((r.stdout or "") + (r.stderr or "")).strip()
            # pkexec: 126 = auth failed / dismissed, 127 = no agent
            if r.returncode in (126, 127):
                raise HTTPException(status_code=400,
                                    detail="install cancelled or no polkit agent available")
            raise HTTPException(status_code=500, detail=err or "install failed")
        return {"installed": _is_passwordless()}

    raise HTTPException(status_code=501,
                        detail="passwordless install not supported on this platform")


@router.post("/tcpdump/revoke")
def revoke_sudoers() -> dict[str, Any]:
    """Remove the passwordless sudoers drop-in.

    Counterpart to /tcpdump/install — same osascript / pkexec flow, so the
    user sees the OS-native admin prompt before any privileged action.
    Idempotent: a missing file is treated as success.
    """
    if not _is_passwordless():
        return {"installed": False, "already": True}

    # `rm -f` so the command succeeds if a concurrent run already removed
    # the file; the post-condition check below is what we trust.
    revoke_cmd = f"/bin/rm -f {shlex.quote(SUDOERS_PATH)}"

    if sys.platform == "darwin":
        script = f'do shell script "{revoke_cmd}" with administrator privileges'
        try:
            r = subprocess.run(["osascript", "-e", script],
                               capture_output=True, text=True, timeout=120)
        except Exception:
            logger.exception("tcpdump sudoers revoke via osascript failed")
            raise MhpError(
                "sudoers revoke failed",
                code=ErrorCode.INTERNAL,
                status_code=500,
            )
        if r.returncode != 0:
            err = (r.stderr or "").strip()
            if "-128" in err or "canceled" in err.lower() or "cancelled" in err.lower():
                raise HTTPException(status_code=400,
                                    detail="revoke cancelled by user")
            raise HTTPException(status_code=500, detail=err or "revoke failed")
        _audit_revoke()
        return {"installed": _is_passwordless()}

    if sys.platform.startswith("linux"):
        pkexec = _shutil.which("pkexec")
        if not pkexec:
            raise HTTPException(
                status_code=501,
                detail=("pkexec not installed. Remove the sudoers entry manually: "
                        f"sudo rm {SUDOERS_PATH}"),
            )
        try:
            r = subprocess.run(
                [pkexec, "/bin/sh", "-c", revoke_cmd],
                capture_output=True, text=True, timeout=120,
            )
        except Exception:
            logger.exception("tcpdump sudoers revoke via pkexec failed")
            raise MhpError(
                "sudoers revoke failed",
                code=ErrorCode.INTERNAL,
                status_code=500,
            )
        if r.returncode != 0:
            err = ((r.stdout or "") + (r.stderr or "")).strip()
            if r.returncode in (126, 127):
                raise HTTPException(
                    status_code=400,
                    detail="revoke cancelled or no polkit agent available",
                )
            raise HTTPException(status_code=500, detail=err or "revoke failed")
        _audit_revoke()
        return {"installed": _is_passwordless()}

    raise HTTPException(status_code=501,
                        detail="passwordless revoke not supported on this platform")


def _audit_revoke() -> None:
    # Best-effort: audit failure shouldn't surface as a revoke failure.
    try:
        aid = audit_log.start(
            tool="sudoers-revoke", target="tcpdump", argv=[SUDOERS_PATH],
        )
        audit_log.complete(aid, summary=f"removed {SUDOERS_PATH}")
    except Exception:
        logger.exception("audit_log write failed for tcpdump sudoers-revoke")


@router.websocket("/ws/tcpdump")
async def tcpdump_ws(ws: WebSocket) -> None:
    await ws.accept()
    stop = asyncio.Event()
    proc: asyncio.subprocess.Process | None = None

    async def listen_for_stop() -> None:
        try:
            while True:
                msg = await ws.receive_json()
                if isinstance(msg, dict) and msg.get("action") == "stop":
                    stop.set(); return
        except WebSocketDisconnect:
            stop.set()
        except Exception:
            stop.set()

    try:
        init: dict[str, Any] = await ws.receive_json()
        iface     = str(init.get("iface", "any")).strip() or "any"
        bpf       = str(init.get("filter", "")).strip()
        count_raw = init.get("count")
        verbose   = bool(init.get("verbose", False))
        resolve   = bool(init.get("resolve", False))

        if not _IFACE_RE.match(iface):
            await ws.send_json(ws_error(
                ErrorCode.VALIDATION_ERROR,
                "invalid interface name",
            ))
            await ws.close(); return

        count = 0
        if count_raw not in (None, ""):
            try:
                count = max(0, int(count_raw))
            except (TypeError, ValueError):
                count = 0

        if not _is_passwordless():
            await ws.send_json(ws_error(
                ErrorCode.FORBIDDEN,
                "passwordless sudo for tcpdump is not configured. "
                "Use the Install Permission button first.",
            ))
            await ws.close(); return

        flags: list[str] = ["-l"]
        if not resolve: flags.append("-n")
        if verbose:     flags.append("-v")
        if count > 0:   flags += ["-c", str(count)]
        flags += ["-i", iface]
        # Disallow shell-meta in filter — should be a BPF expression
        if bpf:
            if any(c in bpf for c in ("`", "$", "&", "|", ";", "\n")):
                await ws.send_json(ws_error(
                    ErrorCode.VALIDATION_ERROR,
                    "filter contains forbidden characters",
                ))
                await ws.close(); return
            flags += shlex.split(bpf)

        cmd = ["sudo", "-n", TCPDUMP, *flags]
        listener = asyncio.create_task(listen_for_stop())
        await ws.send_json({"type": "started", "iface": iface,
                            "cmd": " ".join(shlex.quote(c) for c in cmd)})

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
        except Exception:
            logger.exception("tcpdump subprocess spawn failed")
            await ws.send_json(ws_error(
                ErrorCode.TOOL_FAILED,
                "failed to start tcpdump",
            ))
            return

        captured = 0
        try:
            assert proc.stdout is not None
            while not stop.is_set():
                line = await proc.stdout.readline()
                if not line:
                    break
                text = line.decode("utf-8", "replace").rstrip()
                # Skip tcpdump's own "listening on ..." kind of leader lines
                # by counting only lines that look like packet records (have
                # a timestamp). Loose heuristic but adequate.
                if re.match(r"^\d\d:\d\d:\d\d\.", text):
                    captured += 1
                await ws.send_json({"type": "line", "text": text})
        except Exception:
            pass
        finally:
            listener.cancel()
            if proc and proc.returncode is None:
                try:
                    proc.terminate()
                    await asyncio.wait_for(proc.wait(), timeout=2.0)
                except Exception:
                    try: proc.kill()
                    except Exception: pass

        await ws.send_json({"type": "stopped", "captured": captured})
    except WebSocketDisconnect:
        stop.set()
    except Exception:
        logger.exception("tcpdump_ws unhandled exception")
        try:
            await ws.send_json(ws_error(
                ErrorCode.INTERNAL,
                "internal error during capture",
            ))
        except Exception:
            pass
    finally:
        try:
            await ws.close()
        except Exception:
            pass
