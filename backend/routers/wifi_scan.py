"""WiFi Scanner — passive scan via CoreWLAN (macOS) or nmcli/iw (Linux).

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

Linux note
==========
We prefer `nmcli` (no root required) and fall back to `iw dev <iface> scan` if
nmcli isn't installed. nmcli reports signal as 0..100 %; we map it to a rough
dBm via `dBm ≈ signal − 100` so the rest of the pipeline (which expects
RSSI in dBm) stays consistent. The conversion is approximate but monotonic,
which is what the evil-twin RSSI-gap heuristic actually depends on.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
from typing import Any

from fastapi import APIRouter, HTTPException

from lib.platform_util import IS_DARWIN, require_unix

router = APIRouter(prefix="/wifi-scan", tags=["wifi-scan"])

# CoreWLAN security type enum (CWSecurity) — Mac scans surface these as ints.
SECURITY_NAMES = {
    0: "None", 1: "WEP", 2: "WPA Personal", 3: "WPA Personal Mixed",
    4: "WPA2 Personal", 5: "Personal", 6: "Dynamic WEP", 7: "WPA Enterprise",
    8: "WPA Enterprise Mixed", 9: "WPA2 Enterprise", 10: "Enterprise",
    11: "WPA3 Personal", 12: "WPA3 Enterprise", 13: "WPA3 Transition",
    14: "OWE", 15: "OWE Transition",
}


# ── macOS scanner ────────────────────────────────────────────────────────────

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


def _scan_mac() -> dict[str, Any]:
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
            "current_ssid": None,
            "current_bssid": None,
            "networks": [],
            "permission_hint": None,
        }

    rows = [_network_to_dict(n) for n in nets]
    all_null = all(r["ssid"] is None for r in rows)
    return {
        "interface": str(iface.interfaceName() or ""),
        "current_ssid": str(iface.ssid() or "") or None,
        "current_bssid": str(iface.bssid() or "") or None,
        "networks": sorted(rows, key=lambda r: -r["rssi"]),
        "permission_hint": "location-required" if all_null else None,
    }


# ── Linux scanner ────────────────────────────────────────────────────────────

def _wifi_iface_linux() -> str:
    iw = shutil.which("iw")
    if iw:
        out = subprocess.run([iw, "dev"], capture_output=True, text=True, timeout=4).stdout
        iface = ""
        for line in out.splitlines():
            ls = line.strip()
            if ls.startswith("Interface "):
                iface = ls.split()[1]
            elif ls.startswith("type ") and "managed" in ls and iface:
                return iface
        if iface:
            return iface
    nmcli = shutil.which("nmcli")
    if nmcli:
        out = subprocess.run([nmcli, "-t", "-f", "DEVICE,TYPE",
                              "device", "status"],
                             capture_output=True, text=True, timeout=4).stdout
        for line in out.splitlines():
            parts = line.split(":")
            if len(parts) >= 2 and parts[1] == "wifi":
                return parts[0]
    return ""


def _freq_to_chan(freq_mhz: int) -> int:
    """Convert centre frequency to channel number. Covers 2.4 GHz + 5 GHz +
    rudimentary 6 GHz (Wi-Fi 6E). Check 6 GHz first — it starts at 5955 MHz,
    which would otherwise be misclassified as 5 GHz channel 191."""
    if 2412 <= freq_mhz <= 2484:
        if freq_mhz == 2484:
            return 14
        return (freq_mhz - 2407) // 5
    if 5955 <= freq_mhz <= 7115:
        return (freq_mhz - 5950) // 5
    if 5000 <= freq_mhz < 5955:
        return (freq_mhz - 5000) // 5
    return 0


def _nmcli_split(line: str) -> list[str]:
    # `nmcli -t` separates fields by ":" and escapes literal colons as "\:".
    parts = re.split(r"(?<!\\):", line)
    return [p.replace("\\:", ":") for p in parts]


def _scan_linux() -> dict[str, Any]:
    iface = _wifi_iface_linux()

    nmcli = shutil.which("nmcli")
    rows: list[dict[str, Any]] = []
    current_ssid: str | None = None
    current_bssid: str | None = None

    if nmcli:
        try:
            r = subprocess.run(
                [nmcli, "-t", "-f", "IN-USE,SSID,BSSID,SIGNAL,FREQ,SECURITY",
                 "device", "wifi", "list", "--rescan", "yes"],
                capture_output=True, text=True, timeout=15,
            )
        except Exception as e:
            raise HTTPException(500, f"nmcli scan failed: {e}")
        if r.returncode != 0:
            raise HTTPException(500,
                f"nmcli scan failed (rc={r.returncode}): "
                f"{(r.stderr or r.stdout or '').strip()}")

        for line in r.stdout.splitlines():
            parts = _nmcli_split(line)
            if len(parts) < 6:
                continue
            in_use, ssid, bssid, signal, freq, security = parts[:6]
            ssid = ssid or ""
            bssid = bssid.lower() if bssid else ""
            try:
                pct = int(signal)
            except ValueError:
                pct = 0
            # 0..100% → approximate dBm. Keep monotonic — exact mapping
            # depends on driver, but this is what the rest of the pipeline
            # (and evil-twin's >20 dB gap check) actually needs.
            rssi_dbm = pct - 100
            try:
                freq_int = int(freq.split()[0]) if freq else 0
            except ValueError:
                freq_int = 0
            chan = _freq_to_chan(freq_int) if freq_int else 0
            band = 1 if 2400 <= freq_int < 2500 else (2 if 5000 <= freq_int < 7200 else 0)
            sec = security.strip() or "None"
            if sec in ("--", ""):
                sec = "None"
            row = {
                "ssid": ssid if ssid else None,
                "bssid": bssid if bssid else None,
                "rssi": rssi_dbm,
                "noise": 0,
                "channel": chan,
                "band": band,
                "width": 0,
                "security": sec,
                "security_id": -1,
                "country": None,
                "beacon_interval": 0,
                "oui": bssid[:8] if bssid else "",
                "is_hidden": not bool(ssid),
            }
            rows.append(row)
            if in_use.strip() == "*":
                current_ssid = ssid or None
                current_bssid = bssid or None

    elif shutil.which("iw") and iface:
        rows, current_ssid, current_bssid = _scan_iw(iface)
    else:
        raise HTTPException(503,
            "no WiFi scanner available — install network-manager (nmcli) or "
            "iw (`apt install iw`) and ensure a wifi interface exists.")

    return {
        "interface": iface,
        "current_ssid": current_ssid,
        "current_bssid": current_bssid,
        "networks": sorted(rows, key=lambda r: -r["rssi"]),
        "permission_hint": None,
    }


def _scan_iw(iface: str) -> tuple[list[dict[str, Any]], str | None, str | None]:
    """Run `iw dev <iface> scan` (needs CAP_NET_ADMIN — typically root). Parse
    the verbose output. Used only when nmcli isn't installed."""
    iw = shutil.which("iw") or "iw"
    r = subprocess.run([iw, "dev", iface, "scan"],
                       capture_output=True, text=True, timeout=20)
    if r.returncode != 0:
        raise HTTPException(500,
            f"iw scan failed (rc={r.returncode}): "
            f"{(r.stderr or '').strip()} — `iw scan` usually requires root.")

    rows: list[dict[str, Any]] = []
    cur: dict[str, Any] = {}

    def flush():
        if cur.get("bssid"):
            rows.append({
                "ssid": cur.get("ssid") if cur.get("ssid") else None,
                "bssid": cur["bssid"],
                "rssi": int(cur.get("rssi", -100)),
                "noise": 0,
                "channel": int(cur.get("channel", 0) or 0),
                "band": cur.get("band", 0),
                "width": 0,
                "security": cur.get("security", "None"),
                "security_id": -1,
                "country": None,
                "beacon_interval": 0,
                "oui": cur["bssid"][:8],
                "is_hidden": not bool(cur.get("ssid")),
            })

    for line in r.stdout.splitlines():
        if line.startswith("BSS "):
            flush()
            cur = {}
            m = re.search(r"([0-9a-f:]{17})", line)
            if m:
                cur["bssid"] = m.group(1).lower()
            continue
        ls = line.strip()
        if ls.startswith("SSID:"):
            cur["ssid"] = ls.split(":", 1)[1].strip()
        elif ls.startswith("signal:"):
            try:
                cur["rssi"] = int(float(ls.split(":", 1)[1].strip().split()[0]))
            except (ValueError, IndexError):
                pass
        elif ls.startswith("freq:"):
            try:
                freq = int(ls.split(":", 1)[1].strip())
                cur["channel"] = _freq_to_chan(freq)
                cur["band"] = 1 if 2400 <= freq < 2500 else (2 if 5000 <= freq < 7200 else 0)
            except ValueError:
                pass
        elif "RSN:" in ls:
            cur["security"] = "WPA2/WPA3"
        elif "WPA:" in ls:
            cur["security"] = cur.get("security", "WPA")
        elif "Privacy" in ls and "capability:" in ls.lower():
            cur.setdefault("security", "WEP")
    flush()
    return rows, None, None


# ── public function: used by evil_twin too ───────────────────────────────────

def scan_networks() -> dict[str, Any]:
    """Platform-agnostic WiFi scan. Returns the same shape as /wifi-scan/scan."""
    require_unix("WiFi scan uses CoreWLAN (macOS) or nmcli/iw (Linux); "
                 "Windows port not implemented yet.")
    return _scan_mac() if IS_DARWIN else _scan_linux()


@router.get("/scan")
def scan() -> dict[str, Any]:
    return scan_networks()
