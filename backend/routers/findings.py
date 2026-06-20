"""Findings tracker — standalone HTTP surface over `lib/engagements.py`.

Findings are the evidence layer for engagements. A user "promotes" a scan
result on any tool page into a tracked finding attached to the active
engagement. Findings carry severity + status + description + raw evidence
(the captured scan output snippet) and feed the engagement report.

All endpoints are scoped to a single engagement via `?engagement_id=` (on
list/create) or via the finding's own engagement reference (read/update/
delete). The existing `/engagements/{eid}/findings` surface still works —
the tracker is the dedicated endpoint that's safer for promote-from-result
flows because the page only needs to thread `engagement_id`, not nest its
calls under an engagement path.

Every write appends an `audit_log` row with `tool='finding-<action>'` so
the engagement's trust anchor records who promoted/edited/removed what.
"""
from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from lib import audit_log, engagements
from lib.auth import require_local_auth
from lib.errors import ErrorCode, MhpError

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/findings",
    tags=["findings"],
    dependencies=[Depends(require_local_auth)],
)


Severity = Literal["info", "low", "medium", "high", "critical"]
# Canonical statuses only — legacy values (triaged/fixed/wont_fix) still
# load from the DB but the tracker won't accept new writes against them.
Status = Literal["open", "confirmed", "false_positive", "remediated"]


class FindingCreate(BaseModel):
    engagement_id:   str = Field(..., min_length=1, max_length=64)
    title:           str = Field(..., min_length=1, max_length=200)
    severity:        Severity
    description:     str = Field("", max_length=20_000)
    tool:            str = Field("", max_length=200)
    target:          str = Field("", max_length=500)
    evidence:        str = Field("", max_length=200_000)
    cvss_vector:     str | None = Field(None, max_length=200)
    cvss:            float | None = Field(None, ge=0, le=10)
    linked_result_id: str | None = Field(None, max_length=64)
    status:          Status = "open"


class FindingPatch(BaseModel):
    title:        str | None = Field(None, min_length=1, max_length=200)
    severity:     Severity | None = None
    description:  str | None = Field(None, max_length=20_000)
    tool:         str | None = Field(None, max_length=200)
    target:       str | None = Field(None, max_length=500)
    evidence:     str | None = Field(None, max_length=200_000)
    cvss_vector:  str | None = Field(None, max_length=200)
    cvss:         float | None = Field(None, ge=0, le=10)
    status:       Status | None = None


def _require_engagement(eid: str) -> dict[str, Any]:
    eng = engagements.get_engagement(eid)
    if not eng:
        raise MhpError(
            "engagement not found",
            code=ErrorCode.NOT_FOUND,
            status_code=404,
            extra={"engagement_id": eid},
        )
    return eng


def _require_finding(fid: str) -> dict[str, Any]:
    f = engagements.get_finding(fid)
    if not f:
        raise MhpError(
            "finding not found",
            code=ErrorCode.NOT_FOUND,
            status_code=404,
            extra={"finding_id": fid},
        )
    return f


def _audit_summary(f: dict[str, Any]) -> str:
    sev = (f.get("severity") or "").upper()
    title = (f.get("title") or "")[:120]
    return f"[{sev}] {title}" if sev else title


@router.get("")
def list_for_engagement(
    engagement_id: str = Query(..., min_length=1, max_length=64),
) -> dict[str, Any]:
    _require_engagement(engagement_id)
    rows = engagements.list_findings(engagement_id)
    return {"count": len(rows), "findings": rows}


@router.get("/{fid}")
def get_one(fid: str) -> dict[str, Any]:
    return _require_finding(fid)


@router.post("")
def create(body: FindingCreate) -> dict[str, Any]:
    _require_engagement(body.engagement_id)
    try:
        f = engagements.create_finding(
            engagement_id=body.engagement_id,
            title=body.title,
            severity=body.severity,
            description=body.description,
            evidence=body.evidence,
            cvss=body.cvss,
            cvss_vector=body.cvss_vector,
            tool=body.tool,
            target=body.target,
            linked_result_id=body.linked_result_id,
            status=body.status,
        )
    except ValueError as e:
        raise MhpError(str(e), code=ErrorCode.VALIDATION_ERROR, status_code=400) from e
    aid = audit_log.start(
        tool="finding-create",
        target=body.target or body.title[:120],
        argv=[body.severity, body.status],
        engagement_id=body.engagement_id,
    )
    audit_log.complete(aid, summary=_audit_summary(f))
    return f


@router.patch("/{fid}")
def patch(fid: str, body: FindingPatch) -> dict[str, Any]:
    existing = _require_finding(fid)
    patch_dict = body.model_dump(exclude_none=True)
    if not patch_dict:
        return existing
    try:
        updated = engagements.update_finding(fid, patch_dict)
    except ValueError as e:
        raise MhpError(str(e), code=ErrorCode.VALIDATION_ERROR, status_code=400) from e
    if updated is None:
        raise MhpError("finding not found", code=ErrorCode.NOT_FOUND, status_code=404)
    aid = audit_log.start(
        tool="finding-update",
        target=updated.get("target") or updated.get("title") or fid,
        argv=sorted(patch_dict.keys()),
        engagement_id=existing.get("engagement_id"),
    )
    audit_log.complete(aid, summary=_audit_summary(updated))
    return updated


@router.delete("/{fid}")
def remove(fid: str) -> dict[str, Any]:
    existing = _require_finding(fid)
    ok = engagements.delete_finding(fid)
    if not ok:
        raise MhpError("finding not found", code=ErrorCode.NOT_FOUND, status_code=404)
    aid = audit_log.start(
        tool="finding-delete",
        target=existing.get("target") or existing.get("title") or fid,
        argv=[],
        engagement_id=existing.get("engagement_id"),
    )
    audit_log.complete(aid, summary=_audit_summary(existing))
    return {"deleted": True, "id": fid}
