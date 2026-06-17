"""Nmap — full-surface scanner with NSE, multi-target, and live streaming.

REST:
    GET  /nmap/status                  — binary path, version, scripts dir,
                                          sudoers state for passwordless privileged scans
    POST /nmap/install                 — install one-time passwordless sudoers entry
    POST /nmap/revoke                  — remove the sudoers entry (admin prompt)
    GET  /nmap/scripts                 — NSE catalog [{name, categories}]
    GET  /nmap/script-help?name=...    — `nmap --script-help <name>` text
    GET  /nmap/policy?target=...       — target policy verdict for a single target

WS (`/ws/nmap`):
    client -> server:
        {"opts": { ...NmapOptions... }, "confirm": false}
        {"action": "stop"}

    server -> client:
        {"type": "policy", "verdicts": [{target, verdict, reason}, ...]}
        {"type": "started",  "cmd": "...", "argv": [...], "xml_path": "..."}
        {"type": "line",     "text": "..."}
        {"type": "progress", "pct": 12.3, "hosts_done": 2, "hosts_up": 1}
        {"type": "stderr",   "text": "..."}
        {"type": "done",     "rc": 0, "stopped": false, "report": {...}}
        {"type": "error",    "detail": "...", "need_confirm": bool}
"""
from __future__ import annotations

import asyncio
import getpass
import logging
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect

from lib import audit_log, hids_notify, nmap_runner, nmap_scripts, scope, target_policy
from lib.auth import require_local_auth
from lib.errors import ErrorCode, MhpError, ws_error
from lib.mode import get_mode
from lib.validators import MAX_TARGET_LEN, validate_target

logger = logging.getLogger(__name__)

router = APIRouter(tags=["nmap"], dependencies=[Depends(require_local_auth)])

SUDOERS_PATH = "/etc/sudoers.d/network-tools-nmap"


def _resolved_binary() -> str:
    b = nmap_runner.find_nmap()
    if not b:
        raise MhpError(
            "nmap binary not found",
            code=ErrorCode.TOOL_MISSING,
            status_code=503,
        )
    return b


def _is_passwordless(binary: str) -> bool:
    try:
        r = subprocess.run(
            ["sudo", "-n", binary, "--version"],
            capture_output=True, timeout=3,
        )
        return r.returncode == 0
    except Exception:
        return False


@router.get("/nmap/status")
def status() -> dict[str, Any]:
    binary = nmap_runner.find_nmap()
    if not binary:
        return {
            "available": False, "binary": "", "version": "",
            "scripts_dir": "", "scripts_count": 0,
            "passwordless": False, "sudoers_path": SUDOERS_PATH,
            "user": getpass.getuser(),
        }
    sdir = nmap_runner.scripts_dir(binary) or ""
    scount = 0
    if sdir:
        try:
            scount = sum(1 for _ in Path(sdir).glob("*.nse"))
        except Exception:
            scount = 0
    return {
        "available": True,
        "binary": binary,
        "version": nmap_runner.nmap_version(binary),
        "scripts_dir": sdir,
        "scripts_count": scount,
        "passwordless": _is_passwordless(binary),
        "sudoers_path": SUDOERS_PATH,
        "user": getpass.getuser(),
    }


@router.post("/nmap/install")
def install_sudoers() -> dict[str, Any]:
    """Drop a `<user> ALL=(root) NOPASSWD: <nmap>` entry.

    Uses the OS-native admin prompt: osascript on macOS, pkexec (polkit) on
    Linux. Returns whether the install succeeded.
    """
    binary = _resolved_binary()
    if _is_passwordless(binary):
        return {"installed": True, "already": True}

    user = getpass.getuser()
    tmp = Path(tempfile.gettempdir()) / "_nt_nmap_sudoers"
    tmp.write_text(f"{user} ALL=(root) NOPASSWD: {binary}\n")

    if sys.platform == "darwin":
        install_cmd = (
            f"/usr/sbin/visudo -cf {shlex.quote(str(tmp))} && "
            f"/bin/mv {shlex.quote(str(tmp))} {shlex.quote(SUDOERS_PATH)} && "
            f"/usr/sbin/chown root:wheel {shlex.quote(SUDOERS_PATH)} && "
            f"/bin/chmod 0440 {shlex.quote(SUDOERS_PATH)}"
        )
        script = f'do shell script "{install_cmd}" with administrator privileges'
        try:
            r = subprocess.run(["osascript", "-e", script],
                               capture_output=True, text=True, timeout=120)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
        if r.returncode != 0:
            err = (r.stderr or "").strip()
            if "-128" in err or "canceled" in err.lower() or "cancelled" in err.lower():
                raise HTTPException(status_code=400, detail="install cancelled by user")
            raise HTTPException(status_code=500, detail=err or "install failed")
        return {"installed": _is_passwordless(binary)}

    if sys.platform.startswith("linux"):
        pkexec = shutil.which("pkexec")
        if not pkexec:
            raise HTTPException(
                status_code=501,
                detail=("pkexec not installed. Install policykit-1 (Debian/Ubuntu) "
                        "or polkit (RHEL/Arch), or add a sudoers entry manually: "
                        f"echo '{user} ALL=(root) NOPASSWD: {binary}' "
                        f"| sudo tee {SUDOERS_PATH} && "
                        f"sudo chmod 0440 {SUDOERS_PATH}"),
            )
        visudo = shutil.which("visudo") or "/usr/sbin/visudo"
        install_cmd = (
            f"{shlex.quote(visudo)} -cf {shlex.quote(str(tmp))} && "
            f"/bin/mv {shlex.quote(str(tmp))} {shlex.quote(SUDOERS_PATH)} && "
            f"/bin/chown root:root {shlex.quote(SUDOERS_PATH)} && "
            f"/bin/chmod 0440 {shlex.quote(SUDOERS_PATH)}"
        )
        try:
            r = subprocess.run(
                [pkexec, "/bin/sh", "-c", install_cmd],
                capture_output=True, text=True, timeout=120,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
        if r.returncode != 0:
            err = ((r.stdout or "") + (r.stderr or "")).strip()
            if r.returncode in (126, 127):
                raise HTTPException(status_code=400,
                                    detail="install cancelled or no polkit agent available")
            raise HTTPException(status_code=500, detail=err or "install failed")
        return {"installed": _is_passwordless(binary)}

    raise HTTPException(status_code=501,
                        detail="passwordless install not supported on this platform")


@router.post("/nmap/revoke")
def revoke_sudoers() -> dict[str, Any]:
    """Remove the passwordless sudoers drop-in.

    Counterpart to /nmap/install — same osascript / pkexec flow. Idempotent.
    """
    binary = nmap_runner.find_nmap()
    if not binary or not _is_passwordless(binary):
        return {"installed": False, "already": True}

    revoke_cmd = f"/bin/rm -f {shlex.quote(SUDOERS_PATH)}"

    if sys.platform == "darwin":
        script = f'do shell script "{revoke_cmd}" with administrator privileges'
        try:
            r = subprocess.run(["osascript", "-e", script],
                               capture_output=True, text=True, timeout=120)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
        if r.returncode != 0:
            err = (r.stderr or "").strip()
            if "-128" in err or "canceled" in err.lower() or "cancelled" in err.lower():
                raise HTTPException(status_code=400,
                                    detail="revoke cancelled by user")
            raise HTTPException(status_code=500, detail=err or "revoke failed")
        _audit_revoke()
        return {"installed": _is_passwordless(binary)}

    if sys.platform.startswith("linux"):
        pkexec = shutil.which("pkexec")
        if not pkexec:
            raise HTTPException(
                status_code=501,
                detail=("pkexec not installed. Remove the sudoers entry manually: "
                        f"sudo rm {SUDOERS_PATH}"),
            )
        try:
            r = subprocess.run(
                [pkexec, "/bin/sh", "-c", revoke_cmd],
                capture_output=True, text=True, timeout=120,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
        if r.returncode != 0:
            err = ((r.stdout or "") + (r.stderr or "")).strip()
            if r.returncode in (126, 127):
                raise HTTPException(
                    status_code=400,
                    detail="revoke cancelled or no polkit agent available",
                )
            raise HTTPException(status_code=500, detail=err or "revoke failed")
        _audit_revoke()
        return {"installed": _is_passwordless(binary)}

    raise HTTPException(status_code=501,
                        detail="passwordless revoke not supported on this platform")


def _audit_revoke() -> None:
    try:
        aid = audit_log.start(
            tool="sudoers-revoke", target="nmap", argv=[SUDOERS_PATH],
        )
        audit_log.complete(aid, summary=f"removed {SUDOERS_PATH}")
    except Exception:
        logger.exception("audit_log write failed for nmap sudoers-revoke")


@router.get("/nmap/scripts")
def scripts() -> dict[str, Any]:
    """Return the full NSE script catalog, grouped by category + risk.

    The result is cached in-memory (see `lib/nmap_scripts.py`) — parsing
    `script.db`'s ~600 entries on every page load is wasteful.
    """
    cat = nmap_scripts.load_catalog()
    if not cat.get("available"):
        raise HTTPException(status_code=503, detail="nmap scripts dir not found")
    # Preserve the legacy `[(name, count), ...]` shape for older clients.
    legacy_categories = sorted(
        ((name, len(scripts)) for name, scripts in cat["categories"].items()),
        key=lambda p: p[0],
    )
    return {
        "count":          cat["count"],
        "scripts_dir":    cat["scripts_dir"],
        "scripts":        cat["scripts"],
        "categories":     legacy_categories,
        "category_index": cat["categories"],
        "risk_groups":    cat["risk_groups"],
    }


@router.get("/nmap/scripts/{category}")
def scripts_by_category(category: str) -> dict[str, Any]:
    """Filter the NSE catalog to a single category."""
    cat = nmap_scripts.load_catalog()
    if not cat.get("available"):
        raise HTTPException(status_code=503, detail="nmap scripts dir not found")
    names = set(cat["categories"].get(category, []))
    if not names:
        # Empty list rather than 404 — frontend can render a "no scripts in
        # this category" hint without an error toast.
        return {"category": category, "count": 0, "scripts": []}
    scripts_list = [s for s in cat["scripts"] if s["name"] in names]
    return {
        "category": category,
        "count":    len(scripts_list),
        "scripts":  scripts_list,
    }


@router.get("/nmap/script-presets")
def script_presets() -> dict[str, Any]:
    """Return the curated NSE script presets."""
    return nmap_scripts.list_presets()


@router.get("/nmap/script-help")
def script_help_endpoint(name: str = Query(..., min_length=1, max_length=200)) -> dict[str, Any]:
    binary = _resolved_binary()
    text = nmap_runner.script_help(binary, name)
    return {"name": name, "help": text}


@router.get("/nmap/policy")
def policy_one(target: str) -> dict[str, Any]:
    verdict, reason = target_policy.check_target(target)
    return {"target": target, "verdict": verdict, "reason": reason}


@router.websocket("/ws/nmap")
async def nmap_ws(ws: WebSocket) -> None:
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
        init: dict[str, Any] = await ws.receive_json()
        raw_opts = dict(init.get("opts") or {})
        confirm  = bool(init.get("confirm", False))

        # ── Script-picker handshake fields ──────────────────────────────────
        # Top-level convenience fields make the script-picker UI a thin
        # wrapper: it doesn't need to know how to translate a preset into
        # NmapOptions, it just names what the user picked.
        #
        #   {"preset": "quick_vuln"}                # expand to preset recipe
        #   {"scripts": ["http-title", "ssl-*"]}    # raw --script entries
        #   {"script_args": "user=admin"}           # --script-args
        #   {"ports": "80,443"}                     # port_spec override
        preset_id = (init.get("preset") or "").strip() or None
        extra_scripts = list(init.get("scripts") or [])
        script_args   = str(init.get("script_args") or "").strip()
        ports_override = str(init.get("ports") or "").strip()
        if preset_id:
            preset = nmap_scripts.get_preset(preset_id)
            if not preset:
                await ws.send_json(ws_error(
                    ErrorCode.VALIDATION_ERROR,
                    f"unknown preset: {preset_id}",
                ))
                await ws.close(); return
            # Preset's categories/scripts merge into anything already on opts.
            raw_opts.setdefault("nse_categories", [])
            raw_opts.setdefault("nse_scripts", [])
            raw_opts["nse_categories"] = sorted(
                set(raw_opts["nse_categories"]) | set(preset.get("categories", []))
            )
            raw_opts["nse_scripts"] = sorted(
                set(raw_opts["nse_scripts"]) | set(preset.get("scripts", []))
            )
            if preset.get("service_version"):
                raw_opts["service_version"] = True
            if preset.get("os_detect"):
                raw_opts["os_detect"] = True
            if preset.get("traceroute"):
                raw_opts["traceroute"] = True
            preset_ports = preset.get("ports", "")
            if preset_ports and not raw_opts.get("port_spec"):
                raw_opts["port_spec"] = preset_ports
        if extra_scripts:
            merged = set(raw_opts.get("nse_scripts") or []) | {
                str(s).strip() for s in extra_scripts if str(s).strip()
            }
            raw_opts["nse_scripts"] = sorted(merged)
        if script_args:
            existing = (raw_opts.get("nse_args") or "").strip()
            raw_opts["nse_args"] = f"{existing} {script_args}".strip() if existing else script_args
        if ports_override:
            raw_opts["port_spec"] = ports_override

        binary = nmap_runner.find_nmap()
        if not binary:
            await ws.send_json(ws_error(
                ErrorCode.TOOL_MISSING,
                "nmap binary not found on this system",
            ))
            await ws.close(); return

        # Build options object (defaults are sensible)
        try:
            opts = nmap_runner.NmapOptions(
                targets=list(raw_opts.get("targets") or []),
                exclude=list(raw_opts.get("exclude") or []),
                skip_discovery=bool(raw_opts.get("skip_discovery", False)),
                ping_only=bool(raw_opts.get("ping_only", False)),
                no_dns=bool(raw_opts.get("no_dns", True)),
                force_dns=bool(raw_opts.get("force_dns", False)),
                traceroute=bool(raw_opts.get("traceroute", False)),
                discovery_probes=list(raw_opts.get("discovery_probes") or []),
                scan_type=str(raw_opts.get("scan_type", "syn") or "syn"),
                port_spec=str(raw_opts.get("port_spec", "") or ""),
                top_ports=int(raw_opts.get("top_ports", 0) or 0),
                fast_mode=bool(raw_opts.get("fast_mode", False)),
                all_ports=bool(raw_opts.get("all_ports", False)),
                exclude_ports=str(raw_opts.get("exclude_ports", "") or ""),
                service_version=bool(raw_opts.get("service_version", False)),
                version_intensity=int(raw_opts.get("version_intensity", -1) or -1),
                version_light=bool(raw_opts.get("version_light", False)),
                version_all=bool(raw_opts.get("version_all", False)),
                os_detect=bool(raw_opts.get("os_detect", False)),
                osscan_limit=bool(raw_opts.get("osscan_limit", False)),
                osscan_guess=bool(raw_opts.get("osscan_guess", False)),
                timing_template=int(raw_opts.get("timing_template", 3) or 3),
                min_rate=int(raw_opts.get("min_rate", 0) or 0),
                max_rate=int(raw_opts.get("max_rate", 0) or 0),
                host_timeout=str(raw_opts.get("host_timeout", "") or ""),
                max_retries=int(raw_opts.get("max_retries", -1)
                                if raw_opts.get("max_retries") not in (None, "") else -1),
                nse_categories=list(raw_opts.get("nse_categories") or []),
                nse_scripts=list(raw_opts.get("nse_scripts") or []),
                nse_args=str(raw_opts.get("nse_args", "") or ""),
                fragment=bool(raw_opts.get("fragment", False)),
                mtu=int(raw_opts.get("mtu", 0) or 0),
                decoys=str(raw_opts.get("decoys", "") or ""),
                spoof_ip=str(raw_opts.get("spoof_ip", "") or ""),
                source_port=int(raw_opts.get("source_port", 0) or 0),
                spoof_mac=str(raw_opts.get("spoof_mac", "") or ""),
                badsum=bool(raw_opts.get("badsum", False)),
                data_length=int(raw_opts.get("data_length", 0) or 0),
                verbose=int(raw_opts.get("verbose", 0) or 0),
                debug=int(raw_opts.get("debug", 0) or 0),
                show_reason=bool(raw_opts.get("show_reason", False)),
                open_only=bool(raw_opts.get("open_only", False)),
                packet_trace=bool(raw_opts.get("packet_trace", False)),
                disable_arp_ping=bool(raw_opts.get("disable_arp_ping", False)),
                use_sudo=bool(raw_opts.get("use_sudo", False)),
                extra_args=str(raw_opts.get("extra_args", "") or ""),
            )
        except (TypeError, ValueError) as e:
            await ws.send_json(ws_error(
                ErrorCode.VALIDATION_ERROR,
                f"invalid options: {e}",
            ))
            await ws.close(); return

        if not opts.targets:
            await ws.send_json(ws_error(
                ErrorCode.INVALID_TARGET,
                "at least one target is required",
            ))
            await ws.close(); return

        # Per-target format validation. Accept CIDR + plain host/IP — the
        # CIDR/range expansion is handled in `nmap_runner`, so we only need
        # to ensure each entry strips cleanly and isn't pathologically long.
        normalised: list[str] = []
        for t in opts.targets[:256]:  # hard cap on target count
            if not isinstance(t, str):
                continue
            s = t.strip()
            if not s:
                continue
            if len(s) > MAX_TARGET_LEN:
                await ws.send_json(ws_error(
                    ErrorCode.INVALID_TARGET,
                    f"target too long (max {MAX_TARGET_LEN} chars)",
                ))
                await ws.close(); return
            # Accept CIDR (e.g. 10.0.0.0/24) and ranges (e.g. 10.0.0.1-50)
            # without per-character validation — nmap_runner handles those.
            # Bare hosts get full validation.
            if "/" in s or "-" in s or "," in s:
                normalised.append(s)
            else:
                try:
                    normalised.append(validate_target(s, field="target"))
                except MhpError as exc:
                    await ws.send_json(ws_error(exc.code, exc.message))
                    await ws.close(); return
        opts.targets = normalised
        if not opts.targets:
            await ws.send_json(ws_error(
                ErrorCode.INVALID_TARGET,
                "no valid targets after normalisation",
            ))
            await ws.close(); return

        # Target policy + engagement-scope gate. Each expanded target gets
        # the combined verdict (policy IP-class layer ∪ engagement scope),
        # honoring Lab/Engagement mode. A single `deny` anywhere fails the
        # whole batch; `warn` requires the user to re-submit with confirm.
        engagement_id = init.get("engagement_id") or None
        init_mode = str(init.get("mode", "")).strip().lower()
        mode = "engagement" if init_mode == "engagement" else (
            "lab" if init_mode == "lab" else get_mode(ws)
        )
        verdicts: list[dict[str, str]] = []
        any_warn = False
        for t in nmap_runner.expand_for_policy(opts.targets):
            v, r, layers = scope.check_combined(t, engagement_id, mode)
            verdicts.append({"target": t, "verdict": v, "reason": r,
                             "layers": layers})
            if v == "deny":
                await ws.send_json({"type": "policy", "verdicts": verdicts,
                                    "mode": mode})
                await ws.send_json(ws_error(
                    ErrorCode.TARGET_DENIED,
                    f"target denied: {t} ({r})",
                    target=t,
                ))
                await ws.close(); return
            if v == "warn":
                any_warn = True
        await ws.send_json({"type": "policy", "verdicts": verdicts,
                            "mode": mode})
        if any_warn and not confirm:
            await ws.send_json(ws_error(
                ErrorCode.NEED_CONFIRM,
                "one or more targets require confirmation",
                need_confirm=True,
            ))
            await ws.close(); return

        # Privileged scan check
        if nmap_runner.needs_privileged(opts):
            opts.use_sudo = True
            if not _is_passwordless(binary):
                await ws.send_json(ws_error(
                    ErrorCode.FORBIDDEN,
                    "this scan type needs root (SYN/UDP/OS/stealth). "
                    "Install passwordless sudo first.",
                ))
                await ws.close(); return

        listener = asyncio.create_task(listen_for_stop())

        async def emit(ev: dict[str, Any]) -> None:
            try:
                await ws.send_json(ev)
            except Exception:
                pass

        result = await nmap_runner.run_scan(
            opts, binary, emit, lambda: stop.is_set(),
        )

        listener.cancel()

        # HIDS notify on success
        rep = result.get("report")
        if rep and not result.get("stopped") and result.get("rc") == 0:
            try:
                open_ports = sum(
                    1 for h in rep.get("hosts", [])
                    for p in h.get("ports", []) if p.get("state") == "open"
                )
                await hids_notify.notify(
                    "info", "nmap",
                    f"Nmap scan complete — {rep.get('hosts_up', 0)} up, {open_ports} open ports",
                    {"targets": opts.targets,
                     "hosts_total": rep.get("hosts_total", 0),
                     "hosts_up":    rep.get("hosts_up", 0),
                     "open_ports":  open_ports,
                     "elapsed":     rep.get("elapsed", 0)},
                )
            except Exception:
                pass

    except WebSocketDisconnect:
        stop.set()
    except Exception:
        logger.exception("nmap_ws unhandled exception")
        try:
            await ws.send_json(ws_error(
                ErrorCode.INTERNAL,
                "internal error during nmap scan",
            ))
        except Exception:
            pass
    finally:
        try:
            await ws.close()
        except Exception:
            pass
