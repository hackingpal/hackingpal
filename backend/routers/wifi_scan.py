"""WiFi Scanner — passive scan via CoreWLAN.

macOS 15+ note
==============
Apple gates SSID/BSSID reads behind **Location Services**. Without permission,
`CWNetwork.ssid()` and `.bssid()` return None even though the scan succeeds —
you still see RSSI / channel / security type, just not which network it is.

Grant the running app Location access in:
  System Settings → Privacy & Security → Location Services → enable for
  Terminal / MyHackingPal / whatever spawned the backend.

`/wifi/scan` returns a `permission_hint` field set to "location-required" when
we detect all SSIDs as null — the UI uses that to show the fix-it instructions.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/wifi-scan", tags=["wifi-scan"])

# CoreWLAN security type enum (CWSecurity)
SECURITY_NAMES = {
    0: "None",
    1: "WEP",
    2: "WPA Personal",
    3: "WPA Personal Mixed",
    4: "WPA2 Personal",
    5: "Personal",
    6: "Dynamic WEP",
    7: "WPA Enterprise",
    8: "WPA Enterprise Mixed",
    9: "WPA2 Enterprise",
    10: "Enterprise",
    11: "WPA3 Personal",
    12: "WPA3 Enterprise",
    13: "WPA3 Transition",
    14: "OWE",
    15: "OWE Transition",
}


def _import_corewlan():
    try:
        from CoreWLAN import CWWiFiClient
        return CWWiFiClient
    except ImportError as e:
        raise HTTPException(503,
            f"CoreWLAN not available ({e}). This tool is macOS-only. "
            "pip install pyobjc-framework-CoreWLAN")


def _network_to_dict(n) -> dict[str, Any]:
    chan = n.wlanChannel()
    sec_type = -1
    try:
        sec_type = int(n.securityType())
    except Exception:
        pass
    bssid = n.bssid() or ""
    ssid = n.ssid() or ""
    oui = bssid[:8].lower() if bssid else ""
    return {
        "ssid":     str(ssid) if ssid else None,
        "bssid":    str(bssid) if bssid else None,
        "rssi":     int(n.rssiValue() or 0),
        "noise":    int(n.noiseMeasurement() or 0),
        "channel":  int(chan.channelNumber()) if chan else 0,
        "band":     int(chan.channelBand()) if chan else 0,   # 1=2.4GHz, 2=5GHz
        "width":    int(chan.channelWidth()) if chan else 0,
        "security": SECURITY_NAMES.get(sec_type, f"unknown({sec_type})"),
        "security_id": sec_type,
        "country":  str(n.countryCode() or "") or None,
        "beacon_interval": int(n.beaconInterval() or 0),
        "oui":      oui,
        "is_hidden": not bool(ssid),
    }


@router.get("/scan")
def scan() -> dict[str, Any]:
    CWWiFiClient = _import_corewlan()
    client = CWWiFiClient.sharedWiFiClient()
    iface = client.interface()
    if iface is None:
        raise HTTPException(503, "no active WiFi interface")

    nets, err = iface.scanForNetworksWithName_error_(None, None)
    if err is not None:
        raise HTTPException(500, f"CoreWLAN scan failed: {err}")
    if not nets:
        return {
            "interface": str(iface.interfaceName() or ""),
            "networks": [],
            "permission_hint": None,
        }

    rows = [_network_to_dict(n) for n in nets]

    # Detect the Location-permission-missing case: every result has null SSID
    all_null = all(r["ssid"] is None for r in rows)
    return {
        "interface": str(iface.interfaceName() or ""),
        "current_ssid": str(iface.ssid() or "") or None,
        "current_bssid": str(iface.bssid() or "") or None,
        "networks": sorted(rows, key=lambda r: -r["rssi"]),
        "permission_hint": "location-required" if all_null else None,
    }
