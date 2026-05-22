"""Shodan + Censys query proxies.

Two services, one router, normalized result rows. Both APIs use very different
schemas — we flatten to a common `{ip, port, service, banner, country, org,
hostnames, raw}` row so the frontend can render a single table.

Auth:
  - Shodan:  `shodan_api_key` in Keychain (we already have this).
  - Censys:  `censys_api_id` + `censys_api_secret` (HTTP Basic).
"""
from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .settings import keychain_get_named

router = APIRouter(prefix="/shodan-censys", tags=["shodan-censys"])

UA = "MyHackingPal/0.1 shodan-censys"


@router.get("/status")
def status() -> dict[str, Any]:
    return {
        "shodan_configured": bool(keychain_get_named("shodan_api_key")),
        "censys_configured": bool(
            keychain_get_named("censys_api_id") and keychain_get_named("censys_api_secret")
        ),
    }


class QueryBody(BaseModel):
    service: str = Field(..., pattern="^(shodan|censys)$")
    query: str = Field(..., min_length=1, max_length=2000)
    limit: int = Field(default=25, ge=1, le=100)
    page: int = Field(default=1, ge=1, le=20)


@router.post("/query")
async def query(body: QueryBody) -> dict[str, Any]:
    if body.service == "shodan":
        return await _shodan(body.query, body.limit, body.page)
    return await _censys(body.query, body.limit, body.page)


async def _shodan(q: str, limit: int, page: int) -> dict[str, Any]:
    key = keychain_get_named("shodan_api_key")
    if not key:
        raise HTTPException(401, "shodan_api_key not configured")
    async with httpx.AsyncClient(
        timeout=20.0, headers={"User-Agent": UA},
    ) as client:
        r = await client.get(
            "https://api.shodan.io/shodan/host/search",
            params={"key": key, "query": q, "limit": limit, "page": page},
        )
    if r.status_code == 401:
        raise HTTPException(401, "Shodan rejected the API key")
    if not r.ok:
        try:
            detail = r.json().get("error", r.text[:200])
        except Exception:
            detail = r.text[:200]
        raise HTTPException(r.status_code, f"Shodan {r.status_code}: {detail}")

    data = r.json()
    rows: list[dict[str, Any]] = []
    for m in data.get("matches", []):
        rows.append({
            "ip":        m.get("ip_str", ""),
            "port":      m.get("port"),
            "service":   m.get("_shodan", {}).get("module", "") or m.get("product", ""),
            "banner":    (m.get("data") or "")[:600],
            "country":   m.get("location", {}).get("country_code", ""),
            "org":       m.get("org", ""),
            "hostnames": m.get("hostnames", []),
            "timestamp": m.get("timestamp", ""),
        })
    return {
        "service": "shodan", "query": q, "total": data.get("total", 0),
        "rows": rows,
    }


async def _censys(q: str, limit: int, page: int) -> dict[str, Any]:
    api_id = keychain_get_named("censys_api_id")
    secret = keychain_get_named("censys_api_secret")
    if not (api_id and secret):
        raise HTTPException(401, "censys_api_id + censys_api_secret not configured")

    # Censys uses cursor-based pagination, not pages — we'll just fetch the
    # first page (most useful). `limit` maps to per_page.
    async with httpx.AsyncClient(
        timeout=20.0, headers={"User-Agent": UA, "Accept": "application/json"},
        auth=(api_id, secret),
    ) as client:
        r = await client.post(
            "https://search.censys.io/api/v2/hosts/search",
            json={"q": q, "per_page": min(limit, 100)},
        )
    if r.status_code == 401:
        raise HTTPException(401, "Censys rejected the API id/secret")
    if not r.ok:
        try:
            detail = r.json().get("error", r.text[:200])
        except Exception:
            detail = r.text[:200]
        raise HTTPException(r.status_code, f"Censys {r.status_code}: {detail}")

    data = r.json().get("result", {})
    rows: list[dict[str, Any]] = []
    for h in data.get("hits", []):
        services = h.get("services", []) or []
        ip = h.get("ip", "")
        country = h.get("location", {}).get("country_code", "")
        org = (h.get("autonomous_system") or {}).get("name", "")
        if not services:
            rows.append({"ip": ip, "port": None, "service": "", "banner": "",
                         "country": country, "org": org, "hostnames": h.get("names", [])})
            continue
        for s in services[:10]:  # cap to avoid massive row explosions
            rows.append({
                "ip": ip,
                "port": s.get("port"),
                "service": s.get("service_name", ""),
                "banner": (s.get("banner") or "")[:600],
                "country": country,
                "org": org,
                "hostnames": h.get("names", []),
                "transport": s.get("transport_protocol", ""),
            })
    return {
        "service": "censys", "query": q,
        "total": data.get("total", len(rows)),
        "rows": rows,
    }
