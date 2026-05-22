// Active-engagement state.
//
// "Active engagement" is a per-window choice (persisted to localStorage)
// that drives auto-recording of scan results. When set, every successful
// api() call AND every useAttackWS done-event POSTs to
// /engagements/{id}/results.
//
// The engagement *list* itself lives on the backend (SQLite). This module
// only stores which one is currently focused.

import { useEffect, useState } from "react";
import { BACKEND_URL, parseError } from "../api";

export type EngagementStatus = "active" | "completed" | "archived";

export type Engagement = {
  id: string;
  name: string;
  scope: string[];
  exclusions: string[];
  notes: string;
  status: EngagementStatus;
  created_at: string;
  updated_at: string;
};

export type Finding = {
  id: string;
  engagement_id: string;
  ts: string;
  title: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  cvss: number | null;
  description: string;
  evidence: string;
  linked_result_id: string | null;
  status: "open" | "triaged" | "fixed" | "wont_fix";
};

export type ScanResult = {
  id: string;
  ts: string;
  tool: string;
  target: string;
  summary: string;
};

// ── Active engagement state ─────────────────────────────────────────────────

const ACTIVE_KEY = "mhp:active-engagement:v1";

let activeId: string | null = null;
try { activeId = localStorage.getItem(ACTIVE_KEY); } catch { /* ignore */ }

const listeners = new Set<() => void>();
function notify() { for (const l of listeners) l(); }

export function getActiveEngagementId(): string | null {
  return activeId;
}

export function setActiveEngagementId(id: string | null): void {
  activeId = id;
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch { /* quota */ }
  notify();
}

export function useActiveEngagementId(): string | null {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return activeId;
}

// ── Auto-record ─────────────────────────────────────────────────────────────

const RECORD_SKIP = [
  /^\/health/, /^\/chat\//, /^\/settings\//, /^\/system\//,
  /^\/engagements/,
];

/**
 * Best-effort fire-and-forget POST of a scan result to the active engagement.
 * Returns silently on any failure (network / 404 / 5xx) — auto-recording must
 * never block the actual scan flow.
 */
export async function recordResultIfActive(
  toolPath: string, target: string, summary: string, raw: unknown,
): Promise<void> {
  const eid = activeId;
  if (!eid) return;
  if (RECORD_SKIP.some((re) => re.test(toolPath))) return;
  try {
    await fetch(`${BACKEND_URL}/engagements/${eid}/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: toolPath,
        target: target.slice(0, 500),
        summary: summary.slice(0, 4000),
        raw,
      }),
    });
  } catch {
    /* best-effort */
  }
}

// ── CRUD helpers (light wrappers — pages use these directly) ────────────────

export async function listEngagements(includeArchived = false): Promise<Engagement[]> {
  const r = await fetch(
    `${BACKEND_URL}/engagements?include_archived=${includeArchived}`,
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = (await r.json()) as { engagements: Engagement[] };
  return body.engagements;
}

export async function createEngagement(payload: {
  name: string; scope: string[]; exclusions: string[]; notes: string;
}): Promise<Engagement> {
  const r = await fetch(`${BACKEND_URL}/engagements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function updateEngagement(
  id: string, patch: Partial<Engagement>,
): Promise<Engagement> {
  const r = await fetch(`${BACKEND_URL}/engagements/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function deleteEngagement(id: string): Promise<void> {
  const r = await fetch(`${BACKEND_URL}/engagements/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

export async function listFindings(eid: string): Promise<Finding[]> {
  const r = await fetch(`${BACKEND_URL}/engagements/${eid}/findings`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = (await r.json()) as { findings: Finding[] };
  return body.findings;
}

export async function createFinding(eid: string, payload: {
  title: string; severity: Finding["severity"]; description?: string;
  evidence?: string; cvss?: number | null; linked_result_id?: string | null;
}): Promise<Finding> {
  const r = await fetch(`${BACKEND_URL}/engagements/${eid}/findings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function updateFinding(
  eid: string, fid: string, patch: Partial<Finding>,
): Promise<Finding> {
  const r = await fetch(`${BACKEND_URL}/engagements/${eid}/findings/${fid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function deleteFinding(eid: string, fid: string): Promise<void> {
  const r = await fetch(`${BACKEND_URL}/engagements/${eid}/findings/${fid}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

export async function listResults(eid: string, limit = 200): Promise<ScanResult[]> {
  const r = await fetch(`${BACKEND_URL}/engagements/${eid}/results?limit=${limit}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = (await r.json()) as { results: ScanResult[] };
  return body.results;
}

export async function fetchSuggestions(): Promise<
  { category: string; label: string; description: string }[]
> {
  const r = await fetch(`${BACKEND_URL}/engagements/_catalog/suggestions`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = (await r.json()) as { suggestions: { category: string; label: string; description: string }[] };
  return body.suggestions;
}

export function reportUrl(eid: string, format: "html" | "md"): string {
  return `${BACKEND_URL}/engagements/${eid}/report?format=${format}`;
}
