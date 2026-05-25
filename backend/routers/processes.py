"""Process inspector — enumerate running processes with security context.

REST: GET  /processes/list       → list of processes with codesign + listeners
      POST /processes/kill       → send a signal to one PID
      POST /processes/kill_bulk  → same, batched
"""
from __future__ import annotations

import getpass
import os
import shlex
import signal as signal_mod
import socket
import subprocess
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import psutil
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from lib import forensics, hids_notify, ids as ids_lib   # reuse the lsof snapshot
from lib.platform_util import IS_DARWIN

router = APIRouter(tags=["forensics"])


# Signal name → signal number. Limited to the ones the UI exposes.
SIGNAL_MAP: dict[str, int] = {
    "TERM": signal_mod.SIGTERM,
    "KILL": signal_mod.SIGKILL,
    "STOP": signal_mod.SIGSTOP,
    "CONT": signal_mod.SIGCONT,
    "HUP":  signal_mod.SIGHUP,
}

# PIDs that are categorically off-limits — killing them would panic the system.
FORBIDDEN_PIDS = {0, 1}


class ListenerInfo(BaseModel):
    proto: str
    addr: str
    port: int


class ProcessEntry(BaseModel):
    pid: int
    ppid: int
    name: str
    username: str
    exe: str
    cwd: str
    cmdline: str
    listeners: list[ListenerInfo] = []
    sign_status: str = ""
    sign_team: str = ""
    suspicious_path: bool = False
    severity: str = "info"


def _classify(p: ProcessEntry) -> str:
    if p.sign_status in ("missing", "invalid"):
        return "high"
    if p.suspicious_path:
        return "high"
    if p.sign_status in ("unsigned", "ad-hoc"):
        return "warn"
    return "info"


@router.get("/processes/list")
def list_processes(unsigned_only: bool = False) -> dict[str, Any]:
    # First: build {pid -> [(proto, addr, port), ...]} from one lsof snapshot.
    listener_map: dict[int, list[ListenerInfo]] = defaultdict(list)
    try:
        for entry in ids_lib.listening_snapshot():
            proto, addr, port, pid, _cmd = entry
            listener_map[pid].append(ListenerInfo(proto=proto, addr=addr, port=port))
    except Exception:
        pass

    # First pass: snapshot psutil and collect unique exe paths.
    proc_infos: list[dict[str, Any]] = []
    unique_exes: set[str] = set()
    for proc in psutil.process_iter(
        ["pid", "ppid", "name", "username", "exe", "cwd", "cmdline"],
    ):
        try:
            info = proc.info
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        proc_infos.append(info)
        exe = info.get("exe") or ""
        if exe:
            unique_exes.add(exe)

    # codesign_check spends ~30ms per binary in subprocess calls — fan them out
    # across threads so 400+ unique exes don't serialize into ~12s of latency.
    sign_cache: dict[str, dict[str, str]] = {}
    if unique_exes:
        with ThreadPoolExecutor(max_workers=16) as pool:
            for exe, sign in zip(unique_exes,
                                 pool.map(forensics.codesign_check, unique_exes)):
                sign_cache[exe] = sign

    entries: list[ProcessEntry] = []
    for info in proc_infos:
        exe   = info.get("exe") or ""
        cwd   = info.get("cwd") or ""
        cmd_l = info.get("cmdline") or []
        cmd   = " ".join(cmd_l) if isinstance(cmd_l, (list, tuple)) else ""

        sign = sign_cache.get(exe, {"status": "", "team": "", "authority": ""}) \
            if exe else {"status": "", "team": "", "authority": ""}

        entry = ProcessEntry(
            pid=int(info.get("pid") or 0),
            ppid=int(info.get("ppid") or 0),
            name=info.get("name") or "",
            username=info.get("username") or "",
            exe=exe,
            cwd=cwd,
            cmdline=cmd[:240],
            listeners=listener_map.get(int(info.get("pid") or 0), []),
            sign_status=sign["status"],
            sign_team=sign["team"],
            suspicious_path=bool(exe) and forensics.is_suspicious_path(exe),
        )
        entry.severity = _classify(entry)

        if unsigned_only and entry.severity == "info":
            continue
        entries.append(entry)

    sev_order = {"high": 0, "warn": 1, "info": 2}
    entries.sort(key=lambda e: (sev_order[e.severity], e.pid))
    return {"count": len(entries), "entries": entries}


# ── Kill / signal endpoints ───────────────────────────────────────────────────

class KillRequest(BaseModel):
    pid: int
    signal: str = Field(default="TERM",
                        description="TERM | KILL | STOP | CONT | HUP")
    admin: bool = False
    confirm: bool = False


class KillBulkRequest(BaseModel):
    pids: list[int]
    signal: str = "TERM"
    admin: bool = False
    confirm: bool = False


def _risk_assessment(pid: int) -> dict[str, Any]:
    """Return whether a kill needs explicit confirmation."""
    if pid in FORBIDDEN_PIDS:
        return {"forbidden": True, "risky": True, "reason": "system PID (init/launchd)"}
    try:
        proc = psutil.Process(pid)
        username = proc.username() or ""
        name = proc.name() or ""
        exe = proc.exe() or ""
    except psutil.NoSuchProcess:
        return {"forbidden": False, "risky": False, "reason": "no such process",
                "missing": True}
    except psutil.AccessDenied:
        return {"forbidden": False, "risky": True, "reason": "access denied — not owned by you",
                "self_owned": False}

    me = ""
    try:
        me = getpass.getuser()
    except Exception:
        me = os.environ.get("USER", "")

    self_owned = (username == me)

    # Apple-signed processes (Finder, WindowServer, kernel, etc.) are usually critical
    sign = forensics.codesign_check(exe) if exe else {"status": ""}
    apple_signed = sign.get("status") == "apple"

    # Low PIDs are typically system bootstrap
    low_pid = pid <= 100

    risky = (not self_owned) or apple_signed or low_pid
    reasons = []
    if not self_owned: reasons.append(f"owned by {username!r}")
    if apple_signed:   reasons.append("Apple-signed")
    if low_pid:        reasons.append(f"low PID ({pid})")
    return {
        "forbidden": False,
        "risky": risky,
        "reason": "; ".join(reasons) if reasons else "self-owned, non-system",
        "name": name,
        "username": username,
        "self_owned": self_owned,
        "apple_signed": apple_signed,
        "low_pid": low_pid,
    }


def _kill_admin(pid: int, signum: int) -> tuple[bool, str]:
    """Send the signal via osascript admin prompt. Returns (ok, message)."""
    if not IS_DARWIN:
        # Linux pkexec/sudo path and a Windows UAC path are TODO; surfacing
        # an explicit message is clearer than osascript FileNotFoundError.
        return False, "admin kill is currently macOS-only"
    cmd = f"/bin/kill -{signum} {pid}"
    script = f'do shell script "{cmd}" with administrator privileges'
    try:
        r = subprocess.run(["osascript", "-e", script],
                           capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return False, "admin prompt timed out"
    out = (r.stdout or "") + (r.stderr or "")
    if r.returncode == 0:
        return True, "killed via admin"
    if "-128" in out or "canceled" in out.lower() or "cancelled" in out.lower():
        return False, "cancelled by user"
    return False, out.strip() or "admin kill failed"


def _kill_one(pid: int, signal_name: str, admin: bool, confirm: bool) -> dict[str, Any]:
    if pid in FORBIDDEN_PIDS:
        return {"pid": pid, "ok": False, "error": "PID 0/1 cannot be killed"}

    signal_name_u = signal_name.upper().strip()
    if signal_name_u not in SIGNAL_MAP:
        return {"pid": pid, "ok": False,
                "error": f"unknown signal {signal_name!r} "
                         f"(allowed: {sorted(SIGNAL_MAP)})"}
    signum = SIGNAL_MAP[signal_name_u]

    risk = _risk_assessment(pid)
    if risk.get("missing"):
        return {"pid": pid, "ok": False, "error": "no such process"}
    if risk["risky"] and not confirm and not admin:
        return {"pid": pid, "ok": False, "error": "needs confirm",
                "need_confirm": True, "reason": risk["reason"],
                "name": risk.get("name"), "username": risk.get("username")}

    if admin:
        ok, msg = _kill_admin(pid, signum)
        return {"pid": pid, "ok": ok, "error": None if ok else msg,
                "method": "admin", "signal": signal_name_u,
                "name": risk.get("name")}

    try:
        psutil.Process(pid).send_signal(signum)
        return {"pid": pid, "ok": True, "signal": signal_name_u,
                "method": "self", "name": risk.get("name")}
    except psutil.NoSuchProcess:
        return {"pid": pid, "ok": False, "error": "no such process (already gone)"}
    except psutil.AccessDenied:
        return {"pid": pid, "ok": False, "error": "access denied — try admin=true"}
    except (PermissionError, OSError) as exc:
        return {"pid": pid, "ok": False, "error": str(exc)}


@router.post("/processes/kill")
async def kill_process(req: KillRequest) -> dict[str, Any]:
    result = _kill_one(req.pid, req.signal, req.admin, req.confirm)
    if result["ok"]:
        sev = "critical" if result.get("method") == "admin" else "warning"
        await hids_notify.notify(
            sev, "process-kill",
            f"Killed PID {req.pid} ({result.get('name', '')}) — SIG{req.signal.upper()}",
            {"pid": req.pid, "signal": req.signal.upper(),
             "method": result.get("method"), "name": result.get("name")},
        )
    return result


@router.post("/processes/kill_bulk")
async def kill_bulk(req: KillBulkRequest) -> dict[str, Any]:
    if not req.pids:
        raise HTTPException(status_code=400, detail="pids list is empty")
    if len(req.pids) > 50:
        raise HTTPException(status_code=400, detail="max 50 pids per request")

    results: list[dict[str, Any]] = []
    for pid in req.pids:
        results.append(_kill_one(pid, req.signal, req.admin, req.confirm))

    killed = sum(1 for r in results if r["ok"])
    if killed > 0:
        sev = "critical" if req.admin else "warning"
        await hids_notify.notify(
            sev, "process-kill",
            f"Bulk kill — {killed}/{len(req.pids)} PIDs · SIG{req.signal.upper()}",
            {"pids": req.pids, "signal": req.signal.upper(),
             "method": "admin" if req.admin else "self",
             "successful": killed, "total": len(req.pids)},
        )
    return {"results": results, "successful": killed, "total": len(req.pids)}
