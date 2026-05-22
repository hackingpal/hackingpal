"""Ping — wraps `ping` as a WebSocket stream.

Protocol:
    client -> server:
        {"target": "8.8.8.8", "count": 0, "interval": 1.0}   // count=0 means infinite
        {"action": "stop"}

    server -> client:
        {"type": "started",  "target": "..."}
        {"type": "line",     "text": "64 bytes from 8.8.8.8: ..."}
        {"type": "done",     "stopped": bool}
        {"type": "error",    "detail": "..."}
"""
from __future__ import annotations

import asyncio
import shlex
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["ping"])


def _build_cmd(target: str, count: int, interval: float) -> list[str]:
    cmd: list[str] = ["ping"]
    if count > 0:
        cmd += ["-c", str(count)]
    if interval and interval >= 0.1:
        cmd += ["-i", str(interval)]
    cmd.append(target)
    return cmd


@router.websocket("/ws/ping")
async def ping_ws(ws: WebSocket) -> None:
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
        target  = str(init.get("target", "")).strip()
        if not target or "\n" in target or "\r" in target:
            await ws.send_json({"type": "error", "detail": "invalid target"})
            await ws.close(); return
        try:
            count    = int(init.get("count", 0))
            interval = float(init.get("interval", 1.0))
        except (TypeError, ValueError):
            await ws.send_json({"type": "error",
                                "detail": "count/interval must be numeric"})
            await ws.close(); return

        listener = asyncio.create_task(listen_for_stop())
        cmd = _build_cmd(target, count, interval)
        await ws.send_json({"type": "started", "target": target,
                            "cmd": " ".join(shlex.quote(c) for c in cmd)})

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            )
        except FileNotFoundError:
            await ws.send_json({"type": "error", "detail": "ping not found"})
            return

        try:
            assert proc.stdout is not None
            while not stop.is_set():
                line = await proc.stdout.readline()
                if not line:
                    break
                await ws.send_json({"type": "line",
                                    "text": line.decode("utf-8", "replace").rstrip()})
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

        await ws.send_json({"type": "done", "stopped": stop.is_set()})
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
