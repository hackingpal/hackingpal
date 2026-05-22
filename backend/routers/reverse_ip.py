"""Reverse IP lookup — find other domains sharing a given IP.

REST  GET /reverse-ip/{target}?confirm=true

Uses HackerTarget's free API (rate-limited to ~50 queries/day on free tier).
Target may be an IP or hostname; hostnames are resolved first.

Response:
  {
    "target": "...",
    "ip": "...",
    "domains": ["a.com", "b.com", ...],
    "count": int,
    "findings": [...],
    "rate_limited": bool,
    "policy": { ... }
  }
"""
from __future__ import annotations

import ipaddress
import socket
import time
from typing import Any
from urllib import parse as urlparse, request as urlrequest
from urllib.error import URLError

from fastapi import APIRouter, HTTPException, Query

from lib import hids_notify
from lib.target_policy import check_target

router = APIRouter(tags=["reverse-ip"])

API = "https://api.hackertarget.com/reverseiplookup/"


def _fetch(ip: str, timeout: float = 12.0) -> tuple[str, int]:
    url = f"{API}?{urlparse.urlencode({'q': ip})}"
    req = urlrequest.Request(url, headers={"User-Agent": "network-tools/0.1 (+reverse-ip)"})
    with urlrequest.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8", errors="replace")
        return body, resp.status


def _resolve(target: str) -> str | None:
    # Already an IP literal (v4 or v6)?
    try:
        ipaddress.ip_address(target)
        return target
    except ValueError:
        pass
    # Hostname — resolve to first A. (HackerTarget free API doesn't accept v6,
    # so we deliberately prefer IPv4 here.)
    try:
        return socket.gethostbyname(target)
    except socket.gaierror:
        return None


@router.get("/reverse-ip/{target}")
async def reverse_ip(target: str, confirm: bool = Query(default=False)) -> dict[str, Any]:
    target = target.strip().lower().rstrip(".")
    if not target or "/" in target or " " in target:
        raise HTTPException(status_code=400, detail="invalid target")

    verdict, reason = check_target(target)
    if verdict == "deny":
        raise HTTPException(status_code=403, detail=f"target denied: {reason}")
    if verdict == "warn" and not confirm:
        raise HTTPException(
            status_code=409,
            detail={"need_confirm": True, "reason": reason, "target": target},
        )

    ip = _resolve(target)
    if not ip:
        raise HTTPException(status_code=400, detail=f"cannot resolve {target!r}")
    # HackerTarget's reverse-IP API doesn't accept v6 addresses.
    try:
        if isinstance(ipaddress.ip_address(ip), ipaddress.IPv6Address):
            raise HTTPException(
                status_code=400,
                detail="reverse-IP service does not accept IPv6 addresses",
            )
    except ValueError:
        pass

    t0 = time.monotonic()
    try:
        body, status = _fetch(ip)
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"hackertarget unreachable: {exc.reason}")

    body_lower = body.lower()
    rate_limited = "api count exceeded" in body_lower or "increase quota" in body_lower
    api_error = "error" in body_lower[:32] or "no records" in body_lower

    domains: list[str] = []
    if not rate_limited and not api_error:
        domains = sorted({ln.strip().lower() for ln in body.splitlines() if ln.strip()})

    findings: list[dict[str, Any]] = []
    if rate_limited:
        findings.append({"severity": "warn", "label": "API rate-limited",
                         "detail": "HackerTarget free tier exceeded (~50/day)"})
    elif api_error:
        findings.append({"severity": "info", "label": "No records",
                         "detail": "HackerTarget returned no co-hosted domains"})
    elif len(domains) > 50:
        findings.append({"severity": "info", "label": "Large shared-hosting footprint",
                         "detail": f"{len(domains)} domains co-hosted on this IP"})
    elif len(domains) == 1:
        findings.append({"severity": "info", "label": "Single domain",
                         "detail": "Likely dedicated hosting"})

    elapsed = round(time.monotonic() - t0, 2)
    await hids_notify.notify(
        "info", "reverse-ip",
        f"Reverse IP — {ip}: {len(domains)} domain(s)",
        {"target": target, "ip": ip, "count": len(domains),
         "rate_limited": rate_limited, "elapsed_seconds": elapsed},
    )

    return {
        "target": target,
        "ip": ip,
        "domains": domains,
        "count": len(domains),
        "rate_limited": rate_limited,
        "raw_first_line": body.splitlines()[0] if body.splitlines() else "",
        "elapsed_seconds": elapsed,
        "findings": findings,
        "policy": {"verdict": verdict, "reason": reason},
    }
