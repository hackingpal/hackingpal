"""Preset (playbook) engine — load `.mhp` JSON files and run them in-process.

Each step in a preset invokes one tool. We avoid HTTP round-trips by calling
the router's own logic directly. For sync-style tools (whois, tls_audit) we
just `await` the handler. For WebSocket-based tools (port_scanner, http_probe)
we drive them with a fake WebSocket that buffers their `send_json` events
into an asyncio queue — no router refactoring required.

The engine streams a uniform set of events back to its caller:

    {"type": "preset_start",  "preset": "<id>", "target": "<str>", "step_count": N}
    {"type": "step_start",    "step": "<step_id>", "tool": "<tool>", "index": i}
    {"type": "step_progress", "step": "...", "msg": "..."}   # opaque, tool-specific
    {"type": "finding",       "severity": "...", "title": "...", "detail": "...",
                              "step": "...", "evidence": {...}}
    {"type": "step_result",   "step": "...", "summary": {...}}
    {"type": "step_done",     "step": "...", "status": "ok|error|stopped",
                              "elapsed": <sec>, "detail": "<if error>"}
    {"type": "done",          "elapsed": <sec>, "findings_total": N, "stopped": bool}
    {"type": "error",         "detail": "<fatal engine error>"}

Adapters live in `_TOOL_ADAPTERS`. Adding a tool is one new async function
that returns a `dict` (summary). Findings should be yielded via `emit()`.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable

BUILTIN_DIR = Path(__file__).resolve().parent.parent / "presets"
USER_DIR = Path.home() / ".myhackingpal" / "user_presets"

EmitFn = Callable[[dict[str, Any]], Awaitable[None]]


class PresetError(Exception):
    """Raised for malformed presets or missing tools."""


# ─────────────────────────────────────────────────────────────────────────────
# Schema
# ─────────────────────────────────────────────────────────────────────────────

REQUIRED_FIELDS = {"id", "name", "steps"}
ALLOWED_TARGET_TYPES = {"domain", "ip", "cidr", "url", "host"}


def _validate(d: dict[str, Any]) -> None:
    missing = REQUIRED_FIELDS - d.keys()
    if missing:
        raise PresetError(f"preset missing required fields: {sorted(missing)}")
    if not isinstance(d["steps"], list) or not d["steps"]:
        raise PresetError("preset must have a non-empty `steps` array")
    seen_ids: set[str] = set()
    for i, s in enumerate(d["steps"]):
        if not isinstance(s, dict):
            raise PresetError(f"step #{i} is not an object")
        if "id" not in s or "tool" not in s:
            raise PresetError(f"step #{i} missing `id` or `tool`")
        if s["id"] in seen_ids:
            raise PresetError(f"duplicate step id: {s['id']!r}")
        seen_ids.add(s["id"])
        if s["tool"] not in _TOOL_ADAPTERS:
            raise PresetError(
                f"step #{i} ({s['id']!r}): unknown tool {s['tool']!r}. "
                f"Known tools: {sorted(_TOOL_ADAPTERS)}",
            )
    if d.get("target_type") and d["target_type"] not in ALLOWED_TARGET_TYPES:
        raise PresetError(f"unknown target_type: {d['target_type']!r}")


# ─────────────────────────────────────────────────────────────────────────────
# Library
# ─────────────────────────────────────────────────────────────────────────────

def _load_dir(dir_path: Path, author: str) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    if not dir_path.exists():
        return out
    for f in sorted(dir_path.glob("*.mhp")):
        try:
            d = json.loads(f.read_text())
        except Exception as e:
            print(f"[presets] skipping {f.name}: {e}")
            continue
        d.setdefault("author", author)
        d["_builtin"] = (author == "built-in")
        d["_path"] = str(f)
        try:
            _validate(d)
        except PresetError as e:
            print(f"[presets] skipping {f.name}: {e}")
            continue
        out[d["id"]] = d
    return out


def list_presets() -> list[dict[str, Any]]:
    """Return all presets (built-in + user) as summary dicts."""
    presets = {**_load_dir(BUILTIN_DIR, "built-in"),
               **_load_dir(USER_DIR, "user")}
    summaries: list[dict[str, Any]] = []
    for p in presets.values():
        summaries.append({
            "id": p["id"], "name": p["name"],
            "description": p.get("description", ""),
            "target_type": p.get("target_type", "domain"),
            "author": p.get("author", ""),
            "step_count": len(p["steps"]),
            "builtin": p["_builtin"],
        })
    summaries.sort(key=lambda s: (not s["builtin"], s["name"]))
    return summaries


def get_preset(pid: str) -> dict[str, Any] | None:
    p = _load_dir(BUILTIN_DIR, "built-in").get(pid) or \
        _load_dir(USER_DIR, "user").get(pid)
    return p


def save_preset(definition: dict[str, Any]) -> dict[str, Any]:
    """Persist a user preset (not built-in). Allocates an id if missing."""
    USER_DIR.mkdir(parents=True, exist_ok=True)
    if "id" not in definition or not str(definition["id"]).strip():
        definition["id"] = f"custom_{uuid.uuid4().hex[:8]}"
    definition.setdefault("author", "user")
    _validate(definition)
    if (BUILTIN_DIR / f"{definition['id']}.mhp").exists():
        raise PresetError(
            f"cannot overwrite built-in preset {definition['id']!r}",
        )
    path = USER_DIR / f"{definition['id']}.mhp"
    path.write_text(json.dumps(definition, indent=2))
    return {"id": definition["id"], "path": str(path)}


def delete_preset(pid: str) -> bool:
    path = USER_DIR / f"{pid}.mhp"
    if not path.exists():
        return False
    path.unlink()
    return True


# ─────────────────────────────────────────────────────────────────────────────
# WebSocket adapter — drive a WS-based router handler in-process
# ─────────────────────────────────────────────────────────────────────────────

class _LocalWS:
    """Minimal stand-in for a FastAPI WebSocket. The router handler calls
    accept/receive_json/send_json/close on us; we buffer outbound messages
    so the caller can iterate them as events.

    On `receive_json`, the first call returns the handshake init we were
    constructed with. Subsequent calls block until the stop_event fires,
    then return a `{"action": "stop"}` so the handler's stop-listener
    co-routine exits cleanly.
    """

    def __init__(self, init: dict[str, Any], stop_event: asyncio.Event) -> None:
        self._init = init
        self._init_sent = False
        self._stop = stop_event
        self._out: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        self.closed = False

    async def accept(self) -> None:  # noqa: D401
        return None

    async def receive_json(self) -> dict[str, Any]:
        if not self._init_sent:
            self._init_sent = True
            return self._init
        # Hold until stop or until the handler is cancelled by the caller.
        await self._stop.wait()
        return {"action": "stop"}

    async def send_json(self, msg: dict[str, Any]) -> None:
        await self._out.put(msg)

    async def close(self, code: int = 1000) -> None:
        self.closed = True
        await self._out.put(None)  # sentinel

    async def events(self):
        while True:
            ev = await self._out.get()
            if ev is None:
                return
            yield ev


async def _drive_ws(handler_coro_factory, init: dict[str, Any],
                    emit: EmitFn, stop_event: asyncio.Event,
                    *, on_event=None) -> dict[str, Any]:
    """Run a WS-based router handler in-process. Returns whatever the
    `on_event` callback accumulates into a `summary` dict (or `{}`).

    `handler_coro_factory(ws)` returns the awaitable for the router handler.
    `on_event(ev, summary)` is called for each outbound event; it may mutate
    `summary` and/or call `emit(...)` to forward selected events to the
    preset's caller.
    """
    ws = _LocalWS(init, stop_event)
    summary: dict[str, Any] = {}
    handler_task = asyncio.create_task(handler_coro_factory(ws))
    try:
        async for ev in ws.events():
            if on_event:
                await on_event(ev, summary)
        # Drain the handler (it may already be done)
        try:
            await handler_task
        except Exception:
            pass
    finally:
        if not handler_task.done():
            handler_task.cancel()
            try:
                await handler_task
            except (asyncio.CancelledError, Exception):
                pass
    return summary


# ─────────────────────────────────────────────────────────────────────────────
# Adapters — each takes (target, options, context, emit, stop_event) → summary
# ─────────────────────────────────────────────────────────────────────────────

async def _adapter_whois(target: str, options: dict[str, Any],
                         context: dict[str, Any], emit: EmitFn,
                         stop_event: asyncio.Event) -> dict[str, Any]:
    from routers import whois as r
    try:
        result = await r.whois_lookup(target)
    except Exception as e:
        raise PresetError(f"whois: {e}") from e
    # Surface findings that the router already produced
    for f in result.get("findings", []) or []:
        await emit({
            "type": "finding", "step": "whois",
            "severity": f.get("severity", "info"),
            "title": f.get("label") or f.get("title", "whois finding"),
            "detail": f.get("detail", ""),
        })
    return {
        "asn": result.get("asn", {}),
        "domain": result.get("domain", {}),
        "network": result.get("network", {}),
        "resolved_ip": result.get("resolved_ip"),
        "policy": result.get("policy", {}),
    }


async def _adapter_tls_audit(target: str, options: dict[str, Any],
                             context: dict[str, Any], emit: EmitFn,
                             stop_event: asyncio.Event) -> dict[str, Any]:
    from routers import tls_audit as r
    port = int(options.get("port", 443))
    try:
        result = await r.tls_audit(target, port=port)
    except Exception as e:
        raise PresetError(f"tls_audit: {e}") from e
    for f in result.get("findings", []) or []:
        await emit({
            "type": "finding", "step": "tls_audit",
            "severity": f.get("severity", "info"),
            "title": f.get("label") or f.get("title", "TLS finding"),
            "detail": f.get("detail", ""),
        })
    return {
        "host": result.get("host"), "port": result.get("port"),
        "ip": result.get("ip"),
        "expiry_days": (result.get("cert") or {}).get("days_until_expiry"),
        "negotiated": result.get("negotiated_cipher"),
        "policy": result.get("policy", {}),
    }


async def _adapter_port_scanner(target: str, options: dict[str, Any],
                                context: dict[str, Any], emit: EmitFn,
                                stop_event: asyncio.Event) -> dict[str, Any]:
    from routers import port_scanner as r
    init = {
        "target": target,
        "ports":   options.get("ports", "1-1024"),
        "timeout": float(options.get("timeout", 0.5)),
        "threads": int(options.get("threads", 200)),
    }
    open_ports: list[dict[str, Any]] = []

    async def on_event(ev: dict[str, Any], summary: dict[str, Any]) -> None:
        t = ev.get("type")
        if t == "open":
            entry = {"port": ev["port"],
                     "service": ev.get("service", ""),
                     "banner": ev.get("banner", "")[:200]}
            open_ports.append(entry)
            await emit({
                "type": "finding", "step": "port_scanner",
                "severity": "medium" if ev["port"] in (21, 23, 25, 110, 143,
                                                       3389, 5900) else "info",
                "title": f"Open port {ev['port']}/tcp",
                "detail": f"{ev.get('service','')} — {entry['banner']}",
            })
        elif t == "progress":
            await emit({"type": "step_progress", "step": "port_scanner",
                        "msg": f"{ev['done']}/{ev['total']} probed"})
        elif t == "error":
            raise PresetError(f"port_scanner: {ev.get('detail','')}")

    await _drive_ws(r.port_scan_ws, init, emit, stop_event, on_event=on_event)
    return {"open_count": len(open_ports), "open_ports": open_ports}


async def _adapter_http_probe(target: str, options: dict[str, Any],
                              context: dict[str, Any], emit: EmitFn,
                              stop_event: asyncio.Event) -> dict[str, Any]:
    from routers import http_probe as r
    # Build a usable URL — if target doesn't include a scheme, assume http(s).
    # Prefer https; the probe handles redirects on its own.
    url = target.strip()
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    init = {
        "url": url,
        "wordlist": options.get("wordlist", "small"),
        "max_concurrency": int(options.get("max_concurrency", 16)),
        "confirm": True,    # presets imply user already authorized via UI checkbox
    }
    hit_count = 0

    async def on_event(ev: dict[str, Any], summary: dict[str, Any]) -> None:
        nonlocal hit_count
        t = ev.get("type")
        if t == "finding":
            await emit({
                "type": "finding", "step": "http_probe",
                "severity": ev.get("severity", "info"),
                "title": ev.get("label", "HTTP finding"),
                "detail": ev.get("detail", ""),
            })
        elif t == "hit":
            hit_count += 1
            await emit({
                "type": "finding", "step": "http_probe",
                "severity": "low",
                "title": f"Discovered path: {ev.get('path','')}",
                "detail": f"HTTP {ev.get('status','?')} · "
                          f"len={ev.get('length','?')}",
            })
        elif t == "progress":
            await emit({"type": "step_progress", "step": "http_probe",
                        "msg": f"{ev['done']}/{ev['total']} paths"})
        elif t == "error":
            raise PresetError(f"http_probe: {ev.get('detail','')}")

    await _drive_ws(r.http_probe_ws, init, emit, stop_event, on_event=on_event)
    return {"hits": hit_count, "url": url}


_TOOL_ADAPTERS: dict[str, Callable[..., Awaitable[dict[str, Any]]]] = {
    "whois":         _adapter_whois,
    "tls_audit":     _adapter_tls_audit,
    "port_scanner":  _adapter_port_scanner,
    "http_probe":    _adapter_http_probe,
}


def known_tools() -> list[str]:
    return sorted(_TOOL_ADAPTERS)


# ─────────────────────────────────────────────────────────────────────────────
# Runner
# ─────────────────────────────────────────────────────────────────────────────

async def run_preset(preset_id: str, target: str, emit: EmitFn,
                     stop_event: asyncio.Event) -> None:
    """Execute a preset, streaming events via `emit`.

    Honors `stop_event`: between steps we exit cleanly; during a step,
    individual adapters poll the same flag to stop their inner work.
    """
    preset = get_preset(preset_id)
    if not preset:
        await emit({"type": "error", "detail": f"unknown preset: {preset_id!r}"})
        return
    target = (target or "").strip()
    if not target:
        await emit({"type": "error", "detail": "target is required"})
        return

    steps = preset["steps"]
    t0 = time.monotonic()
    findings_total = 0

    # Wrap the caller's emit so we can count findings on the way through
    async def counted_emit(ev: dict[str, Any]) -> None:
        nonlocal findings_total
        if ev.get("type") == "finding":
            findings_total += 1
        await emit(ev)

    await counted_emit({
        "type": "preset_start",
        "preset": preset["id"], "target": target,
        "step_count": len(steps),
    })

    context: dict[str, Any] = {}
    stopped = False

    for i, step in enumerate(steps):
        if stop_event.is_set():
            stopped = True
            break

        sid = step["id"]
        tool = step["tool"]
        opts = step.get("options", {}) or {}
        adapter = _TOOL_ADAPTERS.get(tool)

        await counted_emit({
            "type": "step_start", "step": sid, "tool": tool, "index": i,
        })
        s_start = time.monotonic()
        try:
            if adapter is None:
                raise PresetError(f"no adapter for tool {tool!r}")
            summary = await adapter(target, opts, context, counted_emit, stop_event)
            context[sid] = summary
            await counted_emit({
                "type": "step_result", "step": sid, "summary": summary,
            })
            await counted_emit({
                "type": "step_done", "step": sid, "status": "ok",
                "elapsed": round(time.monotonic() - s_start, 2),
            })
        except asyncio.CancelledError:
            stopped = True
            await counted_emit({
                "type": "step_done", "step": sid, "status": "stopped",
                "elapsed": round(time.monotonic() - s_start, 2),
            })
            break
        except Exception as e:
            await counted_emit({
                "type": "step_done", "step": sid, "status": "error",
                "elapsed": round(time.monotonic() - s_start, 2),
                "detail": f"{type(e).__name__}: {e}"[:300],
            })
            # Continue to the next step on error — one tool blowing up
            # shouldn't kill the whole run. (Could be made configurable.)
            continue

    await counted_emit({
        "type": "done",
        "elapsed": round(time.monotonic() - t0, 2),
        "findings_total": findings_total,
        "stopped": stopped,
    })
