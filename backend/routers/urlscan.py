"""URLScan.io OSINT — free search of existing public scans.

We never *submit* scans here (that would create a publicly visible scan
on urlscan.io for the target — a footprint the user might not want).
Search-only via the no-auth public endpoint.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Query

from lib.auth import require_local_auth
from lib.errors import ErrorCode, MhpError
from lib.validators import validate_domain

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/osint", tags=["urlscan"],
                   dependencies=[Depends(require_local_auth)])

UA = "MyHackingPal/0.1 urlscan"
TIMEOUT = 15.0


@router.get("/urlscan/{domain}")
async def search(
    domain: str,
    size: int = Query(50, ge=1, le=100),
) -> dict[str, Any]:
    d = validate_domain(domain, field="domain")
    async with httpx.AsyncClient(
        timeout=TIMEOUT, headers={"User-Agent": UA},
        follow_redirects=True,
    ) as client:
        try:
            r = await client.get(
                "https://urlscan.io/api/v1/search/",
                params={"q": f"domain:{d}", "size": size},
            )
        except httpx.HTTPError as e:
            raise MhpError(
                f"URLScan request failed: {e}",
                code=ErrorCode.UPSTREAM_FAILED,
                status_code=502,
            ) from None
    if r.status_code == 429:
        raise MhpError(
            "URLScan rate-limited; try again in a minute",
            code=ErrorCode.RATE_LIMITED,
            status_code=429,
        )
    if not r.ok:
        raise MhpError(
            f"URLScan returned {r.status_code}",
            code=ErrorCode.UPSTREAM_FAILED,
            status_code=502,
        )
    data = r.json()
    rows: list[dict[str, Any]] = []
    for hit in data.get("results", []):
        page = hit.get("page", {}) or {}
        task = hit.get("task", {}) or {}
        verdicts = (hit.get("verdicts") or {}).get("overall") or {}
        rows.append({
            "id":          hit.get("_id", ""),
            "url":         page.get("url", ""),
            "domain":      page.get("domain", ""),
            "ip":          page.get("ip", ""),
            "country":     page.get("country", ""),
            "server":      page.get("server", ""),
            "screenshot":  hit.get("screenshot", ""),
            "result_url":  task.get("reportURL", ""),
            "submitted":   task.get("time", ""),
            "malicious":   bool(verdicts.get("malicious", False)),
            "score":       verdicts.get("score", 0),
            "tags":        (hit.get("brand") or []),
        })
    return {
        "domain":    d,
        "count":     len(rows),
        "total":     data.get("total", len(rows)),
        "malicious": sum(1 for r in rows if r["malicious"]),
        "results":   rows,
    }
