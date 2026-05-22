"""Per-process auth token for privileged loopback endpoints.

The token is generated once at import time (i.e. once per backend launch)
and lives only in memory — it rotates every launch, so a stale token from
a previous run cannot be replayed.

Two FastAPI dependencies are exposed:

* `require_localhost` — accept only requests whose `request.client.host`
  is the IPv4/IPv6 loopback address. Used on `/auth/token` so the
  Electron renderer (which is the only thing that ever reaches the
  backend over loopback) can fetch the token without already possessing it.

* `require_local_auth` — same loopback check *plus* a constant-time
  comparison against the `X-MHP-Token` header. Used on endpoints that
  shell out / install sudoers entries / toggle the VPN.
"""
from __future__ import annotations

import secrets

from fastapi import HTTPException, Request, status

# Loopback addresses we trust. ::1 covers IPv6 loopback in case uvicorn is
# ever started with --host ::1 in development.
_LOOPBACK_HOSTS = {"127.0.0.1", "::1"}

# Rotated every launch. Module-level on purpose: a single import yields a
# single token for the lifetime of the process.
AUTH_TOKEN: str = secrets.token_hex(32)


def _is_loopback(request: Request) -> bool:
    client = request.client
    return bool(client and client.host in _LOOPBACK_HOSTS)


def require_localhost(request: Request) -> None:
    """Reject anything that didn't come over loopback."""
    if not _is_loopback(request):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="local access only",
        )


def require_local_auth(request: Request) -> None:
    """Loopback + X-MHP-Token check for privileged endpoints."""
    if not _is_loopback(request):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="local access only",
        )
    presented = request.headers.get("X-MHP-Token", "")
    if not presented or not secrets.compare_digest(presented, AUTH_TOKEN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="missing or invalid X-MHP-Token",
        )
