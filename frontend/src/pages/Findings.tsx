// Findings — the evidence layer of an engagement.
//
// Promote-to-Finding actions on tool pages POST into this list. This page
// is the read/edit/triage surface: filter by severity + status, sort
// critical-first, click into the detail panel to edit severity, status,
// description, or notes; delete to remove. Every mutation is audited
// server-side via the standalone /findings router.

import { useEffect, useMemo, useState } from "react";
import {
  deleteTrackedFinding,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  listFindings,
  patchTrackedFinding,
  scoreFindingCvss,
  summarizeFinding,
  useActiveEngagementId,
  type Finding,
  type FindingSeverity,
  type FindingStatus,
} from "../lib/engagement";
import CvssCalculator, { type CvssResult } from "../components/CvssCalculator";

type Props = { onJumpTo?: (id: string) => void };

const SEV_BG: Record<FindingSeverity, string> = {
  critical: "bg-danger/20 border-danger/40 text-danger",
  high:     "bg-amber/20 border-amber/40 text-amber",
  medium:   "bg-amber/10 border-amber/30 text-amber",
  low:      "bg-accent/10 border-accent/30 text-accent",
  info:     "bg-ink-dim/10 border-divider text-ink-muted",
};

const SEV_RANK: Record<FindingSeverity, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
};

function statusLabel(s: FindingStatus): string {
  return s.replace(/_/g, " ");
}

export default function Findings({ onJumpTo }: Props) {
  const activeId = useActiveEngagementId();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [filterSev, setFilterSev] = useState<Set<FindingSeverity>>(
    new Set(FINDING_SEVERITIES),
  );
  const [filterStat, setFilterStat] = useState<Set<FindingStatus>>(
    new Set(FINDING_STATUSES),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    if (!activeId) return;
    setLoading(true); setError("");
    try {
      setFindings(await listFindings(activeId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [activeId]);

  const selected = useMemo(
    () => findings.find((f) => f.id === selectedId) ?? null,
    [findings, selectedId],
  );

  const filtered = useMemo(() => {
    const list = findings.filter(
      (f) => filterSev.has(f.severity) && filterStat.has(f.status),
    );
    list.sort((a, b) => {
      const sd = SEV_RANK[a.severity] - SEV_RANK[b.severity];
      if (sd !== 0) return sd;
      return a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0;
    });
    return list;
  }, [findings, filterSev, filterStat]);

  const counts = useMemo(() => {
    const acc: Record<FindingSeverity, number> = {
      critical: 0, high: 0, medium: 0, low: 0, info: 0,
    };
    for (const f of findings) acc[f.severity] += 1;
    return acc;
  }, [findings]);

  if (!activeId) {
    return (
      <div className="h-full flex flex-col">
        <header className="border-b border-divider px-6 pt-4 pb-3">
          <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">
            EVIDENCE LAYER
          </div>
          <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
            Findings
          </h2>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center text-ink-muted p-6 text-center">
          <p className="text-[13px] mb-2 text-ink-primary font-bold">
            No active engagement.
          </p>
          <p className="text-[12px] max-w-md">
            Findings always belong to an engagement. Select or create one from
            the engagement pill in the top bar, then promote a result from
            any tool page.
          </p>
          {onJumpTo && (
            <button onClick={() => onJumpTo("engagements")}
                    className="mt-4 px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold">
              Open Engagements
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">
          EVIDENCE LAYER
        </div>
        <div className="mt-0.5 flex items-baseline gap-3 flex-wrap">
          <h2 className="text-base font-bold tracking-wide text-ink-primary">
            Findings
          </h2>
          <CountsHeader counts={counts} />
          <span className="flex-1" />
          <span className="text-[11px] text-ink-dim">
            {filtered.length} of {findings.length}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-4 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="text-ink-muted tracking-wider">SEV:</span>
            {FINDING_SEVERITIES.map((s) => (
              <button key={s}
                      onClick={() => toggle(setFilterSev, s)}
                      className={
                        "px-1.5 py-0.5 rounded border uppercase tracking-wider " +
                        (filterSev.has(s)
                          ? SEV_BG[s]
                          : "border-divider text-ink-dim opacity-50")
                      }>
                {s}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-ink-muted tracking-wider">STATUS:</span>
            {FINDING_STATUSES.map((s) => (
              <button key={s}
                      onClick={() => toggle(setFilterStat, s)}
                      className={
                        "px-1.5 py-0.5 rounded border uppercase tracking-wider " +
                        (filterStat.has(s)
                          ? "border-divider text-ink-primary bg-bg-nav-active"
                          : "border-divider text-ink-dim opacity-50")
                      }>
                {statusLabel(s)}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex">
        <div className="w-1/2 overflow-y-auto border-r border-divider p-3 space-y-2">
          {error && <div className="text-[12px] text-danger">⚠ {error}</div>}
          {loading && <div className="text-[12px] text-ink-dim">Loading…</div>}
          {!loading && filtered.length === 0 && (
            <EmptyState hasAny={findings.length > 0} />
          )}
          {filtered.map((f) => (
            <button
              key={f.id}
              onClick={() => setSelectedId(f.id)}
              className={
                "w-full text-left border rounded p-2 transition " +
                (selectedId === f.id
                  ? "border-accent bg-bg-nav-active"
                  : "border-divider hover:border-accent/40")
              }
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={"text-[10px] uppercase tracking-wider border rounded px-1.5 " + SEV_BG[f.severity]}>
                  {f.severity}
                </span>
                <span className="text-[13px] font-bold text-ink-primary truncate flex-1">
                  {f.title}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-ink-dim">
                  {statusLabel(f.status)}
                </span>
              </div>
              <div className="text-[10px] text-ink-dim font-mono truncate">
                {f.tool && <span className="text-accent">{f.tool}</span>}
                {f.tool && f.target && <span> · </span>}
                {f.target && <span>{f.target}</span>}
                {(f.tool || f.target) && <span> · </span>}
                <span>{new Date(f.ts).toLocaleString()}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {selected ? (
            <DetailPanel finding={selected}
                         onChange={(updated) => {
                           setFindings((list) => list.map((f) => f.id === updated.id ? updated : f));
                         }}
                         onDelete={async () => {
                           await deleteTrackedFinding(selected.id);
                           setSelectedId(null);
                           void refresh();
                         }} />
          ) : (
            <div className="h-full flex items-center justify-center text-ink-dim text-[12px] italic p-4">
              Select a finding to view its evidence and triage state.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function toggle<T>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, value: T) {
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  });
}

function CountsHeader({ counts }: { counts: Record<FindingSeverity, number> }) {
  const order: FindingSeverity[] = ["critical", "high", "medium", "low", "info"];
  const visible = order.filter((s) => counts[s] > 0);
  if (visible.length === 0) return null;
  return (
    <span className="text-[11px] text-ink-muted font-mono">
      {visible.map((s, i) => (
        <span key={s}>
          {i > 0 && <span className="text-ink-dim"> · </span>}
          <span className={
            s === "critical" ? "text-danger" :
            s === "high"     ? "text-amber" :
            s === "medium"   ? "text-amber/80" :
            s === "low"      ? "text-accent" :
                               "text-ink-muted"
          }>
            {counts[s]} {s}
          </span>
        </span>
      ))}
    </span>
  );
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="text-[12px] text-ink-muted italic p-3">
      {hasAny ? (
        "No findings match the current filters."
      ) : (
        <>
          No findings yet. Run a scan and use the{" "}
          <span className="not-italic text-accent">⬆ Promote</span>{" "}
          action on any result row (Port Scanner, Nmap, TLS Auditor,
          web-exploit tools) to track it here.
        </>
      )}
    </div>
  );
}

// ── Detail panel ───────────────────────────────────────────────────────────

function DetailPanel({
  finding, onChange, onDelete,
}: {
  finding: Finding;
  onChange: (f: Finding) => void;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(finding.title);
  const [severity, setSeverity] = useState<FindingSeverity>(finding.severity);
  const [status, setStatus] = useState<FindingStatus>(finding.status);
  const [description, setDescription] = useState(finding.description);
  const [evidence, setEvidence] = useState(finding.evidence);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [scoring, setScoring] = useState(false);
  const [scoringOpen, setScoringOpen] = useState(false);
  const [scoreError, setScoreError] = useState("");
  const [pendingScore, setPendingScore] = useState<CvssResult | null>(null);

  useEffect(() => {
    setTitle(finding.title);
    setSeverity(finding.severity);
    setStatus(finding.status);
    setDescription(finding.description);
    setEvidence(finding.evidence);
    setEditing(false);
    setError("");
    setSummarizing(false);
    setSummaryError("");
    setScoring(false);
    setScoringOpen(false);
    setScoreError("");
    setPendingScore(null);
  }, [finding.id]);

  async function generateSummary() {
    setSummarizing(true); setSummaryError("");
    try {
      const updated = await summarizeFinding(finding.id);
      onChange(updated);
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : String(e));
    } finally {
      setSummarizing(false);
    }
  }

  async function applyScore(result: CvssResult) {
    setScoring(true); setScoreError("");
    try {
      const updated = await scoreFindingCvss(finding.id, result.vector);
      onChange(updated);
      setScoringOpen(false);
      setPendingScore(null);
    } catch (e) {
      setScoreError(e instanceof Error ? e.message : String(e));
    } finally {
      setScoring(false);
    }
  }

  async function quickStatus(next: FindingStatus) {
    setSaving(true); setError("");
    try {
      const updated = await patchTrackedFinding(finding.id, { status: next });
      onChange(updated);
      setStatus(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    setSaving(true); setError("");
    try {
      const updated = await patchTrackedFinding(finding.id, {
        title, severity, status, description, evidence,
      });
      onChange(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete finding "${finding.title}"?`)) return;
    await onDelete();
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className={"text-[10px] uppercase tracking-wider border rounded px-1.5 " + SEV_BG[severity]}>
          {severity}
        </span>
        <h3 className="text-[15px] font-bold text-ink-primary flex-1 truncate">
          {finding.title}
        </h3>
        <button onClick={() => void remove()}
                className="text-[11px] uppercase tracking-wider border border-danger
                           rounded px-2 py-0.5 text-danger">
          Delete
        </button>
      </div>

      <div className="text-[11px] text-ink-dim font-mono">
        <span className="text-accent">{finding.tool || "(no tool)"}</span>
        {finding.target && <> · {finding.target}</>}
        {" · "}
        created {new Date(finding.ts).toLocaleString()}
        {finding.updated_at && finding.updated_at !== finding.ts && (
          <> · updated {new Date(finding.updated_at).toLocaleString()}</>
        )}
      </div>

      {/* Status quick-toggle row — always visible, even outside edit mode. */}
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="text-ink-muted tracking-wider">STATUS:</span>
        {FINDING_STATUSES.map((s) => (
          <button key={s}
                  disabled={saving || s === status}
                  onClick={() => void quickStatus(s)}
                  className={
                    "px-2 py-0.5 rounded border uppercase tracking-wider " +
                    (s === status
                      ? "border-accent text-accent bg-accent/10"
                      : "border-divider text-ink-muted hover:text-ink-primary disabled:opacity-40")
                  }>
            {statusLabel(s)}
          </button>
        ))}
      </div>

      {editing ? (
        <div className="space-y-3">
          <Field label="TITLE">
            <input value={title} onChange={(e) => setTitle(e.target.value)}
                   className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                              text-[13px] focus:outline-none focus:border-accent" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="SEVERITY">
              <select value={severity}
                      onChange={(e) => setSeverity(e.target.value as FindingSeverity)}
                      className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                 text-[12px] focus:outline-none focus:border-accent">
                {FINDING_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="STATUS">
              <select value={status}
                      onChange={(e) => setStatus(e.target.value as FindingStatus)}
                      className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                 text-[12px] focus:outline-none focus:border-accent">
                {FINDING_STATUSES.map((s) => (
                  <option key={s} value={s}>{statusLabel(s)}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="DESCRIPTION / NOTES">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                      rows={4}
                      className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                 text-[12px] focus:outline-none focus:border-accent" />
          </Field>
          <Field label="EVIDENCE">
            <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)}
                      rows={8}
                      className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                 text-[11px] font-mono focus:outline-none focus:border-accent" />
          </Field>

          {error && <div className="text-[12px] text-danger">⚠ {error}</div>}

          <div className="flex justify-end gap-2">
            <button onClick={() => {
                      setEditing(false);
                      setTitle(finding.title);
                      setSeverity(finding.severity);
                      setStatus(finding.status);
                      setDescription(finding.description);
                      setEvidence(finding.evidence);
                    }}
                    className="px-3 py-1.5 rounded border border-divider text-ink-muted text-[12px]">
              Cancel
            </button>
            <button onClick={save} disabled={saving || !title.trim()}
                    className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                               disabled:opacity-40 disabled:cursor-not-allowed">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* AI summary — primary content. Auto-populated on promote; legacy
              findings get a Generate button. */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <div className="text-[10px] uppercase tracking-wider text-accent">
                ✨ AI SUMMARY
              </div>
              {finding.ai_summary && (
                <button onClick={() => void generateSummary()}
                        disabled={summarizing}
                        className="text-[10px] uppercase tracking-wider text-ink-dim
                                   hover:text-accent disabled:opacity-40">
                  {summarizing ? "Regenerating…" : "Regenerate"}
                </button>
              )}
            </div>
            {finding.ai_summary ? (
              <div className="text-[12px] whitespace-pre-wrap text-ink-primary
                              bg-accent/5 border border-accent/20 rounded p-3">
                {finding.ai_summary}
              </div>
            ) : (
              <div className="text-[12px] text-ink-muted border border-divider rounded p-3">
                {summarizing ? (
                  <span className="text-accent">Generating summary…</span>
                ) : (
                  <>
                    <span className="italic">No AI summary yet.</span>{" "}
                    <button onClick={() => void generateSummary()}
                            className="text-accent hover:underline">
                      Generate AI summary
                    </button>
                  </>
                )}
              </div>
            )}
            {summaryError && (
              <div className="mt-1 text-[11px] text-danger">⚠ {summaryError}</div>
            )}
          </section>

          {/* CVSS score — once scored, the band is the badge across the app
              (single source of truth). Inline calculator opens on demand. */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <div className="text-[10px] uppercase tracking-wider text-accent">
                SCORE (CVSS v3.1)
              </div>
              {finding.cvss != null && finding.cvss_vector && !scoringOpen && (
                <button onClick={() => setScoringOpen(true)}
                        className="text-[10px] uppercase tracking-wider text-ink-dim
                                   hover:text-accent">
                  Edit score
                </button>
              )}
            </div>
            {finding.cvss != null && finding.cvss_vector && !scoringOpen ? (
              <div className="border border-divider rounded p-3 flex items-center gap-3">
                <div className={
                  "text-2xl font-bold tabular-nums px-3 py-1 rounded " +
                  SEV_BG[severity]
                }>
                  {finding.cvss.toFixed(1)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={"text-[10px] uppercase tracking-wider mb-0.5 " +
                                  "px-1.5 border rounded inline-block " + SEV_BG[severity]}>
                    {severity}
                  </div>
                  <div className="font-mono text-[11px] text-ink-muted truncate">
                    {finding.cvss_vector}
                  </div>
                </div>
                <button onClick={() => void navigator.clipboard.writeText(
                          finding.cvss_vector || "")}
                        className="text-[10px] uppercase tracking-wider text-ink-dim
                                   border border-divider rounded px-2 py-1 hover:text-accent">
                  Copy
                </button>
              </div>
            ) : scoringOpen ? (
              <div className="border border-accent/20 bg-bg-base rounded p-2 space-y-2">
                <CvssCalculator
                  initialVector={finding.cvss_vector || undefined}
                  onChange={setPendingScore}
                  compact
                />
                {scoreError && (
                  <div className="text-[11px] text-danger">⚠ {scoreError}</div>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setScoringOpen(false); setPendingScore(null); }}
                          className="text-[11px] uppercase tracking-wider text-ink-muted
                                     border border-divider rounded px-2 py-1">
                    Cancel
                  </button>
                  <button onClick={() => pendingScore && void applyScore(pendingScore)}
                          disabled={scoring || !pendingScore}
                          className="text-[11px] uppercase tracking-wider bg-accent text-white
                                     rounded px-2 py-1 disabled:opacity-40 font-bold">
                    {scoring ? "Applying…" : "Apply to finding"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-[12px] text-ink-muted border border-divider rounded p-3">
                <span className="italic">Unscored.</span>{" "}
                <button onClick={() => setScoringOpen(true)}
                        className="text-accent hover:underline">
                  Calculate CVSS
                </button>
              </div>
            )}
          </section>

          {/* Secondary actions — manual notes editing lives below the AI
              summary now, not at the top. */}
          <div className="flex items-center gap-2 text-[11px]">
            <button onClick={() => setEditing(true)}
                    className="uppercase tracking-wider border border-divider
                               rounded px-2 py-0.5 text-ink-muted hover:text-ink-primary">
              Edit notes
            </button>
            <span className="text-ink-dim">
              Edit the analyst description + evidence below if you want to add notes.
            </span>
          </div>

          {description && (
            <section>
              <div className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">
                DESCRIPTION
              </div>
              <div className="text-[12px] whitespace-pre-wrap text-ink-primary">
                {description}
              </div>
            </section>
          )}
          {evidence && (
            <section>
              <div className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">
                EVIDENCE
              </div>
              <pre className="text-[11px] font-mono whitespace-pre-wrap bg-bg-base
                              border border-divider rounded p-2 max-h-96 overflow-y-auto">
                {evidence}
              </pre>
            </section>
          )}
          {error && <div className="text-[12px] text-danger">⚠ {error}</div>}
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest text-ink-muted block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
