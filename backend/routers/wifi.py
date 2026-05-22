"""WiFi Integrity — single REST report.

Runs a battery of subprocess checks (SSID, security tier, gateway MAC,
DNS hijack) and returns a structured report. The previous Python GUI did the
same checks as free-form text; the new shape is a list of findings the React
side can render with severity tints.
"""
from __future__ import annotations

import os
import re
import socket
import subprocess

from fastapi import APIRouter
from pydantic import BaseModel

from lib import hids_notify

router = APIRouter(tags=["wifi"])

AIRPORT = ("/System/Library/PrivateFrameworks/Apple80211.framework"
           "/Versions/Current/Resources/airport")


def _run(cmd: list[str], timeout: int = 6) -> str:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except Exception:
        return ""


class Finding(BaseModel):
    section: str           # "Connection" | "Gateway" | "DNS"
    label: str
    value: str = ""
    severity: str = "info" # "pass" | "info" | "warn" | "fail"
    note: str = ""


class WifiReport(BaseModel):
    ssid: str = ""
    bssid: str = ""
    security: str = ""
    signal_dbm: str = ""
    channel: str = ""
    gateway_ip: str = ""
    gateway_mac: str = ""
    dns_servers: list[str] = []
    findings: list[Finding] = []


@router.get("/wifi/report", response_model=WifiReport)
def report() -> WifiReport:
    findings: list[Finding] = []
    out = WifiReport()

    # ── Connection ──────────────────────────────────────────────────────────
    ns = _run(["networksetup", "-getairportnetwork", "en0"])
    if "Current Wi-Fi Network:" in ns:
        out.ssid = ns.split("Current Wi-Fi Network:")[-1].strip()

    airport_info = _run([AIRPORT, "-I"]) if os.path.exists(AIRPORT) else ""
    if airport_info:
        for line in airport_info.splitlines():
            ls = line.strip()
            if ls.startswith("SSID") and "BSSID" not in ls and not out.ssid:
                out.ssid = ls.split(":")[-1].strip()
            elif ls.startswith("BSSID"):
                out.bssid = ls.split(":")[-1].strip()
            elif ls.startswith("agrCtlRSSI"):
                out.signal_dbm = ls.split(":")[-1].strip()
            elif ls.startswith("channel"):
                out.channel = ls.split(":")[-1].strip()
            elif ls.startswith("link auth"):
                out.security = ls.split(":")[-1].strip()

    if out.ssid:
        findings.append(Finding(section="Connection", label="SSID",
                                value=out.ssid, severity="pass"))
    else:
        findings.append(Finding(section="Connection", label="SSID",
                                value="Not connected", severity="warn"))

    if out.bssid:
        findings.append(Finding(section="Connection", label="BSSID", value=out.bssid))
    if out.signal_dbm:
        findings.append(Finding(section="Connection", label="Signal",
                                value=f"{out.signal_dbm} dBm"))
    if out.channel:
        findings.append(Finding(section="Connection", label="Channel", value=out.channel))
    if out.security:
        sec_upper = out.security.upper()
        if "WPA3" in sec_upper:
            findings.append(Finding(section="Connection", label="Security",
                                    value=f"{out.security}  ✓ Strong",
                                    severity="pass",
                                    note="WPA3 uses SAE handshake — resists brute force and protects past sessions."))
        elif "WPA2" in sec_upper:
            findings.append(Finding(section="Connection", label="Security",
                                    value=f"{out.security}  ✓ OK",
                                    severity="pass",
                                    note="WPA2 is secure but vulnerable to handshake capture if password is weak."))
        elif "WEP" in sec_upper:
            findings.append(Finding(section="Connection", label="Security",
                                    value=f"{out.security}  ✗ CRITICAL",
                                    severity="fail",
                                    note="WEP was broken in 2001 — crackable in seconds. All traffic readable."))
        elif "OPEN" in sec_upper or out.security == "none":
            findings.append(Finding(section="Connection", label="Security",
                                    value="OPEN — No encryption  ✗ CRITICAL",
                                    severity="fail",
                                    note="Zero encryption. Anyone in range can capture all your traffic."))
        else:
            findings.append(Finding(section="Connection", label="Security", value=out.security))

    # ── Gateway / ARP ────────────────────────────────────────────────────────
    route = _run(["route", "-n", "get", "default"])
    for line in route.splitlines():
        if "gateway:" in line:
            out.gateway_ip = line.split(":")[-1].strip()
            break

    if out.gateway_ip:
        findings.append(Finding(section="Gateway", label="Gateway IP",
                                value=out.gateway_ip))
        arp = _run(["arp", "-n", out.gateway_ip], timeout=3)
        m = re.search(r"at ([0-9a-f:]{17})", arp)
        if m:
            out.gateway_mac = m.group(1)
            findings.append(Finding(section="Gateway", label="Gateway MAC",
                                    value=out.gateway_mac, severity="pass"))
        else:
            findings.append(Finding(section="Gateway", label="Gateway MAC",
                                    value="(not in ARP cache — try again in a moment)",
                                    severity="warn"))
    else:
        findings.append(Finding(section="Gateway", label="Gateway",
                                value="Could not detect", severity="warn"))

    # ── DNS ─────────────────────────────────────────────────────────────────
    dns_out = _run(["networksetup", "-getdnsservers", "Wi-Fi"])
    if "There aren't any" in dns_out or not dns_out:
        scu = _run(["scutil", "--dns"])
        out.dns_servers = re.findall(r"nameserver\[0\]\s*:\s*(\S+)", scu)
    else:
        out.dns_servers = dns_out.splitlines()

    if out.dns_servers:
        for s in out.dns_servers[:4]:
            findings.append(Finding(section="DNS", label="DNS Server", value=s))
    else:
        findings.append(Finding(section="DNS", label="DNS Servers",
                                value="None configured (DHCP default)",
                                severity="warn"))

    # DNS hijack heuristic — compare local vs 8.8.8.8 resolution
    for domain in ("google.com", "cloudflare.com"):
        try:
            local = socket.gethostbyname(domain)
        except Exception:
            continue
        nsl = _run(["nslookup", domain, "8.8.8.8"], timeout=5)
        trusted: list[str] = []
        capture = False
        for line in nsl.splitlines():
            if "Non-authoritative" in line or "Name:" in line:
                capture = True
            if capture and line.strip().startswith("Address:"):
                addr = line.split(":")[-1].strip()
                if not addr.endswith("#53"):
                    trusted.append(addr)
        if trusted and local not in trusted:
            findings.append(Finding(
                section="DNS",
                label=f"DNS hijack ({domain})",
                value=f"local={local}  trusted={','.join(trusted[:3])}",
                severity="fail",
                note="Your DNS resolver returned a different IP than Google DNS — possible hijack/captive portal.",
            ))
        else:
            findings.append(Finding(
                section="DNS",
                label=f"Integrity ({domain})",
                value=f"matches public DNS · {local}",
                severity="pass",
            ))

    out.findings = findings
    for f in findings:
        if f.severity == "fail":
            hids_notify.notify_threadsafe(
                "critical", "wifi", f"WiFi: {f.label}",
                {"section": f.section, "value": f.value, "note": f.note,
                 "ssid": out.ssid, "bssid": out.bssid},
            )
    return out
