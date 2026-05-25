"""Nmap — full-surface scanner with NSE, multi-target, and live streaming.

REST:
    GET  /nmap/status                  — binary path, version, scripts dir,
                                          sudoers state for passwordless privileged scans
    POST /nmap/install                 — install one-time passwordless sudoers entry
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
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect

from lib import hids_notify, nmap_runner, target_policy
from lib.auth import require_local_auth

router = APIRouter(tags=["nmap"])

SUDOERS_PATH = "/etc/sudoers.d/network-tools-nmap"


def _resolved_binary() -> str:
    b = nmap_runner.find_nmap()
    if not b:
        raise HTTPException(status_code=503, detail="nmap binary not found")
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


@router.post("/nmap/install", dependencies=[Depends(require_local_auth)])
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


@router.get("/nmap/scripts")
def scripts() -> dict[str, Any]:
    binary = _resolved_binary()
    sdir = nmap_runner.scripts_dir(binary)
    if not sdir:
        raise HTTPException(status_code=503, detail="nmap scripts dir not found")
    items = nmap_runner.list_scripts(sdir)
    # Build category index too
    cats: dict[str, int] = {}
    for it in items:
        for c in it["categories"]:
            cats[c] = cats.get(c, 0) + 1
    return {"count": len(items), "scripts": items,
            "categories": sorted(cats.items())}


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
        raw_opts = init.get("opts") or {}
        confirm  = bool(init.get("confirm", False))

        binary = nmap_runner.find_nmap()
        if not binary:
            await ws.send_json({"type": "error",
                                "detail": "nmap binary not found on this system"})
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
            await ws.send_json({"type": "error", "detail": f"invalid options: {e}"})
            await ws.close(); return

        if not opts.targets:
            await ws.send_json({"type": "error", "detail": "at least one target is required"})
            await ws.close(); return

        # Target policy gate — collect verdicts, deny outright, warn-without-confirm errs
        verdicts: list[dict[str, str]] = []
        any_warn = False
        for t in nmap_runner.expand_for_policy(opts.targets):
            v, r = target_policy.check_target(t)
            verdicts.append({"target": t, "verdict": v, "reason": r})
            if v == "deny":
                await ws.send_json({"type": "policy", "verdicts": verdicts})
                await ws.send_json({"type": "error",
                                    "detail": f"target denied: {t} ({r})"})
                await ws.close(); return
            if v == "warn":
                any_warn = True
        await ws.send_json({"type": "policy", "verdicts": verdicts})
        if any_warn and not confirm:
            await ws.send_json({"type": "error", "need_confirm": True,
                                "detail": "one or more targets require confirmation"})
            await ws.close(); return

        # Privileged scan check
        if nmap_runner.needs_privileged(opts):
            opts.use_sudo = True
            if not _is_passwordless(binary):
                await ws.send_json({
                    "type": "error",
                    "detail": "this scan type needs root (SYN/UDP/OS/stealth). "
                              "Install passwordless sudo first.",
                })
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
    except Exception as exc:
        try:
            await ws.send_json({"type": "error", "detail": str(exc)})
        except Exception:
            pass
    finally:
        try:
            await ws.close()
        except Exception:
            pass
