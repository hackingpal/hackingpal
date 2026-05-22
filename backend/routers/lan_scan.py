"""LAN Scan — WebSocket streaming endpoint.

REST helper:  GET /lan/info  → {local_ip, network_base, prefix, total_hosts}

WS protocol (`/ws/lan-scan`):

    client -> server (handshake):
        {}                                  // auto-detect subnet
        {"network": "192.168.0.0/24"}        // explicit

    server -> client:
        {"type": "started",  "local_ip": "...", "network": "...", "total_hosts": 254}
        {"type": "host",     "ip": "...", "hostname": "...", "mac": "..."}
        {"type": "progress", "done": 50, "total": 254, "found": 3}
        {"type": "mac_update", "ip": "...", "mac": "..."}
        {"type": "done",     "elapsed": 6.4, "found": 8, "stopped": false}
        {"type": "error",    "detail": "..."}

    client -> server (any time):
        {"action": "stop"}
"""
from __future__ import annotations

import asyncio
import ipaddress
import socket
import time
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from lib import hids_notify, lan

router = APIRouter(tags=["lan-scan"])


@router.get("/lan/info")
def lan_info() -> dict[str, Any]:
    try:
        ip = lan.local_ip()
        base, prefix = lan.subnet_info(ip)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    net = ipaddress.IPv4Network(f"{base}/{prefix}", strict=False)
    return {
        "local_ip":      ip,
        "network_base":  base,
        "prefix":        prefix,
        "network":       f"{base}/{prefix}",
        "total_hosts":   max(0, net.num_addresses - 2),
    }


@router.websocket("/ws/lan-scan")
async def lan_scan_ws(ws: WebSocket) -> None:
    await ws.accept()
    loop = asyncio.get_running_loop()
    stop = asyncio.Event()

    async def listen_for_stop() -> None:
        try:
            while True:
                msg = await ws.receive_json()
                if isinstance(msg, dict) and msg.get("action") == "stop":
                    stop.set()
                    return
        except WebSocketDisconnect:
            stop.set()
        except Exception:
            stop.set()

    try:
        init: dict[str, Any] = await ws.receive_json()
        my_ip = lan.local_ip()

        if init.get("network"):
            try:
                net = ipaddress.IPv4Network(init["network"], strict=False)
                base, prefix = str(net.network_address), net.prefixlen
            except ValueError as exc:
                await ws.send_json({"type": "error",
                                    "detail": f"bad network spec: {exc}"})
                await ws.close(); return
        else:
            base, prefix = lan.subnet_info(my_ip)

        hosts = lan.subnet_hosts(base, prefix)
        targets = [h for h in hosts if h != my_ip]
        arp = lan.arp_cache()

        listener = asyncio.create_task(listen_for_stop())
        try:
            try:
                my_host = socket.gethostname()
            except Exception:
                my_host = ""

            await ws.send_json({
                "type":        "started",
                "local_ip":    my_ip,
                "network":     f"{base}/{prefix}",
                "total_hosts": len(targets),
            })
            # Always emit our own machine first
            await ws.send_json({
                "type":     "host",
                "ip":       my_ip,
                "hostname": my_host,
                "mac":      arp.get(my_ip, ""),
                "is_self":  True,
            })

            last_progress_at = 0.0

            def on_host(ip: str, hostname: str, mac: str) -> None:
                asyncio.run_coroutine_threadsafe(
                    ws.send_json({"type": "host", "ip": ip,
                                  "hostname": hostname, "mac": mac,
                                  "is_self": False}),
                    loop,
                )

            def on_progress(done: int, total: int, found: int) -> None:
                nonlocal last_progress_at
                now = time.monotonic()
                if done < total and now - last_progress_at < 0.05:
                    return
                last_progress_at = now
                asyncio.run_coroutine_threadsafe(
                    ws.send_json({"type": "progress", "done": done,
                                  "total": total, "found": found}),
                    loop,
                )

            def should_stop() -> bool:
                return stop.is_set()

            t0 = time.monotonic()
            live_ips = await loop.run_in_executor(
                None,
                lambda: lan.scan_stream(
                    targets, arp,
                    on_host=on_host, on_progress=on_progress,
                    should_stop=should_stop,
                ),
            )

            # Single ARP rebuild — TCP probes populated the kernel table by now,
            # so MACs missing initially usually resolve.
            try:
                fresh = lan.arp_cache()
                for ip in live_ips:
                    if not arp.get(ip) and fresh.get(ip):
                        await ws.send_json({"type": "mac_update",
                                            "ip": ip, "mac": fresh[ip]})
            except Exception:
                pass

            elapsed = round(time.monotonic() - t0, 2)
            await ws.send_json({
                "type": "done",
                "elapsed": elapsed,
                "found":   len(live_ips) + 1,   # + self
                "stopped": stop.is_set(),
            })
            if not stop.is_set():
                await hids_notify.notify(
                    "info", "lan-scan",
                    f"LAN scan complete — {len(live_ips) + 1} hosts on {base}/{prefix}",
                    {"network": f"{base}/{prefix}",
                     "found": len(live_ips) + 1,
                     "elapsed_seconds": elapsed},
                )
        finally:
            listener.cancel()
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
