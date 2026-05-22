"""Bluetooth Recon — enumerate paired / connected / recent devices via
`system_profiler SPBluetoothDataType -json`.

We don't do active scanning here — CoreBluetooth's CBCentralManager scan
needs a delegate-driven async loop and an event-pump that doesn't play well
with FastAPI's request lifecycle. system_profiler's already-collected device
list covers the same ground: paired devices, current connections, last-seen
times, addresses, manufacturer-decoded names, services.
"""
from __future__ import annotations

import json
import subprocess
from typing import Any

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/bt", tags=["bt-recon"])


def _run_sp() -> dict[str, Any]:
    try:
        r = subprocess.run(
            ["system_profiler", "SPBluetoothDataType", "-json"],
            capture_output=True, text=True, timeout=20,
        )
    except FileNotFoundError:
        raise HTTPException(503, "system_profiler not found (non-macOS?)")
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "system_profiler timed out")
    if r.returncode != 0:
        raise HTTPException(500,
            f"system_profiler exit {r.returncode}: {r.stderr[:200]}")
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError as e:
        raise HTTPException(500, f"could not parse system_profiler output: {e}")


def _normalize_device(addr: str, info: dict[str, Any]) -> dict[str, Any]:
    """system_profiler returns each device as {bdaddr: {device_keys: ...}}.
    Normalize into a flat dict for the frontend."""
    return {
        "address":       addr,
        "name":          info.get("device_name", ""),
        "manufacturer":  info.get("device_manufacturer", ""),
        "minor_type":    info.get("device_minorType", ""),
        "vendor_id":     info.get("device_vendorID", ""),
        "product_id":    info.get("device_productID", ""),
        "firmware":      info.get("device_firmwareVersion", ""),
        "battery":       info.get("device_batteryPercent", ""),
        "rssi":          info.get("device_rssi", ""),
        "connected":     info.get("device_connected", "") == "attrib_Yes",
        "last_seen":     info.get("device_lastSeenTime", ""),
        "services":      info.get("device_services", "").split(", ")
                          if info.get("device_services") else [],
    }


@router.get("/status")
def status() -> dict[str, Any]:
    """Quick view of the controller + counts."""
    data = _run_sp()
    payload = data.get("SPBluetoothDataType") or []
    controllers: list[dict[str, Any]] = []
    for item in payload:
        ctrl = item.get("controller_properties", {})
        controllers.append({
            "address":          ctrl.get("controller_address", ""),
            "state":            ctrl.get("controller_state", ""),
            "discoverable":     ctrl.get("controller_discoverable", "") == "attrib_On",
            "firmware":         ctrl.get("controller_firmwareVersion", ""),
            "manufacturer":     ctrl.get("controller_manufacturer", ""),
            "vendor_id":        ctrl.get("controller_vendorID", ""),
            "product_id":       ctrl.get("controller_productID", ""),
        })
    return {"controllers": controllers}


@router.get("/devices")
def devices() -> dict[str, Any]:
    data = _run_sp()
    payload = data.get("SPBluetoothDataType") or []

    connected: list[dict[str, Any]] = []
    paired:    list[dict[str, Any]] = []
    not_paired: list[dict[str, Any]] = []   # recently-seen, not paired

    for item in payload:
        for d in item.get("device_connected", []):
            for addr, info in d.items():
                connected.append(_normalize_device(addr, info))
        for d in item.get("device_paired", []):
            for addr, info in d.items():
                paired.append(_normalize_device(addr, info))
        for d in item.get("device_not_paired", []):
            for addr, info in d.items():
                not_paired.append(_normalize_device(addr, info))

    return {
        "connected": connected,
        "paired":    paired,
        "not_paired": not_paired,
        "summary": {
            "connected":  len(connected),
            "paired":     len(paired),
            "not_paired": len(not_paired),
        },
    }
