"""IDOR — iterate IDs against multiple auth profiles, flag unauthorized hits.

Model:
  - One **owner** profile: the legitimate user whose IDs we expect to access.
  - One or more **attacker** profiles (no auth, or a different user's session).
  - For each ID, fire request with each profile, then compare attacker
    responses to the owner's response for the same ID. Similar response with
    different credentials = likely IDOR.

WS  /ws/idor
    client -> server:
        {"url":"...FUZZ...", "method","body","headers","cookies",
         "ids": ["1","2","3"]  | {"start":1,"end":50,"step":1},
         "owner":    {"name":"owner",   "cookies":{...}, "headers":{...}},
         "attackers":[{"name":"anon",   "cookies":{...}, "headers":{...}}, ...],
         "allow_private":false, "rate_per_sec":4,
         "confirm_auth":true}
"""
from __future__ import annotations

import asyncio
import logging
import time

import httpx
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from lib import web_fuzz
from lib.errors import ErrorCode, MhpError, ws_error
from lib.validators import validate_url

logger = logging.getLogger(__name__)

router = APIRouter(tags=["idor"])

UA = "MyHackingPal/0.1 idor"


async def fire(client: httpx.AsyncClient, tmpl: web_fuzz.FuzzTemplate,
               id_value: str, profile_headers: dict[str, str],
               profile_cookies: dict[str, str]) -> web_fuzz.FuzzResponse:
    """Send one request with a specific auth profile overriding the base."""
    rendered = tmpl.substitute(id_value)
    headers = {**rendered.headers, **profile_headers}
    cookies = {**rendered.cookies, **profile_cookies}
    method = (rendered.method or "GET").upper()
    t0 = time.monotonic()
    try:
        r = await client.request(
            method, rendered.url,
            content=rendered.body.encode() if rendered.body else None,
            headers=headers or None,
            cookies=cookies or None,
        )
        return web_fuzz.FuzzResponse(
            payload=id_value, url=str(r.url), status=r.status_code,
            elapsed_ms=int((time.monotonic() - t0) * 1000),
            length=len(r.content),
            body=r.text[:32 * 1024] if r.text is not None else "",
            headers={k.lower(): v for k, v in r.headers.items()},
        )
    except Exception as e:
        return web_fuzz.FuzzResponse(
            payload=id_value, url=rendered.url, status=None,
            elapsed_ms=int((time.monotonic() - t0) * 1000),
            length=0, body="", headers={}, error=str(e),
        )


def expand_ids(spec: object) -> list[str]:
    if isinstance(spec, list):
        return [str(x) for x in spec]
    if isinstance(spec, dict):
        s = int(spec.get("start", 1))
        e = int(spec.get("end", 10))
        step = int(spec.get("step", 1)) or 1
        return [str(i) for i in range(s, e + 1, step)]
    return []


@router.websocket("/ws/idor")
async def idor_ws(ws: WebSocket) -> None:
    await ws.accept()
    stop = asyncio.Event()

    async def listen_for_stop() -> None:
        try:
            while True:
                msg = await ws.receive_json()
                if isinstance(msg, dict) and msg.get("action") == "stop":
                    stop.set(); return
        except Exception:
            stop.set()

    try:
        init = await ws.receive_json()
        raw_url = str(init.get("url", "")).strip()
        if not raw_url:
            await ws.send_json(ws_error(ErrorCode.INVALID_URL, "url is required"))
            await ws.close(); return
        try:
            url = validate_url(raw_url, field="url")
        except MhpError as exc:
            await ws.send_json(ws_error(exc.code, exc.message))
            await ws.close(); return
        tmpl = web_fuzz.FuzzTemplate(
            url=url,
            method=str(init.get("method", "GET")).upper(),
            body=str(init.get("body", "")),
            headers=dict(init.get("headers") or {}),
            cookies=dict(init.get("cookies") or {}),
        )
        if not tmpl.has_marker():
            await ws.send_json(ws_error(
                ErrorCode.VALIDATION_ERROR,
                f"Place '{web_fuzz.DEFAULT_MARKER}' where the ID goes",
            ))
            await ws.close(); return
        if not bool(init.get("confirm_auth", False)):
            await ws.send_json(ws_error(
                ErrorCode.NEED_CONFIRM,
                "Confirm you have authorization to test this target",
                need_confirm=True,
            ))
            await ws.close(); return
        allow_private = bool(init.get("allow_private", False))
        ok, reason = web_fuzz.check_scope(url, allow_private)
        if not ok:
            await ws.send_json(ws_error(ErrorCode.TARGET_DENIED, reason))
            await ws.close(); return

        owner = init.get("owner") or {"name": "owner",
                                      "cookies": {}, "headers": {}}
        attackers = list(init.get("attackers") or [])
        if not attackers:
            # Default to anonymous attacker — no cookies, no auth header
            attackers = [{"name": "anon", "cookies": {}, "headers": {}}]
        ids = expand_ids(init.get("ids"))
        if not ids:
            await ws.send_json(ws_error(
                ErrorCode.VALIDATION_ERROR,
                "Provide ids: array, or {start,end,step}",
            ))
            await ws.close(); return

        rate = max(1, min(int(init.get("rate_per_sec", 4)), 20))
        await ws.send_json({
            "type": "started", "url": url, "id_count": len(ids),
            "owner": owner.get("name", "owner"),
            "attackers": [a.get("name", "anon") for a in attackers],
        })

        listener = asyncio.create_task(listen_for_stop())
        t0 = time.monotonic()
        findings = 0
        interval = 1.0 / rate

        async with httpx.AsyncClient(
            timeout=15.0, headers={"User-Agent": UA},
            verify=False, follow_redirects=True,
        ) as client:
            for idx, id_value in enumerate(ids):
                if stop.is_set():
                    break
                owner_r = await fire(client, tmpl, id_value,
                                     dict(owner.get("headers") or {}),
                                     dict(owner.get("cookies") or {}))
                row: dict[str, object] = {
                    "id": id_value,
                    "owner": {"status": owner_r.status,
                              "length": owner_r.length,
                              "elapsed_ms": owner_r.elapsed_ms},
                    "attackers": {},
                }
                # Only flag if owner actually got a real resource
                owner_valid = (owner_r.status is not None
                               and 200 <= owner_r.status < 300
                               and owner_r.length > 50)
                for ap in attackers:
                    if stop.is_set():
                        break
                    ar = await fire(client, tmpl, id_value,
                                    dict(ap.get("headers") or {}),
                                    dict(ap.get("cookies") or {}))
                    row["attackers"][ap.get("name", "anon")] = {
                        "status": ar.status, "length": ar.length,
                        "elapsed_ms": ar.elapsed_ms,
                    }
                    if (owner_valid and ar.status is not None
                            and 200 <= ar.status < 300
                            and web_fuzz.length_diff_pct(owner_r.length, ar.length) < 10.0):
                        findings += 1
                        await ws.send_json({
                            "type": "finding", "severity": "high",
                            "id": id_value, "attacker": ap.get("name", "anon"),
                            "evidence": (f"attacker `{ap.get('name')}` got "
                                         f"{ar.status} len={ar.length} vs owner "
                                         f"{owner_r.status} len={owner_r.length}"),
                            "confirmed": True,
                        })
                await ws.send_json({"type": "row", **row})
                if idx % 5 == 4 or idx == len(ids) - 1:
                    await ws.send_json({"type": "progress",
                                        "done": idx + 1, "total": len(ids),
                                        "findings": findings})
                await asyncio.sleep(interval)

        listener.cancel()
        await ws.send_json({"type": "done",
                            "elapsed": round(time.monotonic() - t0, 2),
                            "findings": findings, "stopped": stop.is_set()})
    except WebSocketDisconnect:
        stop.set()
    except Exception:
        logger.exception("idor_ws unhandled exception")
        try:
            await ws.send_json(ws_error(
                ErrorCode.INTERNAL,
                "internal error during IDOR scan",
            ))
        except Exception:
            pass
    finally:
        try:
            await ws.close()
        except Exception:
            pass
