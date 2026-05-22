"""TCPDump — passwordless sudo check + capture stream.

REST:
    GET  /tcpdump/status       — {passwordless: bool, sudoers_path: str}
    POST /tcpdump/install      — install one-time passwordless sudoers entry
                                  (shows native macOS password dialog once)
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
import re
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from lib.auth import require_local_auth

router = APIRouter(tags=["tcpdump"])

SUDOERS_PATH = "/etc/sudoers.d/network-tools-tcpdump"


def _is_passwordless() -> bool:
    try:
        r = subprocess.run(
            ["sudo", "-n", "/usr/sbin/tcpdump", "--version"],
            capture_output=True, timeout=3,
        )
        return r.returncode == 0
    except Exception:
        return False


@router.get("/tcpdump/status")
def status() -> dict[str, Any]:
    return {
        "passwordless": _is_passwordless(),
        "sudoers_path": SUDOERS_PATH,
        "user":         getpass.getuser(),
    }


@router.get("/tcpdump/interfaces")
def interfaces() -> dict[str, list[str]]:
    try:
        out = subprocess.run(["ifconfig"], capture_output=True, text=True).stdout
    except FileNotFoundError:
        return {"interfaces": ["any"]}
    names = re.findall(r"^(\w+):", out, re.MULTILINE)
    # Filter out tunnels / loopback-only / inactive things
    keep = ["any"] + [n for n in names if not n.startswith(("utun", "ipsec", "stf", "gif"))]
    return {"interfaces": keep}


@router.post("/tcpdump/install", dependencies=[Depends(require_local_auth)])
def install_sudoers() -> dict[str, Any]:
    """Drop a `<user> ALL=(root) NOPASSWD: /usr/sbin/tcpdump` entry.

    Shows a native macOS password prompt via osascript. Returns whether the
    install succeeded.
    """
    if sys.platform != "darwin":
        raise HTTPException(
            status_code=501,
            detail=("Passwordless sudoers auto-install is macOS-only. "
                    "On Linux, add a sudoers entry manually: "
                    f"echo '{getpass.getuser()} ALL=(root) NOPASSWD: $(which tcpdump)' "
                    "| sudo tee /etc/sudoers.d/myhackingpal-tcpdump && "
                    "sudo chmod 0440 /etc/sudoers.d/myhackingpal-tcpdump"),
        )
    if _is_passwordless():
        return {"installed": True, "already": True}

    user = getpass.getuser()
    tmp = Path(tempfile.gettempdir()) / "_nt_tcpdump_sudoers"
    tmp.write_text(f"{user} ALL=(root) NOPASSWD: /usr/sbin/tcpdump\n")

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
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    if r.returncode != 0:
        err = (r.stderr or "").strip()
        # User clicked Cancel
        if "-128" in err or "canceled" in err.lower() or "cancelled" in err.lower():
            raise HTTPException(status_code=400,
                                detail="install cancelled by user")
        raise HTTPException(status_code=500,
                            detail=err or "install failed")
    return {"installed": _is_passwordless()}


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

        count = 0
        if count_raw not in (None, ""):
            try:
                count = max(0, int(count_raw))
            except (TypeError, ValueError):
                count = 0

        if not _is_passwordless():
            await ws.send_json({
                "type": "error",
                "detail": "passwordless sudo for tcpdump is not configured. "
                          "Use the Install Permission button first.",
            })
            await ws.close(); return

        flags: list[str] = ["-l"]
        if not resolve: flags.append("-n")
        if verbose:     flags.append("-v")
        if count > 0:   flags += ["-c", str(count)]
        flags += ["-i", iface]
        # Disallow shell-meta in filter — should be a BPF expression
        if bpf:
            if any(c in bpf for c in ("`", "$", "&", "|", ";", "\n")):
                await ws.send_json({"type": "error",
                                    "detail": "filter contains forbidden characters"})
                await ws.close(); return
            flags += shlex.split(bpf)

        cmd = ["sudo", "-n", "/usr/sbin/tcpdump", *flags]
        listener = asyncio.create_task(listen_for_stop())
        await ws.send_json({"type": "started", "iface": iface,
                            "cmd": " ".join(shlex.quote(c) for c in cmd)})

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
        except Exception as exc:
            await ws.send_json({"type": "error", "detail": str(exc)})
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
    except Exception as exc:
        try:
            await ws.send_json({"type": "error", "detail": str(exc)})
        except Exception:
            pass
    finally:
        try:
            await ws.close()
        except Exception:
            pass
