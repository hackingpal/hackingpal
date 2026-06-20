"""Engagement store — SQLite-backed.

An *engagement* is a named container for a single piece of work: a pentest, a
red-team exercise, a bug-bounty target. Every scan result the user produces
while an engagement is "active" gets auto-recorded into it (frontend posts
into `/engagements/{id}/results`). Results can be **promoted to findings**
with a severity + evidence; findings render in the report export.

The DB path is OS-appropriate (see `lib.platform_util.app_data_dir`) so the
file survives reinstalls of the .app bundle. We use stdlib `sqlite3` — no
extra deps, schema is migrated in-place if the file already exists.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from lib.platform_util import app_data_dir


def _db_path() -> Path:
    return app_data_dir() / "engagements.db"


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
      updated_at        TEXT NOT NULL DEFAULT '',
      title             TEXT NOT NULL,
      severity          TEXT NOT NULL,  -- info|low|medium|high|critical
      cvss              REAL,
      cvss_vector       TEXT,           -- nullable CVSS v3.1 vector string
      tool              TEXT NOT NULL DEFAULT '',   -- which tool produced it
      target            TEXT NOT NULL DEFAULT '',
      description       TEXT NOT NULL DEFAULT '',
      evidence          TEXT NOT NULL DEFAULT '',
      linked_result_id  TEXT REFERENCES scan_results(id) ON DELETE SET NULL,
      status            TEXT NOT NULL DEFAULT 'open'
      -- status: open|confirmed|false_positive|remediated (canonical)
      -- legacy statuses still accepted: triaged|fixed|wont_fix
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_results_engagement ON scan_results(engagement_id, ts DESC)",
    "CREATE INDEX IF NOT EXISTS ix_findings_engagement ON findings(engagement_id, ts DESC)",
    # ── Audit log ───────────────────────────────────────────────────────────
    # Append-only record of every tool invocation. One row per action: it's
    # INSERTed at start (status='started') and UPDATEd at completion to set
    # ts_end + status + summary. We never DELETE — that's the whole point.
    # `engagement_id` is nullable because Lab-mode runs aren't tied to one.
    """
    CREATE TABLE IF NOT EXISTS audit_log (
      id             TEXT PRIMARY KEY,
      engagement_id  TEXT REFERENCES engagements(id) ON DELETE SET NULL,
      ts_start       TEXT NOT NULL,
      ts_end         TEXT,
      tool           TEXT NOT NULL,
      target         TEXT NOT NULL DEFAULT '',
      argv_json      TEXT NOT NULL DEFAULT '[]',
      approver       TEXT NOT NULL DEFAULT 'local',
      mode           TEXT NOT NULL DEFAULT 'lab',  -- lab|engagement
      status         TEXT NOT NULL DEFAULT 'started',
      summary        TEXT NOT NULL DEFAULT '',
      error          TEXT
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_audit_engagement ON audit_log(engagement_id, ts_start DESC)",
    "CREATE INDEX IF NOT EXISTS ix_audit_ts ON audit_log(ts_start DESC)",
    "CREATE INDEX IF NOT EXISTS ix_audit_tool ON audit_log(tool, ts_start DESC)",
    # ── Targets registry ────────────────────────────────────────────────────
    # First-class target objects. engagement_id NULL = global (lab targets,
    # manual scratch, discovery results not yet bound to an engagement).
    # `kind` is where the target came from; `scope_tag` is its policy band
    # for engagement-mode enforcement (lab|owned|authorized|manual).
    # `hidden=1` is used for lab targets after the lab stops — preserves
    # history so suggested-step intent prefill keeps working across cycles.
    """
    CREATE TABLE IF NOT EXISTS targets (
      id             TEXT PRIMARY KEY,
      engagement_id  TEXT REFERENCES engagements(id) ON DELETE CASCADE,
      name           TEXT NOT NULL,
      address        TEXT NOT NULL,
      kind           TEXT NOT NULL,
      source_meta    TEXT NOT NULL DEFAULT '{}',
      scope_tag      TEXT NOT NULL DEFAULT 'manual',
      added_at       TEXT NOT NULL,
      last_seen_at   TEXT,
      hidden         INTEGER NOT NULL DEFAULT 0
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_targets_engagement ON targets(engagement_id)",
    "CREATE INDEX IF NOT EXISTS ix_targets_kind ON targets(kind, hidden)",
    # ── Tool summaries (AI rollups of a single tool run) ────────────────────
    # One row per "Summarize results" click. engagement_id is nullable so the
    # button still works outside an active engagement (in that case the row
    # just isn't persisted server-side — the streaming response is shown
    # locally in the page state).
    """
    CREATE TABLE IF NOT EXISTS tool_summaries (
      id            TEXT PRIMARY KEY,
      engagement_id TEXT REFERENCES engagements(id) ON DELETE CASCADE,
      result_id     TEXT REFERENCES scan_results(id) ON DELETE SET NULL,
      ts            TEXT NOT NULL,
      tool          TEXT NOT NULL,
      target        TEXT NOT NULL DEFAULT '',
      summary       TEXT NOT NULL,
      raw_excerpt   TEXT NOT NULL DEFAULT ''
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_summaries_engagement ON tool_summaries(engagement_id, ts DESC)",
    # ── Report snapshots ────────────────────────────────────────────────────
    # A point-in-time export of the engagement. Generated explicitly via
    # POST /engagements/{eid}/report/generate (which also runs the AI rollup).
    # The HTML + MD blobs are stored inline so a snapshot stays usable even
    # after findings change underneath it.
    """
    CREATE TABLE IF NOT EXISTS report_snapshots (
      id            TEXT PRIMARY KEY,
      engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
      ts            TEXT NOT NULL,
      rollup        TEXT NOT NULL DEFAULT '',
      html          TEXT NOT NULL DEFAULT '',
      md            TEXT NOT NULL DEFAULT ''
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_snapshots_engagement ON report_snapshots(engagement_id, ts DESC)",
]


_conn: sqlite3.Connection | None = None
_conn_lock = threading.Lock()
_write_lock = threading.Lock()


def _migrate_findings(conn: sqlite3.Connection) -> None:
    """Add columns to `findings` for older DBs that predate the tracker."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(findings)").fetchall()}
    if not cols:
        return  # table will be created by SCHEMA below
    if "tool" not in cols:
        conn.execute("ALTER TABLE findings ADD COLUMN tool TEXT NOT NULL DEFAULT ''")
    if "target" not in cols:
        conn.execute("ALTER TABLE findings ADD COLUMN target TEXT NOT NULL DEFAULT ''")
    if "cvss_vector" not in cols:
        conn.execute("ALTER TABLE findings ADD COLUMN cvss_vector TEXT")
    if "updated_at" not in cols:
        conn.execute("ALTER TABLE findings ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''")


def _connect() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    with _conn_lock:
        if _conn is not None:
            return _conn
        conn = sqlite3.connect(_db_path(), check_same_thread=False)
        # WAL gives us concurrent readers + a single writer without the default
        # rollback-journal "database is locked" errors when the backend threadpool
        # serves multiple engagement endpoints at once.
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.row_factory = sqlite3.Row
        for stmt in SCHEMA:
            conn.execute(stmt)
        _migrate_findings(conn)
        conn.commit()
        _conn = conn
        return conn


@contextmanager
def cursor() -> Iterator[sqlite3.Cursor]:
    conn = _connect()
    # Serialise writers in-process. WAL handles cross-process locking but a
    # shared sqlite3.Connection is not itself thread-safe.
    with _write_lock:
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

# Canonical statuses (open|confirmed|false_positive|remediated) plus the
# legacy set that predates the Findings Tracker. Both are accepted writes
# so older engagements keep loading; the new UI emits only the canonical set.
VALID_STATUSES = {
    "open", "confirmed", "false_positive", "remediated",
    "triaged", "fixed", "wont_fix",
}


def create_finding(
    engagement_id: str, title: str, severity: str,
    description: str = "", evidence: str = "",
    cvss: float | None = None, linked_result_id: str | None = None,
    tool: str = "", target: str = "", cvss_vector: str | None = None,
    status: str = "open",
) -> dict[str, Any]:
    if severity not in SEVERITY_ORDER:
        raise ValueError(f"unknown severity {severity!r}")
    if status not in VALID_STATUSES:
        raise ValueError(f"unknown status {status!r}")
    fid = str(uuid.uuid4())
    ts = _now()
    with cursor() as c:
        c.execute(
            "INSERT INTO findings (id, engagement_id, ts, updated_at, title, severity, "
            "cvss, cvss_vector, tool, target, description, evidence, "
            "linked_result_id, status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (fid, engagement_id, ts, ts, title, severity, cvss, cvss_vector,
             tool, target, description, evidence, linked_result_id, status),
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
    for key in ("title", "severity", "description", "evidence", "status",
                "tool", "target"):
        if key in patch:
            if key == "severity" and patch[key] not in SEVERITY_ORDER:
                raise ValueError(f"unknown severity {patch[key]!r}")
            if key == "status" and patch[key] not in VALID_STATUSES:
                raise ValueError(f"unknown status {patch[key]!r}")
            fields.append(f"{key} = ?")
            values.append(patch[key])
    if "cvss" in patch:
        fields.append("cvss = ?")
        values.append(patch["cvss"])
    if "cvss_vector" in patch:
        fields.append("cvss_vector = ?")
        values.append(patch["cvss_vector"])
    if not fields:
        return get_finding(fid)
    # Always bump updated_at on a real mutation.
    fields.append("updated_at = ?")
    values.append(_now())
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


# ── Tool summaries ──────────────────────────────────────────────────────────

def record_tool_summary(
    engagement_id: str | None, tool: str, target: str, summary: str,
    raw_excerpt: str = "", result_id: str | None = None,
) -> dict[str, Any]:
    sid = str(uuid.uuid4())
    ts = _now()
    with cursor() as c:
        c.execute(
            "INSERT INTO tool_summaries "
            "(id, engagement_id, result_id, ts, tool, target, summary, raw_excerpt) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (sid, engagement_id, result_id, ts, tool, target,
             summary, raw_excerpt[:8000]),
        )
        if engagement_id:
            c.execute(
                "UPDATE engagements SET updated_at = ? WHERE id = ?",
                (ts, engagement_id),
            )
    return {"id": sid, "engagement_id": engagement_id, "result_id": result_id,
            "ts": ts, "tool": tool, "target": target, "summary": summary}


def list_tool_summaries(
    engagement_id: str, limit: int = 200,
) -> list[dict[str, Any]]:
    with cursor() as c:
        rows = c.execute(
            "SELECT id, result_id, ts, tool, target, summary "
            "FROM tool_summaries WHERE engagement_id = ? "
            "ORDER BY ts DESC LIMIT ?",
            (engagement_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]


def get_tool_summary(sid: str) -> dict[str, Any] | None:
    with cursor() as c:
        r = c.execute(
            "SELECT * FROM tool_summaries WHERE id = ?", (sid,),
        ).fetchone()
        return dict(r) if r else None


# ── Report snapshots ────────────────────────────────────────────────────────

def create_report_snapshot(
    engagement_id: str, rollup: str, html: str, md: str,
) -> dict[str, Any]:
    sid = str(uuid.uuid4())
    ts = _now()
    with cursor() as c:
        c.execute(
            "INSERT INTO report_snapshots (id, engagement_id, ts, rollup, html, md) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (sid, engagement_id, ts, rollup, html, md),
        )
        c.execute(
            "UPDATE engagements SET updated_at = ? WHERE id = ?",
            (ts, engagement_id),
        )
    return {"id": sid, "engagement_id": engagement_id, "ts": ts,
            "rollup_preview": rollup[:280]}


def list_report_snapshots(engagement_id: str) -> list[dict[str, Any]]:
    with cursor() as c:
        rows = c.execute(
            "SELECT id, ts, substr(rollup, 1, 280) AS rollup_preview, "
            "length(html) AS html_bytes, length(md) AS md_bytes "
            "FROM report_snapshots WHERE engagement_id = ? ORDER BY ts DESC",
            (engagement_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_report_snapshot(sid: str) -> dict[str, Any] | None:
    with cursor() as c:
        r = c.execute(
            "SELECT * FROM report_snapshots WHERE id = ?", (sid,),
        ).fetchone()
        return dict(r) if r else None


def delete_report_snapshot(sid: str) -> bool:
    with cursor() as c:
        c.execute("DELETE FROM report_snapshots WHERE id = ?", (sid,))
        return c.rowcount > 0
