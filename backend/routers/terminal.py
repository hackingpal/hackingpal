"""Terminal — single-shot command execution.

Not a real shell — runs one command per request, returns stdout/stderr.
Real PTY support (xterm.js + ptyprocess) is a follow-up.

# SECURITY: This endpoint executes arbitrary shell commands.
# It is protected by:
#   1. localhost-only binding (127.0.0.1) — enforced in main.py
#   2. X-MHP-Token header auth (rotated each launch) — see lib/auth.py
# Never expose port 8765 to a network interface.
# This endpoint is intentionally NOT a PTY — no interactive
# commands, no sudo, no persistent shell state.
"""
from __future__ import annotations

import os
import shlex
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from lib.auth import require_local_auth

router = APIRouter(prefix="/terminal", tags=["terminal"])

# Maximum output bytes we return — protect the websocket from a 100MB cat.
MAX_OUTPUT = 256 * 1024


class ExecRequest(BaseModel):
    command: str
    cwd: str | None = None


class ExecResponse(BaseModel):
    cwd: str
    cmd: str
    returncode: int
    stdout: str
    stderr: str
    truncated: bool


@router.post("/exec", response_model=ExecResponse,
              dependencies=[Depends(require_local_auth)])
def exec_cmd(req: ExecRequest) -> ExecResponse:
    cmd = req.command.strip()
    if not cmd:
        raise HTTPException(status_code=400, detail="empty command")

    cwd = req.cwd or str(Path.home())
    if not Path(cwd).is_dir():
        raise HTTPException(status_code=400, detail=f"not a directory: {cwd}")

    # Built-in `cd <dir>` — return the new cwd
    if cmd == "cd" or cmd.startswith("cd "):
        target = cmd[3:].strip() or str(Path.home())
        target = os.path.expanduser(target)
        if not os.path.isabs(target):
            target = os.path.join(cwd, target)
        target = os.path.normpath(target)
        if not Path(target).is_dir():
            return ExecResponse(cwd=cwd, cmd=cmd, returncode=1, stdout="",
                                stderr=f"cd: no such directory: {target}",
                                truncated=False)
        return ExecResponse(cwd=target, cmd=cmd, returncode=0,
                            stdout="", stderr="", truncated=False)

    try:
        parts = shlex.split(cmd, posix=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"parse error: {exc}")

    try:
        r = subprocess.run(parts, capture_output=True, text=True,
                           cwd=cwd, timeout=20)
    except FileNotFoundError:
        raise HTTPException(status_code=404,
                            detail=f"command not found: {parts[0]}")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="command timed out (20s)")

    out, err = r.stdout, r.stderr
    truncated = False
    if len(out) > MAX_OUTPUT:
        out = out[:MAX_OUTPUT]; truncated = True
    if len(err) > MAX_OUTPUT:
        err = err[:MAX_OUTPUT]; truncated = True

    return ExecResponse(cwd=cwd, cmd=cmd, returncode=r.returncode,
                        stdout=out, stderr=err, truncated=truncated)


@router.get("/cwd")
def default_cwd() -> dict[str, Any]:
    return {"cwd": str(Path.home())}
