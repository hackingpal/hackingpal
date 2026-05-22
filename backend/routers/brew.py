"""Brew — Homebrew package manager wrapper."""
from __future__ import annotations

import asyncio
import shutil
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["brew"])

BREW = shutil.which("brew") or "/opt/homebrew/bin/brew"


def _brew_available() -> bool:
    return bool(shutil.which("brew") or shutil.which(BREW))


@router.get("/brew/status")
def status() -> dict[str, Any]:
    return {"available": _brew_available(), "path": BREW}


async def _run_capture(args: list[str], timeout: int = 60) -> tuple[int, str]:
    """Run brew once and return (rc, stdout/stderr combined)."""
    proc = await asyncio.create_subprocess_exec(
        BREW, *args,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill(); await proc.wait()
        raise HTTPException(status_code=504, detail="brew command timed out")
    return proc.returncode or 0, out.decode("utf-8", "replace")


@router.get("/brew/search")
async def search(q: str) -> dict[str, Any]:
    if not _brew_available():
        raise HTTPException(status_code=503, detail="brew not installed")
    q = q.strip()
    if not q or len(q) > 64 or any(c in q for c in " ;|&`$\n"):
        raise HTTPException(status_code=400, detail="bad query")
    rc, output = await _run_capture(["search", q], timeout=30)
    formulae: list[str] = []
    casks: list[str] = []
    bucket: list[str] | None = None
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("==>"):
            tag = line.lower()
            if "formulae" in tag:
                bucket = formulae
            elif "casks" in tag:
                bucket = casks
            else:
                bucket = None
            continue
        if bucket is not None and not line.startswith("If you"):
            bucket.extend(line.split())
    return {"rc": rc, "formulae": formulae[:60], "casks": casks[:60]}


@router.get("/brew/installed")
async def installed() -> dict[str, Any]:
    if not _brew_available():
        raise HTTPException(status_code=503, detail="brew not installed")
    rc, out = await _run_capture(["list", "--formula"], timeout=20)
    formulae = [ln.strip() for ln in out.splitlines() if ln.strip()]
    rc2, out2 = await _run_capture(["list", "--cask"], timeout=20)
    casks = [ln.strip() for ln in out2.splitlines() if ln.strip()]
    return {"rc": rc or rc2, "formulae": formulae, "casks": casks}


@router.websocket("/ws/brew-exec")
async def brew_exec(ws: WebSocket) -> None:
    """Stream output of a `brew install` / `brew uninstall` / `brew upgrade`.

    Handshake:  {"action": "install"|"uninstall"|"upgrade", "name": "foo", "cask": false}
    """
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
        if not _brew_available():
            await ws.send_json({"type": "error", "detail": "brew not installed"})
            await ws.close(); return

        init = await ws.receive_json()
        action = str(init.get("action", "")).strip()
        name   = str(init.get("name", "")).strip()
        cask   = bool(init.get("cask", False))
        if action not in ("install", "uninstall", "upgrade"):
            await ws.send_json({"type": "error", "detail": "bad action"})
            await ws.close(); return
        if not name or len(name) > 64 or any(c in name for c in " ;|&`$\n"):
            await ws.send_json({"type": "error", "detail": "bad package name"})
            await ws.close(); return

        args = [action]
        if cask: args.append("--cask")
        args.append(name)

        listener = asyncio.create_task(listen_for_stop())
        await ws.send_json({"type": "started", "cmd": f"brew {' '.join(args)}"})

        proc = await asyncio.create_subprocess_exec(
            BREW, *args,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        try:
            assert proc.stdout is not None
            while not stop.is_set():
                line = await proc.stdout.readline()
                if not line:
                    break
                await ws.send_json({"type": "line",
                                    "text": line.decode("utf-8", "replace").rstrip()})
        finally:
            listener.cancel()
            if proc and proc.returncode is None:
                try:
                    proc.terminate()
                    await asyncio.wait_for(proc.wait(), timeout=2.0)
                except Exception:
                    try: proc.kill()
                    except Exception: pass

        rc = proc.returncode if proc else -1
        await ws.send_json({"type": "done", "rc": rc, "stopped": stop.is_set()})
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
