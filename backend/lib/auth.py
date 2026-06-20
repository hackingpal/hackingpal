"""Per-process auth token for privileged loopback endpoints.

The token is generated once at import time (i.e. once per backend launch)
and lives only in memory — it rotates every launch, so a stale token from
a previous run cannot be replayed.

Two FastAPI dependencies are exposed:

* `require_localhost` — accept only requests whose `client.host`
  is the IPv4/IPv6 loopback address. Used on `/auth/token` so the
  Electron renderer (which is the only thing that ever reaches the
  backend over loopback) can fetch the token without already possessing it.

* `require_local_auth` — same loopback check *plus* a constant-time
  comparison against the token. Used on endpoints that shell out /
  install sudoers entries / run privileged tools.

Both dependencies accept any `HTTPConnection` (the common parent of
`Request` and `WebSocket`), so the same function works for HTTP and WS
routes. For WS routes the token is read from the `?token=` query param
since browsers can't set custom headers on a WebSocket upgrade.
"""
from __future__ import annotations

import secrets

from fastapi import HTTPException, WebSocketException, status
from starlette.requests import HTTPConnection
from starlette.websockets import WebSocket

# Loopback addresses we trust. ::1 covers IPv6 loopback in case uvicorn is
# ever started with --host ::1 in development.
_LOOPBACK_HOSTS = {"127.0.0.1", "::1"}

# Rotated every launch. Module-level on purpose: a single import yields a
# single token for the lifetime of the process.
AUTH_TOKEN: str = secrets.token_hex(32)


def _is_loopback(conn: HTTPConnection) -> bool:
    client = conn.client
    return bool(client and client.host in _LOOPBACK_HOSTS)


def _reject(conn: HTTPConnection, detail: str) -> None:
    if isinstance(conn, WebSocket):
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason=detail)
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def require_localhost(conn: HTTPConnection) -> None:
    """Reject anything that didn't come over loopback."""
    if not _is_loopback(conn):
        _reject(conn, "local access only")


def require_local_auth(conn: HTTPConnection) -> None:
    """Loopback + token check for privileged endpoints.

    HTTP: token is read from the `X-MHP-Token` header.
    WS:   token is read from the `?token=` query param (header fallback
          still accepted for completeness).
    """
    if not _is_loopback(conn):
        _reject(conn, "local access only")
    presented = conn.headers.get("X-MHP-Token") or conn.query_params.get("token", "")
    if not presented or not secrets.compare_digest(presented, AUTH_TOKEN):
        _reject(conn, "missing or invalid X-MHP-Token")
