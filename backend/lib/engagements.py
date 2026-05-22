"""Engagement store — SQLite-backed.

An *engagement* is a named container for a single piece of work: a pentest, a
red-team exercise, a bug-bounty target. Every scan result the user produces
while an engagement is "active" gets auto-recorded into it (frontend posts
into `/engagements/{id}/results`). Results can be **promoted to findings**
with a severity + evidence; findings render in the report export.

DB lives at `~/Library/Application Support/MyHackingPal/engagements.db` so it
survives reinstalls of the .app bundle. We use stdlib `sqlite3` — no extra
deps, schema is migrated in-place if the file already exists.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

# Use ~/Library/Application Support/MyHackingPal/ on macOS. On other platforms
# fall back to ~/.config/MyHackingPal/ — the bundle is currently Mac-only but
# this keeps the dev workflow on Linux clean.
def _db_path() -> Path:
    home = Path.home()
    if os.uname().sysname == "Darwin":
        base = home / "Library" / "Application Support" / "MyHackingPal"
    else:
        base = home / ".config" / "MyHackingPal"
    base.mkdir(parents=True, exist_ok=True)
    return base / "engagements.db"


SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS finding_screenshots (
      id            TEXT PRIMARY KEY,
      finding_id    TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
      ts            TEXT NOT NULL,
      mime          TEXT NOT NULL,
      filename      TEXT NOT NULL DEFAULT '',
      data          BLOB NOT NULL,
      size_bytes    INTEGER NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_screenshots_finding ON finding_screenshots(finding_id, ts)",
    """
    CREATE TABLE IF NOT EXISTS engagements (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      scope        TEXT NOT NULL DEFAULT '[]',   -- JSON list of strings
      exclusions   TEXT NOT NULL DEFAULT '[]',   -- JSON list of strings
      notes        TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'active',  -- active|completed|archived
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS scan_results (
      id            TEXT PRIMARY KEY,
      engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
      ts            TEXT NOT NULL,
      tool          TEXT NOT NULL,    -- e.g. "/nmap/run" or "Xss"
      target        TEXT NOT NULL,    -- best-effort target description
      summary       TEXT NOT NULL,    -- short string for the UI
      raw           TEXT NOT NULL     -- JSON-serialized full payload
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS findings (
      id                TEXT PRIMARY KEY,
      engagement_id     TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
      ts                TEXT NOT NULL,
      title             TEXT NOT NULL,
      severity          TEXT NOT NULL,  -- info|low|medium|high|critical
      cvss              REAL,
      description       TEXT NOT NULL DEFAULT '',
      evidence          TEXT NOT NULL DEFAULT '',
      linked_result_id  TEXT REFERENCES scan_results(id) ON DELETE SET NULL,
      status            TEXT NOT NULL DEFAULT 'open'  -- open|triaged|fixed|wont_fix
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_results_engagement ON scan_results(engagement_id, ts DESC)",
    "CREATE INDEX IF NOT EXISTS ix_findings_engagement ON findings(engagement_id, ts DESC)",
]


_conn: sqlite3.Connection | None = None


def _connect() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    conn = sqlite3.connect(_db_path(), check_same_thread=False)
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    for stmt in SCHEMA:
        conn.execute(stmt)
    conn.commit()
    _conn = conn
    return conn


@contextmanager
def cursor() -> Iterator[sqlite3.Cursor]:
    conn = _connect()
    c = conn.cursor()
    try:
        yield c
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        c.close()


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ── Engagements ─────────────────────────────────────────────────────────────

def list_engagements(include_archived: bool = False) -> list[dict[str, Any]]:
    with cursor() as c:
        q = "SELECT * FROM engagements"
        if not include_archived:
            q += " WHERE status != 'archived'"
        q += " ORDER BY updated_at DESC"
        return [_row_to_engagement(r) for r in c.execute(q).fetchall()]


def get_engagement(eid: str) -> dict[str, Any] | None:
    with cursor() as c:
        r = c.execute("SELECT * FROM engagements WHERE id = ?", (eid,)).fetchone()
        return _row_to_engagement(r) if r else None


def create_engagement(
    name: str, scope: list[str], exclusions: list[str], notes: str,
) -> dict[str, Any]:
    eid = str(uuid.uuid4())
    now = _now()
    with cursor() as c:
        c.execute(
            "INSERT INTO engagements (id, name, scope, exclusions, notes, "
            "status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (eid, name, json.dumps(scope), json.dumps(exclusions), notes,
             "active", now, now),
        )
    return get_engagement(eid)  # type: ignore[return-value]


def update_engagement(eid: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    fields: list[str] = []
    values: list[Any] = []
    for key in ("name", "notes", "status"):
        if key in patch:
            fields.append(f"{key} = ?")
            values.append(patch[key])
    for key in ("scope", "exclusions"):
        if key in patch:
            fields.append(f"{key} = ?")
            values.append(json.dumps(patch[key]))
    if not fields:
        return get_engagement(eid)
    fields.append("updated_at = ?")
    values.append(_now())
    values.append(eid)
    with cursor() as c:
        c.execute(f"UPDATE engagements SET {', '.join(fields)} WHERE id = ?", values)
    return get_engagement(eid)


def delete_engagement(eid: str) -> bool:
    with cursor() as c:
        c.execute("DELETE FROM engagements WHERE id = ?", (eid,))
        return c.rowcount > 0


def _row_to_engagement(r: sqlite3.Row) -> dict[str, Any]:
    return {
        "id":         r["id"],
        "name":       r["name"],
        "scope":      json.loads(r["scope"] or "[]"),
        "exclusions": json.loads(r["exclusions"] or "[]"),
        "notes":      r["notes"] or "",
        "status":     r["status"],
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
    }


# ── Scan results ────────────────────────────────────────────────────────────

def record_result(
    engagement_id: str, tool: str, target: str, summary: str, raw: Any,
) -> dict[str, Any]:
    rid = str(uuid.uuid4())
    ts = _now()
    try:
        raw_s = json.dumps(raw, default=str)[:200_000]   # 200 KB cap
    except Exception:
        raw_s = json.dumps({"__unserializable__": True})
    with cursor() as c:
        c.execute(
            "INSERT INTO scan_results (id, engagement_id, ts, tool, target, summary, raw) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (rid, engagement_id, ts, tool, target, summary[:4000], raw_s),
        )
        # Bump the parent's updated_at so the engagement list shows recent activity
        c.execute(
            "UPDATE engagements SET updated_at = ? WHERE id = ?",
            (ts, engagement_id),
        )
    return {"id": rid, "engagement_id": engagement_id, "ts": ts,
            "tool": tool, "target": target, "summary": summary}


def list_results(engagement_id: str, limit: int = 200) -> list[dict[str, Any]]:
    with cursor() as c:
        rows = c.execute(
            "SELECT id, ts, tool, target, summary FROM scan_results "
            "WHERE engagement_id = ? ORDER BY ts DESC LIMIT ?",
            (engagement_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]


def get_result(rid: str) -> dict[str, Any] | None:
    with cursor() as c:
        r = c.execute("SELECT * FROM scan_results WHERE id = ?", (rid,)).fetchone()
        if not r:
            return None
        return {**dict(r), "raw": json.loads(r["raw"])}


# ── Findings ────────────────────────────────────────────────────────────────

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


def create_finding(
    engagement_id: str, title: str, severity: str,
    description: str = "", evidence: str = "",
    cvss: float | None = None, linked_result_id: str | None = None,
) -> dict[str, Any]:
    if severity not in SEVERITY_ORDER:
        raise ValueError(f"unknown severity {severity!r}")
    fid = str(uuid.uuid4())
    ts = _now()
    with cursor() as c:
        c.execute(
            "INSERT INTO findings (id, engagement_id, ts, title, severity, "
            "cvss, description, evidence, linked_result_id, status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')",
            (fid, engagement_id, ts, title, severity, cvss,
             description, evidence, linked_result_id),
        )
        c.execute(
            "UPDATE engagements SET updated_at = ? WHERE id = ?",
            (ts, engagement_id),
        )
    return get_finding(fid)  # type: ignore[return-value]


def get_finding(fid: str) -> dict[str, Any] | None:
    with cursor() as c:
        r = c.execute("SELECT * FROM findings WHERE id = ?", (fid,)).fetchone()
        return dict(r) if r else None


def list_findings(engagement_id: str) -> list[dict[str, Any]]:
    with cursor() as c:
        rows = c.execute(
            "SELECT * FROM findings WHERE engagement_id = ? ORDER BY ts DESC",
            (engagement_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def update_finding(fid: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    fields: list[str] = []
    values: list[Any] = []
    for key in ("title", "severity", "description", "evidence", "status"):
        if key in patch:
            if key == "severity" and patch[key] not in SEVERITY_ORDER:
                raise ValueError(f"unknown severity {patch[key]!r}")
            if key == "status" and patch[key] not in {"open", "triaged", "fixed", "wont_fix"}:
                raise ValueError(f"unknown status {patch[key]!r}")
            fields.append(f"{key} = ?")
            values.append(patch[key])
    if "cvss" in patch:
        fields.append("cvss = ?")
        values.append(patch["cvss"])
    if not fields:
        return get_finding(fid)
    values.append(fid)
    with cursor() as c:
        c.execute(f"UPDATE findings SET {', '.join(fields)} WHERE id = ?", values)
    return get_finding(fid)


def delete_finding(fid: str) -> bool:
    with cursor() as c:
        c.execute("DELETE FROM findings WHERE id = ?", (fid,))
        return c.rowcount > 0


# ── Screenshots ─────────────────────────────────────────────────────────────

def add_screenshot(finding_id: str, mime: str, filename: str,
                   data: bytes) -> dict[str, Any]:
    sid = str(uuid.uuid4())
    ts = _now()
    with cursor() as c:
        c.execute(
            "INSERT INTO finding_screenshots "
            "(id, finding_id, ts, mime, filename, data, size_bytes) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (sid, finding_id, ts, mime, filename, data, len(data)),
        )
    return {"id": sid, "finding_id": finding_id, "ts": ts,
            "mime": mime, "filename": filename, "size_bytes": len(data)}


def list_screenshots(finding_id: str) -> list[dict[str, Any]]:
    with cursor() as c:
        rows = c.execute(
            "SELECT id, finding_id, ts, mime, filename, size_bytes "
            "FROM finding_screenshots WHERE finding_id = ? ORDER BY ts",
            (finding_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_screenshot(sid: str) -> tuple[str, str, bytes] | None:
    """Return (mime, filename, data) for a screenshot id, or None."""
    with cursor() as c:
        r = c.execute(
            "SELECT mime, filename, data FROM finding_screenshots WHERE id = ?",
            (sid,),
        ).fetchone()
        if not r:
            return None
        return r["mime"], r["filename"], bytes(r["data"])


def delete_screenshot(sid: str) -> bool:
    with cursor() as c:
        c.execute("DELETE FROM finding_screenshots WHERE id = ?", (sid,))
        return c.rowcount > 0


def screenshots_for_engagement(engagement_id: str) -> dict[str, list[dict[str, Any]]]:
    """Group screenshots by finding id — used by the report renderer."""
    out: dict[str, list[dict[str, Any]]] = {}
    with cursor() as c:
        rows = c.execute(
            "SELECT s.id, s.finding_id, s.ts, s.mime, s.filename, s.data "
            "FROM finding_screenshots s JOIN findings f ON s.finding_id = f.id "
            "WHERE f.engagement_id = ? ORDER BY s.ts",
            (engagement_id,),
        ).fetchall()
    for r in rows:
        out.setdefault(r["finding_id"], []).append({
            "id": r["id"], "mime": r["mime"], "filename": r["filename"],
            "data": bytes(r["data"]),  # raw bytes; renderer converts to base64
        })
    return out


# ── Stats helpers (used in the report) ──────────────────────────────────────

def engagement_stats(engagement_id: str) -> dict[str, Any]:
    with cursor() as c:
        r_count = c.execute(
            "SELECT COUNT(*) FROM scan_results WHERE engagement_id = ?",
            (engagement_id,),
        ).fetchone()[0]
        f_count = c.execute(
            "SELECT COUNT(*) FROM findings WHERE engagement_id = ?",
            (engagement_id,),
        ).fetchone()[0]
        by_sev: dict[str, int] = {}
        for row in c.execute(
            "SELECT severity, COUNT(*) FROM findings WHERE engagement_id = ? "
            "GROUP BY severity",
            (engagement_id,),
        ).fetchall():
            by_sev[row[0]] = row[1]
        tools = [
            row[0] for row in c.execute(
                "SELECT DISTINCT tool FROM scan_results WHERE engagement_id = ?",
                (engagement_id,),
            ).fetchall()
        ]
    return {
        "result_count": r_count,
        "finding_count": f_count,
        "findings_by_severity": by_sev,
        "tools_used": sorted(tools),
    }
