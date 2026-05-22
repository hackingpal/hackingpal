"""IP Checker — blue-team triage lookup."""
from __future__ import annotations

import ipaddress
import json
import socket
import subprocess
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from lib import ip_intel

router = APIRouter(prefix="/ip", tags=["ip"])

_CACHE_TTL = 300.0  # 5 minutes
_CACHE: dict[str, tuple[float, "IpReport"]] = {}
_CACHE_LOCK = threading.Lock()
_BULK_MAX = 50
_BULK_WORKERS = 8


class DnsblEntry(BaseModel):
    name: str
    status: str
    listed: bool


class IpReport(BaseModel):
    input: str
    ip: str
    ip_class: str
    is_internal: bool
    reverse_dns: str
    country: str | None = None
    org: str | None = None
    hosting: str | None = None
    geo_error: str | None = None
    dnsbl: list[DnsblEntry] = []
    abuse_contact: list[str] = []
    verdict_severity: str    # "clean" | "info" | "warn" | "high"
    verdict_text: str


def _classify_ip(ip: str) -> tuple[str, bool]:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ("unknown", False)
    if addr.is_loopback:    return ("loopback",   True)
    if addr.is_private:     return ("private",    True)
    if addr.is_multicast:   return ("multicast",  True)
    if addr.is_link_local:  return ("link-local", True)
    if addr.is_reserved:    return ("reserved",   True)
    return ("public", False)


class BulkRequest(BaseModel):
    targets: list[str] = Field(default_factory=list)


class BulkResult(BaseModel):
    target: str
    ok: bool
    report: IpReport | None = None
    error: str | None = None


class BulkResponse(BaseModel):
    results: list[BulkResult]


def _cache_get(key: str) -> "IpReport | None":
    with _CACHE_LOCK:
        hit = _CACHE.get(key)
        if hit is None:
            return None
        expires_at, report = hit
        if expires_at < time.time():
            _CACHE.pop(key, None)
            return None
        return report


def _cache_put(key: str, report: "IpReport") -> None:
    with _CACHE_LOCK:
        _CACHE[key] = (time.time() + _CACHE_TTL, report)


def _compute_report(target: str) -> IpReport:
    try:
        ip = socket.gethostbyname(target)
    except socket.gaierror as exc:
        raise HTTPException(status_code=404, detail=f"Cannot resolve '{target}': {exc}")

    ip_class, is_internal = _classify_ip(ip)

    try:
        reverse_dns = socket.gethostbyaddr(ip)[0]
    except (socket.herror, socket.gaierror):
        reverse_dns = ""

    country = org = hosting = None
    geo_error: str | None = None
    if not is_internal:
        try:
            data = json.loads(
                urllib.request.urlopen(f"https://ipinfo.io/{ip}/json", timeout=6).read()
            )
            country = data.get("country") or None
            org     = data.get("org") or None
            hosting = ip_intel.classify_hosting(org or "") or None
        except Exception as exc:
            geo_error = str(exc)

    dnsbl: list[DnsblEntry] = []
    bl_hits = 0
    if not is_internal:
        for name, status in ip_intel.dnsbl_check_all(ip):
            listed = status.startswith("Listed")
            if listed:
                bl_hits += 1
            dnsbl.append(DnsblEntry(name=name, status=status, listed=listed))

    abuse: list[str] = []
    try:
        proc = subprocess.run(
            ["/usr/bin/whois", ip], capture_output=True, text=True, timeout=12,
        )
        abuse = ip_intel.whois_abuse_lines(proc.stdout)
    except Exception:
        pass

    if is_internal:
        severity = "info"
        verdict  = f"Internal IP ({ip_class}) — not routable on the public internet"
    elif bl_hits > 0:
        severity = "high"
        verdict  = f"Listed on {bl_hits} blocklist{'s' if bl_hits != 1 else ''} — investigate"
    elif hosting:
        severity = "warn"
        verdict  = f"{hosting} — likely server-to-server traffic, not a residential client"
    else:
        severity = "clean"
        verdict  = "No threat signals from reputation checks"

    return IpReport(
        input=target,
        ip=ip,
        ip_class=ip_class,
        is_internal=is_internal,
        reverse_dns=reverse_dns,
        country=country,
        org=org,
        hosting=hosting,
        geo_error=geo_error,
        dnsbl=dnsbl,
        abuse_contact=abuse,
        verdict_severity=severity,
        verdict_text=verdict,
    )


def _lookup_cached(target: str) -> IpReport:
    key = target.strip().lower()
    cached = _cache_get(key)
    if cached is not None:
        return cached
    report = _compute_report(target)
    _cache_put(key, report)
    return report


@router.get("/{target}", response_model=IpReport)
def lookup(target: str) -> IpReport:
    return _lookup_cached(target)


@router.post("/bulk", response_model=BulkResponse)
def bulk(req: BulkRequest) -> BulkResponse:
    # Dedupe while preserving order, drop blanks
    seen: set[str] = set()
    targets: list[str] = []
    for raw in req.targets:
        t = raw.strip()
        if not t:
            continue
        k = t.lower()
        if k in seen:
            continue
        seen.add(k)
        targets.append(t)
        if len(targets) >= _BULK_MAX:
            break

    if not targets:
        return BulkResponse(results=[])

    def one(t: str) -> BulkResult:
        try:
            return BulkResult(target=t, ok=True, report=_lookup_cached(t))
        except HTTPException as exc:
            return BulkResult(target=t, ok=False, error=str(exc.detail))
        except Exception as exc:
            return BulkResult(target=t, ok=False, error=str(exc))

    with ThreadPoolExecutor(max_workers=_BULK_WORKERS) as pool:
        results = list(pool.map(one, targets))
    return BulkResponse(results=results)
