"""Training labs — Docker-backed vulnerable apps to practice against.

The frontend Labs page polls these endpoints to drive the lab lifecycle
(build → start → stop). Long-running ``docker build`` is fired as a
background task and the UI polls ``/labs/{id}/status`` for the log tail.

All endpoints are gated by ``require_local_auth`` because they shell out
to ``docker`` (which is privileged on most setups).
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lib import labs as labs_lib, targets as targets_lib
from lib.auth import require_local_auth
from lib.errors import ErrorCode, MhpError

logger = logging.getLogger(__name__)

router = APIRouter(tags=["labs"], dependencies=[Depends(require_local_auth)])


def _require_lab(lab_id: str) -> None:
    if labs_lib.get_lab_def(lab_id) is None:
        raise MhpError(f"unknown lab: {lab_id}", code=ErrorCode.NOT_FOUND, status_code=404)


@router.get("/labs")
async def list_labs() -> dict[str, Any]:
    """List available labs along with a top-level docker availability flag.

    The UI uses ``docker_available`` to show an install hint when Docker is
    missing entirely, vs ``docker_running`` to show a "start Docker Desktop"
    hint when the binary exists but the daemon is down.
    """
    runtime = await labs_lib.detect_runtime()
    return {
        "labs":             labs_lib.list_labs(),
        "docker_available": labs_lib.docker_available(),
        "docker_running":   runtime["running"],
        "runtime":          runtime,
    }


@router.get("/labs/preflight")
async def lab_preflight() -> dict[str, Any]:
    """State-specific runtime check for the Labs Colima popup.

    Re-scans the Homebrew bin dirs on every call so the user can install
    colima and click Re-check without restarting the app. See
    ``labs_lib.preflight`` for the state taxonomy.
    """
    return await labs_lib.preflight()


@router.get("/labs/{lab_id}/status")
async def lab_status(lab_id: str) -> dict[str, Any]:
    _require_lab(lab_id)
    return await labs_lib.get_status(lab_id)


@router.post("/labs/{lab_id}/build")
async def lab_build(lab_id: str) -> dict[str, Any]:
    _require_lab(lab_id)
    result = await labs_lib.start_build(lab_id)
    if result.get("status") == "error":
        raise MhpError(result.get("error") or "build failed to start",
                       code=ErrorCode.TOOL_FAILED, status_code=503)
    return result


@router.post("/labs/{lab_id}/start")
async def lab_start(lab_id: str) -> dict[str, Any]:
    _require_lab(lab_id)
    result = await labs_lib.start_lab(lab_id)
    if result.get("status") == "error":
        raise MhpError(result.get("error") or "lab failed to start",
                       code=ErrorCode.TOOL_FAILED, status_code=503)
    _register_lab_targets(lab_id)
    return result


@router.post("/labs/{lab_id}/stop")
async def lab_stop(lab_id: str) -> dict[str, Any]:
    _require_lab(lab_id)
    result = await labs_lib.stop_lab(lab_id)
    if result.get("status") == "error":
        raise MhpError(result.get("error") or "lab failed to stop",
                       code=ErrorCode.TOOL_FAILED, status_code=503)
    targets_lib.hide_lab_targets(lab_id)
    return result


def _register_lab_targets(lab_id: str) -> None:
    """Upsert one target per published port_map entry.

    Compose labs with no published ports (vulhub-net) get one zero-port
    placeholder so the Targets page can still surface the sidecar exec
    pathway as a known target. Failures are swallowed — auto-register
    shouldn't break the lab start flow if the DB write hiccups.
    """
    lab = labs_lib.get_lab_def(lab_id)
    if lab is None:
        return
    try:
        if not lab.port_map:
            targets_lib.upsert_lab_target(
                lab_id=lab.id, lab_name=lab.name,
                host_port=0, container_port=0,
                primary_url="",
            )
            return
        for cport, hport in lab.port_map.items():
            targets_lib.upsert_lab_target(
                lab_id=lab.id, lab_name=lab.name,
                host_port=hport, container_port=cport,
                primary_url=lab.primary_url,
            )
    except Exception as exc:
        logger.warning("lab target auto-register failed for %s: %s", lab_id, exc)


class SidecarExecBody(BaseModel):
    cmd: str = Field(..., min_length=1, max_length=32, pattern=r"^[a-zA-Z0-9_\-]+$")
    args: list[str] = Field(default_factory=list, max_length=32)
    timeout: float = Field(default=120, ge=1, le=600)


@router.post("/labs/{lab_id}/sidecar/exec")
async def lab_sidecar_exec(lab_id: str, body: SidecarExecBody) -> dict[str, Any]:
    """Run a whitelisted command inside the lab's scanner sidecar.

    The sidecar joins the lab's docker bridge so it can reach internal IPs
    that the macOS host can't. Used by the Labs UI's "Scan from inside the
    network" panel and (eventually) the Network Audit page.
    """
    _require_lab(lab_id)
    result = await labs_lib.sidecar_exec(lab_id, body.cmd, body.args, body.timeout)
    if result.get("rc", 1) < 0:
        # rc == -1 from our helper means validation / setup error — not a
        # tool-failed result. Surface it as 400 so the UI shows the reason.
        raise MhpError(result.get("stderr") or "sidecar exec failed",
                       code=ErrorCode.BAD_REQUEST, status_code=400)
    return result
