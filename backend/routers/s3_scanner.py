"""S3 Bucket Scanner — permutation-based public bucket finder.

Given a target name (e.g. "acme"), generate plausible bucket names by combining
the target with common prefixes/suffixes (acme-prod, acme-backup, prod-acme,
acme-logs, acme1, etc.), then HEAD each against s3.amazonaws.com. Result
classifications:

  - 200/206         → bucket exists, listable (public)
  - 403             → bucket exists, listing forbidden (private but enumerable)
  - 404/NoSuchBucket → does not exist
  - 301             → exists in a different region

WS  /ws/s3-scan
    client -> server:
        {"target":"acme","extra_keywords":["data","internal"],
         "rate_per_sec":10}

    server -> client:
        {"type":"started",  "target","total"}
        {"type":"bucket",   "name","status","exists","listable","region"?,"hint"?}
        {"type":"progress", "done","total","found"}
        {"type":"done",     "elapsed","found","listable","stopped"}
        {"type":"error",    "detail"}
"""
from __future__ import annotations

import asyncio
import re
import time

import httpx
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["s3-scanner"])

# Common bucket-naming patterns. Each one is templated with the target.
PERMUTATIONS = [
    "{t}",                "{t}-prod",            "{t}-production",
    "{t}-dev",            "{t}-development",     "{t}-staging",
    "{t}-stage",          "{t}-test",            "{t}-qa",
    "{t}-internal",       "{t}-corp",            "{t}-private",
    "{t}-public",         "{t}-www",             "{t}-static",
    "{t}-assets",         "{t}-cdn",             "{t}-media",
    "{t}-images",         "{t}-img",             "{t}-files",
    "{t}-data",           "{t}-database",        "{t}-db",
    "{t}-backup",         "{t}-backups",         "{t}-bak",
    "{t}-logs",           "{t}-log",             "{t}-archive",
    "{t}-upload",         "{t}-uploads",         "{t}-downloads",
    "{t}-temp",           "{t}-tmp",             "{t}-old",
    "{t}-new",             "{t}-share",           "{t}-shared",
    "{t}-data1",          "{t}-data2",
    "{t}1",               "{t}2",                "{t}3",
    "{t}-1",              "{t}-2",               "{t}-3",
    "{t}-2024",           "{t}-2025",            "{t}-2026",
    # Reversed
    "prod-{t}",           "dev-{t}",             "staging-{t}",
    "backup-{t}",         "backups-{t}",         "logs-{t}",
    "data-{t}",           "internal-{t}",        "static-{t}",
    "assets-{t}",         "media-{t}",
    "files-{t}",          "uploads-{t}",         "downloads-{t}",
    # No separator
    "{t}prod",            "{t}dev",              "{t}backup",
    "{t}logs",            "{t}data",
]

UA = "MyHackingPal/0.1 s3-scanner"


def generate_names(target: str, extra_keywords: list[str]) -> list[str]:
    target = target.strip().lower()
    seen: set[str] = set()
    names: list[str] = []

    # Base permutations
    for tpl in PERMUTATIONS:
        n = tpl.format(t=target)
        if _valid_bucket_name(n) and n not in seen:
            seen.add(n); names.append(n)

    # Extra keyword permutations
    for kw in extra_keywords:
        kw = kw.strip().lower()
        if not kw:
            continue
        for tpl in (
            "{t}-{kw}", "{kw}-{t}", "{t}{kw}", "{kw}{t}",
            "{t}-{kw}-prod", "{t}-{kw}-dev",
        ):
            n = tpl.format(t=target, kw=kw)
            if _valid_bucket_name(n) and n not in seen:
                seen.add(n); names.append(n)

    return names


_S3_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]$")


def _valid_bucket_name(name: str) -> bool:
    if len(name) < 3 or len(name) > 63:
        return False
    if not _S3_NAME_RE.match(name):
        return False
    if ".." in name or ".-" in name or "-." in name:
        return False
    return True


def _classify(status: int, body: str) -> tuple[bool, bool, str | None, str | None]:
    """Return (exists, listable, region_hint, finding_hint)."""
    if status in (200, 206):
        return True, True, None, "Bucket is publicly listable"
    if status == 403:
        return True, False, None, "Bucket exists (listing forbidden)"
    if status in (301, 307):
        m = re.search(r"<Endpoint>([^<]+)</Endpoint>", body or "")
        if m:
            return True, False, m.group(1), "Bucket exists in a different region"
        return True, False, None, "Bucket exists, redirected"
    if status == 404 or "NoSuchBucket" in (body or ""):
        return False, False, None, None
    return False, False, None, None


@router.websocket("/ws/s3-scan")
async def s3_ws(ws: WebSocket) -> None:
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
        target = str(init.get("target", "")).strip().lower()
        extra = list(init.get("extra_keywords") or [])
        rate = max(1, min(int(init.get("rate_per_sec", 10)), 30))

        if not target or not _valid_bucket_name(target.replace("_", "-")):
            await ws.send_json({"type": "error", "detail":
                "target must look like a bucket-name fragment (3-63 chars, lowercase letters/digits/hyphens)"})
            await ws.close(); return

        names = generate_names(target, extra)
        total = len(names)
        await ws.send_json({"type": "started", "target": target, "total": total})

        listener = asyncio.create_task(listen_for_stop())
        t0 = time.monotonic()
        done = 0
        found = 0
        listable = 0
        interval = 1.0 / rate

        async with httpx.AsyncClient(
            timeout=10.0, headers={"User-Agent": UA},
            follow_redirects=False, verify=False,
        ) as client:
            for name in names:
                if stop.is_set():
                    break
                # HEAD doesn't return the body needed for region detection,
                # so we use GET with a Range trick (or just GET, ~6KB).
                try:
                    r = await client.get(f"https://{name}.s3.amazonaws.com/")
                    status, body = r.status_code, r.text
                except Exception:
                    status, body = 0, ""
                done += 1
                exists, is_listable, region, hint = _classify(status, body)
                if exists:
                    found += 1
                    if is_listable:
                        listable += 1
                await ws.send_json({
                    "type": "bucket", "name": name, "status": status,
                    "exists": exists, "listable": is_listable,
                    "region": region, "hint": hint,
                })
                if done % 5 == 0 or done == total:
                    await ws.send_json({"type": "progress",
                                        "done": done, "total": total,
                                        "found": found})
                await asyncio.sleep(interval)

        listener.cancel()
        await ws.send_json({"type": "done",
                            "elapsed": round(time.monotonic() - t0, 2),
                            "found": found, "listable": listable,
                            "stopped": stop.is_set()})
    except WebSocketDisconnect:
        stop.set()
    except Exception as exc:
        try:
            await ws.send_json({"type": "error", "detail": f"{type(exc).__name__}: {exc}"})
        except Exception:
            pass
    finally:
        try:
            await ws.close()
        except Exception:
            pass
