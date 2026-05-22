"""IDS — host-based intrusion detection.

Two long-running tasks while the WebSocket is open:
    * Port watcher: snapshots listeners every 5s, diffs against baseline
    * Auth tail:    streams `log stream` filtered for auth-failure events

Events:
    {type: "started",   baseline: 13, unknown: 9}
    {type: "event",     ts, iso, source: "ports"|"auth",
                        severity: "info"|"warn"|"high",
                        title, detail}
    {type: "stopped"}
    {type: "error",     detail}
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from lib import hids_notify, ids

_HIDS_SEVERITY = {"warn": "warning", "high": "critical"}

router = APIRouter(tags=["ids"])

POLL_INTERVAL_S = 5.0
DEBOUNCE_S      = 10.0


@router.websocket("/ws/ids")
async def ids_ws(ws: WebSocket) -> None:
    await ws.accept()
    loop = asyncio.get_running_loop()
    stop = asyncio.Event()

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

    async def send_event(source: str, severity: str, title: str, detail: str) -> None:
        await ws.send_json({
            "type": "event",
            "ts":  datetime.now().strftime("%H:%M:%S"),
            "iso": datetime.now().isoformat(timespec="seconds"),
            "source": source, "severity": severity,
            "title": title, "detail": detail,
        })
        hids_sev = _HIDS_SEVERITY.get(severity)
        if hids_sev:
            await hids_notify.notify(
                hids_sev, "ids", title,
                {"source": source, "detail": detail},
            )

    listener = asyncio.create_task(listen_for_stop())

    try:
        # Optional handshake (allows future config — currently empty)
        try:
            await asyncio.wait_for(ws.receive_json(), timeout=0.5)
        except Exception:
            pass

        baseline = await loop.run_in_executor(None, ids.listening_snapshot)
        unknown  = sum(1 for e in baseline if e[4] not in ids.KNOWN_LISTENERS)
        await ws.send_json({"type": "started",
                            "baseline": len(baseline), "unknown": unknown})
        await send_event(
            "ports", "info", "Baseline captured",
            f"{len(baseline)} listeners observed at start "
            f"({unknown} not on the known-system allowlist)",
        )

        known: set = set(baseline)

        # Auth tail subprocess
        auth_proc = await asyncio.create_subprocess_exec(
            "log", "stream", "--style", "syslog", "--predicate", ids.LOG_PREDICATE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        last_emit_per_proc: dict[str, float] = {}

        async def auth_tail() -> None:
            assert auth_proc.stdout is not None
            try:
                while not stop.is_set():
                    line_b = await auth_proc.stdout.readline()
                    if not line_b:
                        break
                    line = line_b.decode("utf-8", errors="replace").rstrip()
                    cls = ids.classify_auth_line(line)
                    if cls is None:
                        continue
                    severity, key, summary = cls
                    now = time.monotonic()
                    if now - last_emit_per_proc.get(key, 0.0) < DEBOUNCE_S:
                        continue
                    last_emit_per_proc[key] = now
                    await send_event("auth", severity, "Auth event", summary)
            except Exception:
                pass

        async def port_watcher() -> None:
            nonlocal known
            while not stop.is_set():
                # Sleep but wake on stop
                try:
                    await asyncio.wait_for(stop.wait(), timeout=POLL_INTERVAL_S)
                    if stop.is_set():
                        return
                except asyncio.TimeoutError:
                    pass
                current = await loop.run_in_executor(None, ids.listening_snapshot)
                for entry in current - known:
                    proto, addr, port, pid, cmd = entry
                    sev = "info" if cmd in ids.KNOWN_LISTENERS else "warn"
                    await send_event(
                        "ports", sev, "New listening port",
                        f"{proto} {addr}:{port}  ← {cmd} (pid {pid})",
                    )
                for entry in known - current:
                    proto, addr, port, pid, cmd = entry
                    await send_event(
                        "ports", "info", "Port closed",
                        f"{proto} {addr}:{port}  ← {cmd} (pid {pid})",
                    )
                known = current

        auth_task = asyncio.create_task(auth_tail())
        port_task = asyncio.create_task(port_watcher())

        await stop.wait()

        # Clean shutdown
        try:
            auth_proc.terminate()
            await asyncio.wait_for(auth_proc.wait(), timeout=2.0)
        except Exception:
            try:
                auth_proc.kill()
            except Exception:
                pass
        for t in (auth_task, port_task):
            t.cancel()
        await ws.send_json({"type": "stopped"})
    except WebSocketDisconnect:
        stop.set()
    except Exception as exc:
        try:
            await ws.send_json({"type": "error", "detail": str(exc)})
        except Exception:
            pass
    finally:
        listener.cancel()
        try:
            await ws.close()
        except Exception:
            pass
