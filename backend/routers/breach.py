"""Breach data lookup — HaveIBeenPwned (HIBP).

Two endpoints:

  - POST /breach/password — Pwned Passwords k-anonymity range check.
    *Free, no API key.* We send only the first 5 chars of the SHA-1 hash;
    HIBP returns all matching suffixes with counts. We compare the tail
    locally so the full password (and full hash) never leaves the machine.

  - GET /breach/email/{email} — breached-account lookup.
    *Requires `hibp_api_key` from Keychain*, paid ($3.95/month for HIBP API).
"""
from __future__ import annotations

import hashlib
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .settings import keychain_get_named

router = APIRouter(prefix="/breach", tags=["breach"])

HIBP_BASE = "https://haveibeenpwned.com/api/v3"
PWND_PWD_BASE = "https://api.pwnedpasswords.com"
UA = "MyHackingPal/0.1 breach-lookup"


class PasswordCheck(BaseModel):
    password: str = Field(..., min_length=1)


@router.post("/password")
async def password_check(body: PasswordCheck) -> dict[str, Any]:
    """k-anonymity: SHA-1 the password, send first 5 chars, compare tail locally.

    No API key needed. The full password never crosses the network.
    """
    full = hashlib.sha1(body.password.encode("utf-8")).hexdigest().upper()
    prefix, suffix = full[:5], full[5:]
    try:
        async with httpx.AsyncClient(
            timeout=10.0, headers={"User-Agent": UA, "Add-Padding": "true"},
        ) as client:
            r = await client.get(f"{PWND_PWD_BASE}/range/{prefix}")
        r.raise_for_status()
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Pwned Passwords request failed: {e}")

    count = 0
    for line in r.text.splitlines():
        parts = line.strip().split(":")
        if len(parts) != 2:
            continue
        if parts[0].upper() == suffix:
            try:
                count = int(parts[1])
            except ValueError:
                count = 0
            break
    return {
        "pwned":  count > 0,
        "count":  count,
        "prefix": prefix,
        # We intentionally do NOT return the full hash, just to make it obvious
        # this is the k-anonymity flow.
    }


@router.get("/email/{email}")
async def email_check(email: str, truncate: bool = False) -> dict[str, Any]:
    key = keychain_get_named("hibp_api_key")
    if not key:
        raise HTTPException(
            401,
            "HIBP API key not set. Add one via "
            "`POST /settings/keys/hibp_api_key` (paid, $3.95/month).",
        )
    headers = {
        "hibp-api-key": key,
        "User-Agent":   UA,
    }
    url = f"{HIBP_BASE}/breachedaccount/{quote(email)}?truncateResponse=" \
          f"{'true' if truncate else 'false'}"
    try:
        async with httpx.AsyncClient(timeout=15.0, headers=headers) as client:
            r = await client.get(url)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"HIBP request failed: {e}")

    # HIBP returns 404 when the account isn't in any breach (intentional design)
    if r.status_code == 404:
        return {"email": email, "breaches": [], "count": 0}
    if r.status_code == 401:
        raise HTTPException(401, "HIBP rejected the API key.")
    if r.status_code == 429:
        retry = r.headers.get("retry-after", "")
        raise HTTPException(429, f"HIBP rate-limited; retry after {retry}s")
    if not r.ok:
        raise HTTPException(r.status_code, f"HIBP returned {r.status_code}")

    data = r.json()
    return {"email": email, "breaches": data, "count": len(data)}


@router.get("/status")
def status() -> dict[str, Any]:
    return {
        "password_check": True,            # always available (free k-anonymity)
        "email_check_available": keychain_get_named("hibp_api_key") is not None,
    }
