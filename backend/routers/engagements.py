"""Engagement management — CRUD + auto-recorded results + findings + report.

Active-engagement awareness is **frontend-driven**: when the user selects an
engagement, the frontend POSTs every successful scan result here. This avoids
threading a global "current engagement" through every router.
"""
from __future__ import annotations

import base64
import html
import json
import logging
from typing import Any, Literal

import httpx
from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field

from lib import engagements
from .settings import keychain_get_named

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/engagements", tags=["engagements"])


def _md_code_fence(content: str) -> tuple[str, str]:
    """Return (open_fence, close_fence) that won't be terminated by `content`.

    Markdown code fences may be ``` or longer; a longer fence wraps content
    that contains shorter runs of backticks. Pick a fence one tick longer
    than the longest run of backticks in `content`, with a minimum of 3.
    """
    longest = 0
    run = 0
    for ch in content:
        if ch == "`":
            run += 1
            longest = max(longest, run)
        else:
            run = 0
    fence = "`" * max(3, longest + 1)
    return fence, fence


# ── Request models ──────────────────────────────────────────────────────────

class EngagementCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    scope: list[str] = Field(default_factory=list)
    exclusions: list[str] = Field(default_factory=list)
    notes: str = ""


class EngagementPatch(BaseModel):
    name: str | None = None
    scope: list[str] | None = None
    exclusions: list[str] | None = None
    notes: str | None = None
    status: Literal["active", "completed", "archived"] | None = None


class ResultPost(BaseModel):
    tool: str = Field(..., max_length=200)
    target: str = Field("", max_length=500)
    summary: str = Field("", max_length=4000)
    raw: Any = None


class FindingCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    severity: Literal["info", "low", "medium", "high", "critical"]
    description: str = ""
    evidence: str = ""
    cvss: float | None = None
    linked_result_id: str | None = None


class FindingPatch(BaseModel):
    title: str | None = None
    severity: Literal["info", "low", "medium", "high", "critical"] | None = None
    description: str | None = None
    evidence: str | None = None
    cvss: float | None = None
    status: Literal["open", "triaged", "fixed", "wont_fix"] | None = None


# ── Engagement CRUD ─────────────────────────────────────────────────────────

@router.get("")
def list_all(include_archived: bool = False) -> dict[str, Any]:
    return {"engagements": engagements.list_engagements(include_archived)}


@router.post("")
def create(body: EngagementCreate) -> dict[str, Any]:
    return engagements.create_engagement(body.name, body.scope,
                                         body.exclusions, body.notes)


@router.get("/{eid}")
def get_one(eid: str) -> dict[str, Any]:
    e = engagements.get_engagement(eid)
    if not e:
        raise HTTPException(404, "engagement not found")
    return e


@router.patch("/{eid}")
def patch_one(eid: str, body: EngagementPatch) -> dict[str, Any]:
    if engagements.get_engagement(eid) is None:
        raise HTTPException(404, "engagement not found")
    e = engagements.update_engagement(
        eid, body.model_dump(exclude_none=True),
    )
    return e  # type: ignore[return-value]


@router.delete("/{eid}")
def delete_one(eid: str) -> dict[str, bool]:
    ok = engagements.delete_engagement(eid)
    if not ok:
        raise HTTPException(404, "engagement not found")
    return {"deleted": True}


# ── Results ─────────────────────────────────────────────────────────────────

@router.post("/{eid}/results")
def post_result(eid: str, body: ResultPost) -> dict[str, Any]:
    if engagements.get_engagement(eid) is None:
        raise HTTPException(404, "engagement not found")
    return engagements.record_result(eid, body.tool, body.target,
                                     body.summary, body.raw)


@router.get("/{eid}/results")
def get_results(eid: str, limit: int = 200) -> dict[str, Any]:
    if engagements.get_engagement(eid) is None:
        raise HTTPException(404, "engagement not found")
    return {"results": engagements.list_results(eid, limit=limit)}


@router.get("/{eid}/results/{rid}")
def get_result(eid: str, rid: str) -> dict[str, Any]:
    r = engagements.get_result(rid)
    if not r or r["engagement_id"] != eid:
        raise HTTPException(404, "result not found")
    return r


# ── Findings ────────────────────────────────────────────────────────────────

@router.post("/{eid}/findings")
def post_finding(eid: str, body: FindingCreate) -> dict[str, Any]:
    if engagements.get_engagement(eid) is None:
        raise HTTPException(404, "engagement not found")
    try:
        return engagements.create_finding(
            eid, body.title, body.severity,
            description=body.description, evidence=body.evidence,
            cvss=body.cvss, linked_result_id=body.linked_result_id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/{eid}/findings")
def get_findings(eid: str) -> dict[str, Any]:
    if engagements.get_engagement(eid) is None:
        raise HTTPException(404, "engagement not found")
    return {"findings": engagements.list_findings(eid)}


@router.patch("/{eid}/findings/{fid}")
def patch_finding(eid: str, fid: str, body: FindingPatch) -> dict[str, Any]:
    f = engagements.get_finding(fid)
    if not f or f["engagement_id"] != eid:
        raise HTTPException(404, "finding not found")
    try:
        return engagements.update_finding(fid, body.model_dump(exclude_none=True))  # type: ignore[return-value]
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/{eid}/findings/{fid}")
def delete_finding(eid: str, fid: str) -> dict[str, bool]:
    f = engagements.get_finding(fid)
    if not f or f["engagement_id"] != eid:
        raise HTTPException(404, "finding not found")
    engagements.delete_finding(fid)
    return {"deleted": True}


# ── Screenshots ─────────────────────────────────────────────────────────────

MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024   # 10 MB cap per upload
ALLOWED_MIMES = {"image/png", "image/jpeg", "image/gif", "image/webp"}


@router.post("/{eid}/findings/{fid}/screenshots")
async def upload_screenshot(eid: str, fid: str, file: UploadFile = File(...)) -> dict[str, Any]:
    f = engagements.get_finding(fid)
    if not f or f["engagement_id"] != eid:
        raise HTTPException(404, "finding not found")
    mime = (file.content_type or "").lower()
    if mime not in ALLOWED_MIMES:
        raise HTTPException(415, f"unsupported image type: {mime}")
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    if len(data) > MAX_SCREENSHOT_BYTES:
        raise HTTPException(413, f"file too large (max {MAX_SCREENSHOT_BYTES // 1024 // 1024} MB)")
    return engagements.add_screenshot(fid, mime, file.filename or "", data)


@router.get("/{eid}/findings/{fid}/screenshots")
def list_screenshots(eid: str, fid: str) -> dict[str, Any]:
    f = engagements.get_finding(fid)
    if not f or f["engagement_id"] != eid:
        raise HTTPException(404, "finding not found")
    return {"screenshots": engagements.list_screenshots(fid)}


@router.get("/{eid}/screenshots/{sid}")
def get_screenshot(eid: str, sid: str) -> Response:
    # eid not strictly needed for lookup, but kept for nesting/auth symmetry
    res = engagements.get_screenshot(sid)
    if not res:
        raise HTTPException(404, "screenshot not found")
    mime, filename, data = res
    return Response(
        content=data, media_type=mime,
        headers={"Content-Disposition": f'inline; filename="{filename or "screenshot"}"'},
    )


@router.delete("/{eid}/screenshots/{sid}")
def delete_screenshot(eid: str, sid: str) -> dict[str, bool]:
    if not engagements.delete_screenshot(sid):
        raise HTTPException(404, "screenshot not found")
    return {"deleted": True}


# ── GitHub Issues export ────────────────────────────────────────────────────

class GithubExportBody(BaseModel):
    owner:        str = Field(..., min_length=1)
    repo:         str = Field(..., min_length=1)
    label_prefix: str = "mhp"
    severity_filter: list[str] | None = None   # only export these severities


@router.post("/{eid}/export/github")
async def export_to_github(eid: str, body: GithubExportBody) -> dict[str, Any]:
    eng = engagements.get_engagement(eid)
    if not eng:
        raise HTTPException(404, "engagement not found")
    token = keychain_get_named("github_token")
    if not token:
        raise HTTPException(401,
            "github_token not configured. POST /settings/keys/github_token with "
            'a personal access token (`repo` scope required).')

    findings = engagements.list_findings(eid)
    if body.severity_filter:
        findings = [f for f in findings if f["severity"] in body.severity_filter]
    if not findings:
        return {"created": [], "skipped": 0,
                "message": "no findings match the filter"}

    created: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "MyHackingPal/0.1",
    }

    async with httpx.AsyncClient(timeout=15.0, headers=headers) as client:
        for f in findings:
            title = f"[{f['severity'].upper()}] {f['title']}"
            label = f"{body.label_prefix}/{f['severity']}"
            evidence = (f.get("evidence") or "")[:8000]
            open_fence, close_fence = _md_code_fence(evidence)
            body_md = (
                f"### Engagement\n{eng['name']}\n\n"
                f"### Severity\n`{f['severity']}`"
                + (f"  ·  CVSS {f['cvss']}" if f.get("cvss") is not None else "")
                + "\n\n"
                f"### Description\n{f.get('description', '') or '_(none)_'}\n\n"
                f"### Evidence\n"
                f"{open_fence}\n{evidence}\n{close_fence}\n\n"
                f"---\n_recorded {f['ts']} · finding id `{f['id']}` · "
                f"engagement `{eid}`_\n"
            )
            try:
                r = await client.post(
                    f"https://api.github.com/repos/{body.owner}/{body.repo}/issues",
                    json={"title": title, "body": body_md, "labels": [label]},
                )
                if r.status_code == 201:
                    issue = r.json()
                    created.append({
                        "finding_id": f["id"],
                        "issue_number": issue.get("number"),
                        "url": issue.get("html_url"),
                    })
                else:
                    failed.append({
                        "finding_id": f["id"],
                        "status": r.status_code,
                        "detail": r.text[:200],
                    })
            except Exception as e:
                logger.exception("github issue export failed finding_id=%s", f.get("id"))
                failed.append({"finding_id": f["id"],
                               "detail": f"{type(e).__name__}: request failed"})

    return {"created": created, "failed": failed,
            "total_findings": len(findings)}


# ── Report export ───────────────────────────────────────────────────────────

@router.get("/{eid}/report")
def export_report(eid: str, format: Literal["html", "md"] = "html") -> Response:
    e = engagements.get_engagement(eid)
    if not e:
        raise HTTPException(404, "engagement not found")
    findings = engagements.list_findings(eid)
    stats = engagements.engagement_stats(eid)
    results = engagements.list_results(eid, limit=500)

    if format == "md":
        body = _render_md(e, findings, results, stats)
        return Response(
            content=body, media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{_slug(e["name"])}.md"'},
        )

    body = _render_html(e, findings, results, stats)
    return Response(
        content=body, media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": f'inline; filename="{_slug(e["name"])}.html"'},
    )


# ── Renderers ───────────────────────────────────────────────────────────────

SEVERITY_COLORS = {
    "critical": "#cf222e",
    "high":     "#cf6f22",
    "medium":   "#9a6700",
    "low":      "#0969da",
    "info":     "#57606a",
}


def _slug(name: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in name).strip("-").lower()[:50] or "report"


def _render_html(
    e: dict[str, Any], findings: list[dict[str, Any]],
    results: list[dict[str, Any]], stats: dict[str, Any],
) -> str:
    screenshots = engagements.screenshots_for_engagement(e["id"])
    # Sort findings: critical → info, then most-recent within tier (by created_at desc)
    findings = sorted(
        findings,
        key=lambda f: (engagements.SEVERITY_ORDER.get(f["severity"], 99),
                       -float(f.get("created_at") or 0)),
    )

    parts: list[str] = []
    parts.append(f"""<!doctype html>
<html><head><meta charset="utf-8">
<title>{html.escape(e['name'])} — Engagement Report</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          max-width: 880px; margin: 2em auto; padding: 0 2em; color: #1f2328; }}
  h1, h2, h3 {{ color: #1f2328; }}
  h1 {{ border-bottom: 2px solid #1f2328; padding-bottom: .3em; }}
  .meta {{ color: #57606a; font-size: 14px; margin-bottom: 2em; }}
  .scope, .summary {{ background: #f6f8fa; border: 1px solid #d0d7de; padding: 1em;
                      border-radius: 6px; margin: 1em 0; }}
  .scope code, .summary code {{ font-family: ui-monospace, monospace; }}
  table {{ border-collapse: collapse; width: 100%; margin: 1em 0; }}
  th, td {{ text-align: left; padding: .5em .75em; border-bottom: 1px solid #d0d7de; }}
  th {{ background: #f6f8fa; font-size: 12px; text-transform: uppercase;
        letter-spacing: .04em; color: #57606a; }}
  .sev-pill {{ display: inline-block; padding: 1px 8px; border-radius: 10px;
               color: white; font-size: 11px; font-weight: bold;
               text-transform: uppercase; letter-spacing: .04em; }}
  .finding {{ border: 1px solid #d0d7de; border-radius: 6px; padding: 1em;
              margin-bottom: 1em; }}
  .finding h3 {{ margin-top: 0; }}
  .finding pre {{ background: #f6f8fa; padding: .75em; border-radius: 4px;
                  overflow-x: auto; font-size: 12px; }}
  footer {{ margin-top: 4em; padding-top: 1em; border-top: 1px solid #d0d7de;
            color: #57606a; font-size: 12px; }}
  @media print {{ body {{ max-width: none; margin: 0; }} }}
</style></head><body>
<h1>{html.escape(e['name'])}</h1>
<div class="meta">
  Engagement Report · Status: <b>{html.escape(e['status'])}</b><br>
  Created {html.escape(e['created_at'])} · Last activity {html.escape(e['updated_at'])}
</div>

<h2>Scope</h2>
<div class="scope">
""")
    if e["scope"]:
        parts.append("<b>In-scope:</b><ul>")
        for s in e["scope"]:
            parts.append(f"<li><code>{html.escape(s)}</code></li>")
        parts.append("</ul>")
    else:
        parts.append("<p><em>No scope defined.</em></p>")
    if e["exclusions"]:
        parts.append("<b>Out-of-scope (exclusions):</b><ul>")
        for s in e["exclusions"]:
            parts.append(f"<li><code>{html.escape(s)}</code></li>")
        parts.append("</ul>")
    parts.append("</div>")

    if e["notes"]:
        parts.append(
            f"<h2>Notes</h2><div class='scope'><pre style='white-space: pre-wrap; "
            f"background: none; padding: 0;'>{html.escape(e['notes'])}</pre></div>"
        )

    # Executive summary
    parts.append("<h2>Executive Summary</h2><div class='summary'>")
    parts.append(f"<p>{stats['result_count']} scan results recorded across "
                 f"{len(stats['tools_used'])} distinct tools.</p>")
    if stats["findings_by_severity"]:
        parts.append("<p><b>Findings by severity:</b></p><ul>")
        for sev in ("critical", "high", "medium", "low", "info"):
            if sev in stats["findings_by_severity"]:
                color = SEVERITY_COLORS.get(sev, "#57606a")
                parts.append(
                    f"<li><span class='sev-pill' style='background:{color}'>"
                    f"{sev}</span> {stats['findings_by_severity'][sev]}</li>"
                )
        parts.append("</ul>")
    else:
        parts.append("<p><em>No findings recorded.</em></p>")
    parts.append("</div>")

    # Findings
    parts.append("<h2>Findings</h2>")
    if not findings:
        parts.append("<p><em>No findings.</em></p>")
    for f in findings:
        color = SEVERITY_COLORS.get(f["severity"], "#57606a")
        parts.append(f"""<div class="finding">
  <h3>
    <span class="sev-pill" style="background:{color}">{html.escape(f['severity'])}</span>
    {html.escape(f['title'])}
  </h3>
  <div class="meta">Status: {html.escape(f['status'])}{
    f' · CVSS {f["cvss"]}' if f.get("cvss") is not None else ""
  } · Recorded {html.escape(f['ts'])}</div>
""")
        if f["description"]:
            parts.append(f"<p>{html.escape(f['description']).replace(chr(10), '<br>')}</p>")
        if f["evidence"]:
            parts.append(f"<pre>{html.escape(f['evidence'])}</pre>")
        # Inline screenshots as base64 data URIs so the HTML is self-contained
        # — survives saving to disk, no broken-image refs after exporting.
        shots = screenshots.get(f["id"], [])
        for s in shots:
            try:
                b64 = base64.b64encode(s["data"]).decode("ascii")
                parts.append(
                    f'<figure style="margin: 1em 0;">'
                    f'<img src="data:{s["mime"]};base64,{b64}" '
                    f'alt="{html.escape(s["filename"] or "screenshot")}" '
                    f'style="max-width:100%; border:1px solid #d0d7de; border-radius:4px;">'
                    f'<figcaption style="font-size:11px; color:#57606a; margin-top:4px;">'
                    f'{html.escape(s["filename"] or "screenshot")}</figcaption></figure>'
                )
            except Exception:
                pass
        parts.append("</div>")

    # Results summary (tool/target/timestamp only — raw bodies omitted from report)
    parts.append("<h2>Activity Log</h2>")
    if not results:
        parts.append("<p><em>No scan activity.</em></p>")
    else:
        parts.append("<table><thead><tr><th>Timestamp</th><th>Tool</th>"
                     "<th>Target</th><th>Summary</th></tr></thead><tbody>")
        for r in results:
            parts.append(
                f"<tr><td>{html.escape(r['ts'])}</td>"
                f"<td><code>{html.escape(r['tool'])}</code></td>"
                f"<td><code>{html.escape(r['target'])}</code></td>"
                f"<td>{html.escape(r['summary'][:200])}</td></tr>"
            )
        parts.append("</tbody></table>")

    parts.append("""<footer>
Generated by MyHackingPal. Use your browser's <em>File → Print → Save as PDF</em>
to export this report as a PDF.
</footer></body></html>""")
    return "".join(parts)


def _render_md(
    e: dict[str, Any], findings: list[dict[str, Any]],
    results: list[dict[str, Any]], stats: dict[str, Any],
) -> str:
    findings = sorted(
        findings,
        key=lambda f: engagements.SEVERITY_ORDER.get(f["severity"], 99),
    )
    out: list[str] = []
    out.append(f"# {e['name']}\n")
    out.append(f"_Engagement Report · Status: **{e['status']}**_\n")
    out.append(f"_Created {e['created_at']} · Last activity {e['updated_at']}_\n")

    out.append("\n## Scope\n")
    if e["scope"]:
        out.append("**In-scope:**\n")
        for s in e["scope"]:
            out.append(f"- `{s}`")
    else:
        out.append("_No scope defined._")
    if e["exclusions"]:
        out.append("\n**Out-of-scope (exclusions):**\n")
        for s in e["exclusions"]:
            out.append(f"- `{s}`")

    if e["notes"]:
        out.append(f"\n## Notes\n\n{e['notes']}\n")

    out.append("\n## Executive Summary\n")
    out.append(f"- {stats['result_count']} scan results across {len(stats['tools_used'])} tools.")
    if stats["findings_by_severity"]:
        for sev in ("critical", "high", "medium", "low", "info"):
            if sev in stats["findings_by_severity"]:
                out.append(f"- **{sev.upper()}**: {stats['findings_by_severity'][sev]}")
    else:
        out.append("- No findings recorded.")

    out.append("\n## Findings\n")
    if not findings:
        out.append("_No findings._")
    for f in findings:
        cvss = f" · CVSS {f['cvss']}" if f.get("cvss") is not None else ""
        out.append(f"\n### [{f['severity'].upper()}] {f['title']}\n")
        out.append(f"_Status: {f['status']}{cvss} · {f['ts']}_\n")
        if f["description"]:
            out.append(f"\n{f['description']}\n")
        if f["evidence"]:
            open_fence, close_fence = _md_code_fence(f["evidence"])
            out.append(f"\n{open_fence}\n{f['evidence']}\n{close_fence}\n")

    out.append("\n## Activity Log\n")
    if not results:
        out.append("_No scan activity._")
    else:
        out.append("| Timestamp | Tool | Target | Summary |")
        out.append("|---|---|---|---|")
        for r in results:
            out.append(
                f"| {r['ts']} | `{r['tool']}` | `{r['target']}` | "
                f"{r['summary'][:200].replace(chr(124), '|').replace(chr(10), ' ')} |"
            )

    return "\n".join(out) + "\n"


# ── Tool catalog suggestions (consumed by frontend) ────────────────────────

@router.get("/_catalog/suggestions")
def catalog_suggestions() -> dict[str, Any]:
    """Curated list of tools the user could plan to build next. Pre-populated
    from the user's wishlist (AD / Cloud / OSINT / Wireless / Post-Exploit /
    Reporting). The frontend offers a 'Seed with suggestions' button that
    bulk-adds these into the local planned-tools list."""
    return {"suggestions": CATALOG_SUGGESTIONS}


CATALOG_SUGGESTIONS: list[dict[str, str]] = [
    # ── Active Directory ────────────────────────────────────────────────────
    {"category": "Active Directory", "label": "LDAP Enumerator",
     "description": "Enumerate users, groups, OUs, GPOs, and password policy via LDAP. Impacket-based (pure Python)."},
    {"category": "Active Directory", "label": "Kerberoasting",
     "description": "SPN enumeration + TGS ticket request. Crack offline with hashcat. Impacket GetUserSPNs flow."},
    {"category": "Active Directory", "label": "AS-REP Roasting",
     "description": "Harvest accounts with pre-auth disabled. Crack the AS-REP offline. Impacket GetNPUsers flow."},
    {"category": "Active Directory", "label": "BloodHound Ingestor",
     "description": "Collect attack-path data from a domain. SharpHound-equivalent in Python."},
    {"category": "Active Directory", "label": "SMB Enumerator",
     "description": "Enumerate shares, null sessions, and logged-in users via SMB. Impacket smbclient flow."},
    {"category": "Active Directory", "label": "AD Password Sprayer",
     "description": "Domain-aware password spray. Respects lockout policy; backs off when threshold approaches."},

    # ── Cloud Security ──────────────────────────────────────────────────────
    {"category": "Cloud Security", "label": "AWS Enumeration",
     "description": "IAM, S3 buckets, exposed instance metadata, misconfigured roles. Read-only checks."},
    {"category": "Cloud Security", "label": "Azure Recon",
     "description": "Tenant enumeration, exposed blob storage, app registrations."},
    {"category": "Cloud Security", "label": "GCP Recon",
     "description": "Project discovery, exposed buckets, service-account leaks."},
    {"category": "Cloud Security", "label": "IMDS Tester",
     "description": "Dedicated cloud metadata diagnostic. Probes AWS / Azure / GCP IMDS from a chosen origin."},
    {"category": "Cloud Security", "label": "S3 Bucket Scanner",
     "description": "Permutation-based public S3 bucket finder. Given a target name, generate plausible names and check ACLs."},

    # ── OSINT depth ─────────────────────────────────────────────────────────
    {"category": "OSINT", "label": "Breach Data Lookup",
     "description": "HaveIBeenPwned + DeHashed for emails and passwords. Identifies users whose creds have leaked."},
    {"category": "OSINT", "label": "LinkedIn Scraper",
     "description": "Employee enumeration for social engineering. Outputs name / role / email-format guesses."},
    {"category": "OSINT", "label": "Google Dorking",
     "description": "Automated dork generation + execution for a target. Surfaces exposed files, login pages, configs."},
    {"category": "OSINT", "label": "Paste / GitHub Leak Scanner",
     "description": "Credentials and secrets in public pastes. Scans Pastebin, GitHub code search, GitHub gists."},
    {"category": "OSINT", "label": "People Search Aggregator",
     "description": "theHarvester-style email + name + phone collection from multiple OSINT sources."},
    {"category": "OSINT", "label": "Shodan / Censys Query",
     "description": "Full API query UI for Shodan and Censys, not just subdomain enum."},

    # ── Wireless ────────────────────────────────────────────────────────────
    {"category": "Wireless", "label": "WPA Handshake Capture",
     "description": "Monitor mode + deauth + capture WPA handshake. Needs a compatible adapter."},
    {"category": "Wireless", "label": "Evil Twin Detector",
     "description": "Find rogue APs matching known SSIDs in range. Passive monitor."},
    {"category": "Wireless", "label": "PMKID Attack",
     "description": "Modern WPA2 crack without deauth. Capture PMKID directly."},
    {"category": "Wireless", "label": "Bluetooth Recon",
     "description": "Device discovery + service enumeration over Bluetooth + BLE."},

    # ── Post-Exploitation ───────────────────────────────────────────────────
    {"category": "Post-Exploitation", "label": "Payload Obfuscator",
     "description": "Base64 / XOR / AMSI bypass wrappers for shell payloads. UI for stacking transforms."},
    {"category": "Post-Exploitation", "label": "C2 Beacon Simulator",
     "description": "Test if your reverse shells can call back through a firewall. Spins up a listener and target callback."},
    {"category": "Post-Exploitation", "label": "Credential Harvester",
     "description": "Parse loot from common locations (browser DBs, SSH configs, AWS credentials, .env files)."},
    {"category": "Post-Exploitation", "label": "Lateral Movement Planner",
     "description": "Given BloodHound data, suggest next-hop targets and reachable ACL paths."},
    {"category": "Post-Exploitation", "label": "Pivoting Helper",
     "description": "SSH tunnel / SOCKS proxy builder with a visual chain diagram."},

    # ── Reporting extras (engagement system covers the core) ────────────────
    {"category": "Reporting", "label": "CVSS Calculator (built-in)",
     "description": "CVSS v3.1 calculator embedded in the finding form. Maps vector strings to numeric score."},
    {"category": "Reporting", "label": "Screenshot evidence attachments",
     "description": "Attach screenshots to findings; embedded in the HTML/PDF report."},
    {"category": "Reporting", "label": "GitHub Issues export",
     "description": "Push findings directly into a GitHub repo's issues, one issue per finding."},
]
