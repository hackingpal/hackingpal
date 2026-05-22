"""Evil Twin Detector — flag duplicate SSIDs with suspicious differences.

We run N scans (default 3) spaced apart, aggregate observations per (SSID,
BSSID), and surface findings when two different BSSIDs claim the same SSID
*and* something about them looks like an evil twin:

  - Different security types (e.g. real AP is WPA2-Personal, twin is Open) —
    classic captive-portal evil twin.
  - Different vendor OUI prefixes (manufacturers).
  - One signal much stronger than the legitimate AP (proximity hint).
  - One AP only intermittently visible.

WS  /ws/evil-twin
    client -> server:
        {"scans": 3, "interval_sec": 2.0, "target_ssid": "<optional>"}
    server -> client:
        {"type":"scan_start", "round": 1, "total": 3}
        {"type":"observation","ssid","bssid","rssi","security","round"}
        {"type":"finding", "ssid","bssids":[...], "reason","severity"}
        {"type":"done","total_unique","groups": N,"stopped"}
        {"type":"error","detail"}
"""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .wifi_scan import SECURITY_NAMES, _import_corewlan, _network_to_dict

router = APIRouter(tags=["evil-twin"])


@router.websocket("/ws/evil-twin")
async def evil_twin_ws(ws: WebSocket) -> None:
    await ws.accept()
    stop = asyncio.Event()

    async def listen_for_stop() -> None:
        try:
            while True:
                msg = await ws.receive_json()
                if isinstance(msg, dict) and msg.get("action") == "stop":
                    stop.set(); return
        except Exception:
            stop.set()

    try:
        init = await ws.receive_json()
        rounds = max(1, min(int(init.get("scans", 3)), 10))
        interval = max(0.5, min(float(init.get("interval_sec", 2.0)), 30.0))
        target = (init.get("target_ssid") or "").strip() or None

        CWWiFiClient = _import_corewlan()
        client = CWWiFiClient.sharedWiFiClient()
        iface = client.interface()
        if iface is None:
            await ws.send_json({"type": "error", "detail": "no WiFi interface"})
            await ws.close(); return

        listener = asyncio.create_task(listen_for_stop())

        # (ssid, bssid) -> list of observations
        observations: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)

        for round_no in range(1, rounds + 1):
            if stop.is_set():
                break
            await ws.send_json({"type": "scan_start", "round": round_no, "total": rounds})

            def _scan_sync():
                nets, err = iface.scanForNetworksWithName_error_(None, None)
                if err is not None or not nets:
                    return []
                return [_network_to_dict(n) for n in nets]

            loop = asyncio.get_event_loop()
            rows = await loop.run_in_executor(None, _scan_sync)

            for r in rows:
                ssid = r["ssid"]
                bssid = r["bssid"]
                if not ssid or not bssid:
                    continue
                if target and ssid != target:
                    continue
                observations[(ssid, bssid)].append({
                    "round": round_no, "rssi": r["rssi"],
                    "security": r["security"], "channel": r["channel"],
                    "oui": r["oui"],
                })
                await ws.send_json({
                    "type": "observation", "ssid": ssid, "bssid": bssid,
                    "rssi": r["rssi"], "security": r["security"], "round": round_no,
                })

            if round_no < rounds and not stop.is_set():
                await asyncio.sleep(interval)

        # Correlate
        ssid_to_bssids: dict[str, list[str]] = defaultdict(list)
        for (ssid, bssid) in observations:
            if bssid not in ssid_to_bssids[ssid]:
                ssid_to_bssids[ssid].append(bssid)

        findings_emitted = 0
        for ssid, bssids in ssid_to_bssids.items():
            if len(bssids) < 2:
                continue

            # Pull the latest observation per BSSID for comparison
            samples: list[dict[str, Any]] = []
            for b in bssids:
                obs = observations[(ssid, b)]
                if not obs:
                    continue
                latest = obs[-1]
                samples.append({"bssid": b, **latest, "rounds_seen": len(obs)})

            reasons: list[str] = []
            severity = "info"

            sec_set = set(s["security"] for s in samples)
            if len(sec_set) > 1:
                reasons.append(f"different security types: {sorted(sec_set)}")
                severity = "high"

            ouis = set(s["oui"] for s in samples if s["oui"])
            if len(ouis) > 1:
                reasons.append(f"different vendor OUIs: {sorted(ouis)}")
                if severity != "high":
                    severity = "medium"

            channels = set(s["channel"] for s in samples)
            if len(channels) > 1:
                reasons.append(f"different channels: {sorted(channels)}")
                if severity == "info":
                    severity = "low"

            # Intermittent visibility
            rounds_counts = sorted(s["rounds_seen"] for s in samples)
            if rounds_counts[0] < rounds_counts[-1]:
                reasons.append(
                    f"intermittent: one BSSID seen in "
                    f"{rounds_counts[0]}/{rounds} scans vs {rounds_counts[-1]}/{rounds}"
                )

            # RSSI gap (one much stronger = closer to operator)
            rssis = [s["rssi"] for s in samples]
            if max(rssis) - min(rssis) > 20:
                reasons.append(
                    f"RSSI gap {max(rssis) - min(rssis)} dB "
                    f"({min(rssis)} → {max(rssis)})"
                )

            if not reasons:
                reasons.append("multiple BSSIDs for the same SSID (could be roaming)")

            await ws.send_json({
                "type": "finding", "ssid": ssid,
                "bssids": [s["bssid"] for s in samples],
                "samples": samples,
                "reasons": reasons,
                "severity": severity,
            })
            findings_emitted += 1

        listener.cancel()
        await ws.send_json({
            "type": "done",
            "total_unique": len(observations),
            "groups": findings_emitted,
            "stopped": stop.is_set(),
        })
    except WebSocketDisconnect:
        stop.set()
    except Exception as exc:
        try:
            await ws.send_json({"type": "error", "detail": f"{type(exc).__name__}: {exc}"})
        except Exception:
            pass
    finally:
        try: await ws.close()
        except Exception: pass
