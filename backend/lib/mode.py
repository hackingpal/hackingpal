"""Lab vs Engagement mode.

The frontend persists the mode flag and sends it on every request:

  * HTTP: `X-MHP-Mode: lab|engagement` header (set by `withAuthHeader`
    in `frontend/src/api.ts`).
  * WS:   `?mode=lab|engagement` query param (appended by `openWs`).

This module exposes a single resolver `get_mode(conn)` that works for
both `Request` and `WebSocket` — the rule is identical: header first,
query fallback, default to ``"lab"``. The default is deliberately
permissive: an unset or unparseable mode shouldn't lock the user out
of the app; it should drop them into the safer-by-default Lab mode.

`scope.check_combined` accepts the resolved mode and uses it to decide
whether to enforce engagement scope or short-circuit. See
`backend/lib/scope.py` for the resulting verdict matrix.
"""
from __future__ import annotations

from typing import Literal

from starlette.requests import HTTPConnection

Mode = Literal["lab", "engagement"]


def get_mode(conn: HTTPConnection) -> Mode:
    """Resolve the mode for one request/WS.

    Order of precedence:
      1. ``X-MHP-Mode`` header
      2. ``?mode=`` query param
      3. ``"lab"`` (safer default)
    """
    raw = (
        conn.headers.get("X-MHP-Mode")
        or conn.query_params.get("mode")
        or ""
    ).strip().lower()
    return "engagement" if raw == "engagement" else "lab"


def get_engagement_id(conn: HTTPConnection) -> str | None:
    """Resolve the active engagement id for one request/WS.

    Precedence mirrors `get_mode`:
      1. ``X-MHP-Engagement-Id`` header
      2. ``?engagement_id=`` query param
      3. ``None``

    Used by REST endpoints to avoid threading `engagement_id` through every
    request body. WS endpoints generally read it from the handshake init
    message instead, since that's already where per-scan options live.
    """
    raw = (
        conn.headers.get("X-MHP-Engagement-Id")
        or conn.query_params.get("engagement_id")
        or ""
    ).strip()
    return raw or None
