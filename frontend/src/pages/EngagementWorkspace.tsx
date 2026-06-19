// EngagementWorkspace — unified Evidence + Findings + Report surface.
//
// Replaces the three separate sidebar entries with one tabbed page that
// reflects the engagement-first model: methodology timeline (what the
// tester did), findings table (what they concluded), and the live
// report (the deliverable). In lab mode it degrades to a lightweight
// "lab session report" view backed by the in-memory session log.

import { useEffect, useMemo, useState } from "react";
import {
  createFinding,
  deleteFinding,
  listEngagements,
  listFindings,
  listResults,
  reportUrl,
  updateFinding,
  useActiveEngagementId,
  type Engagement,
  type Finding,
  type ScanResult,
} from "../lib/engagement";
import { useMode } from "../lib/mode";
import { useSessionLog, type SessionEvent } from "../lib/sessionLog";
import { authFetch, BACKEND_URL, parseError } from "../api";

type Severity = Finding["severity"];
type Status = Finding["status"];

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const STATUSES: Status[] = ["open", "triaged", "fixed", "wont_fix"];

const SEV_BG: Record<Severity, string> = {
  critical: "bg-danger/20 border-danger/40 text-danger",
  high:     "bg-amber/20 border-amber/40 text-amber",
  medium:   "bg-amber/10 border-amber/30 text-amber",
  low:      "bg-accent/10 border-accent/30 text-accent",
  info:     "bg-ink-dim/10 border-divider text-ink-muted",
};

type Tab = "timeline" | "findings" | "report";
type TimelineFilter = "all" | "results" | "findings";

type Props = { onJumpTo: (id: string) => void };

export default function EngagementWorkspace({ onJumpTo }: Props) {
  const mode = useMode();
  const activeId = useActiveEngagementId();

  if (mode === "lab" || !activeId) {
    return <LabReport onJumpTo={onJumpTo} hasActiveEng={!!activeId} mode={mode} />;
  }
  return <EngagementView eid={activeId} onJumpTo={onJumpTo} />;
}

// ── Engagement-mode workspace ───────────────────────────────────────────────

function EngagementView({ eid, onJumpTo }: { eid: string; onJumpTo: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>("timeline");
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true); setError("");
    try {
      const [engs, fs, rs] = await Promise.all([
        listEngagements(true),
        listFindings(eid),
        listResults(eid, 500),
      ]);
      setEngagement(engs.find((e) => e.id === eid) ?? null);
      setFindings(fs);
      setResults(rs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [eid]);

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">
          ENGAGEMENT WORKSPACE
        </div>
        {engagement ? (
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-bold tracking-wide text-ink-primary truncate">
              {engagement.name}
            </h2>
            <span className="text-[10px] uppercase tracking-wider text-accent
                             border border-accent/40 rounded px-1.5">
              active
            </span>
            <span className="text-[9px] uppercase tracking-wider text-ink-dim
                             border border-divider rounded px-1.5">
              {engagement.status}
            </span>
            <span className="text-[11px] text-ink-dim ml-1">
              {engagement.scope.length} in-scope · {engagement.exclusions.length} excluded
            </span>
            <span className="flex-1" />
            <button onClick={() => onJumpTo("engagements")}
                    className="text-[11px] text-ink-muted hover:text-ink-primary">
              Edit engagement →
            </button>
          </div>
        ) : (
          <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
            Workspace
          </h2>
        )}
        {engagement && engagement.scope.length > 0 && (
          <div className="mt-1.5 text-[11px] text-ink-muted font-mono break-words">
            {engagement.scope.slice(0, 8).join(", ")}
            {engagement.scope.length > 8 ? ` … (+${engagement.scope.length - 8})` : ""}
          </div>
        )}

        <nav className="mt-3 flex gap-1 text-[11px]">
          {([
            ["timeline",  "Methodology"],
            ["findings",  `Findings (${findings.length})`],
            ["report",    "Report"],
          ] as [Tab, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
                    className={
                      "px-3 py-1.5 rounded-t border-b-2 tracking-wide uppercase " +
                      (tab === id
                        ? "border-accent text-ink-primary"
                        : "border-transparent text-ink-muted hover:text-ink-primary")
                    }>
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="text-[12px] text-danger px-6 py-2">{error}</div>
        )}
        {loading && !engagement && (
          <div className="text-[12px] text-ink-dim px-6 py-3">Loading…</div>
        )}

        {tab === "timeline" && (
          <TimelinePane
            results={results}
            findings={findings}
            onOpenTools={() => onJumpTo("tools")}
          />
        )}
        {tab === "findings" && (
          <FindingsPane
            eid={eid}
            findings={findings}
            results={results}
            onChange={() => void refresh()}
          />
        )}
        {tab === "report" && <ReportPane eid={eid} />}
      </div>
    </div>
  );
}

// ── Timeline ────────────────────────────────────────────────────────────────

type TimelineItem =
  | { kind: "result";  ts: string; data: ScanResult }
  | { kind: "finding"; ts: string; data: Finding };

function TimelinePane({
  results, findings, onOpenTools,
}: {
  results: ScanResult[];
  findings: Finding[];
  onOpenTools: () => void;
}) {
  const [filter, setFilter] = useState<TimelineFilter>("all");

  const items = useMemo<TimelineItem[]>(() => {
    const out: TimelineItem[] = [];
    if (filter !== "findings") {
      for (const r of results) out.push({ kind: "result", ts: r.ts, data: r });
    }
    if (filter !== "results") {
      for (const f of findings) out.push({ kind: "finding", ts: f.ts, data: f });
    }
    out.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    return out;
  }, [results, findings, filter]);

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-3 text-[11px]">
        <span className="text-ink-muted tracking-wider">SHOW:</span>
        {(["all", "results", "findings"] as TimelineFilter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
                  className={
                    "px-2 py-0.5 rounded border uppercase tracking-wider " +
                    (filter === f
                      ? "border-accent text-accent"
                      : "border-divider text-ink-dim hover:text-ink-primary")
                  }>
            {f}
          </button>
        ))}
        <span className="flex-1" />
        <span className="text-ink-dim tabular-nums">{items.length} entries</span>
      </div>

      {items.length === 0 ? (
        <div className="text-ink-dim text-[13px] max-w-2xl">
          Nothing recorded yet. Run a tool from the{" "}
          <button onClick={onOpenTools} className="text-accent hover:underline">
            Tool Library
          </button>{" "}
          and results will auto-attach to this engagement.
        </div>
      ) : (
        <ol className="space-y-2">
          {items.map((it) =>
            it.kind === "result" ? (
              <ResultRow key={"r:" + it.data.id} r={it.data} />
            ) : (
              <FindingRow key={"f:" + it.data.id} f={it.data} />
            ),
          )}
        </ol>
      )}
    </div>
  );
}

function ResultRow({ r }: { r: ScanResult }) {
  return (
    <li className="rounded-md border border-divider bg-bg-card p-3">
      <div className="flex items-center gap-3 text-[11px]">
        <span className="text-[9px] uppercase tracking-wider text-ink-dim
                         border border-divider rounded px-1.5">
          ran
        </span>
        <span className="text-accent font-mono">{r.tool}</span>
        {r.target && <span className="text-ink-dim font-mono">{r.target}</span>}
        <span className="text-ink-dim ml-auto tabular-nums">
          {new Date(r.ts).toLocaleString()}
        </span>
      </div>
      {r.summary && (
        <div className="text-[12px] text-ink-muted mt-1 whitespace-pre-wrap line-clamp-4">
          {r.summary}
        </div>
      )}
    </li>
  );
}

function FindingRow({ f }: { f: Finding }) {
  return (
    <li className="rounded-md border border-divider bg-bg-card p-3">
      <div className="flex items-center gap-2 text-[11px] flex-wrap">
        <span className={"text-[9px] uppercase tracking-wider border rounded px-1.5 " + SEV_BG[f.severity]}>
          {f.severity}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-ink-dim
                         border border-divider rounded px-1.5">
          finding · {f.status.replace("_", " ")}
        </span>
        <span className="text-ink-primary font-bold truncate">{f.title}</span>
        {f.cvss != null && (
          <span className="text-[10px] text-ink-muted">CVSS {f.cvss}</span>
        )}
        <span className="text-ink-dim ml-auto tabular-nums">
          {new Date(f.ts).toLocaleString()}
        </span>
      </div>
      {f.description && (
        <div className="text-[12px] text-ink-muted mt-1 whitespace-pre-wrap line-clamp-4">
          {f.description}
        </div>
      )}
    </li>
  );
}

// ── Findings table ──────────────────────────────────────────────────────────

function FindingsPane({
  eid, findings, results, onChange,
}: {
  eid: string;
  findings: Finding[];
  results: ScanResult[];
  onChange: () => void;
}) {
  const [filterSev, setFilterSev] = useState<Set<Severity>>(new Set(SEVERITIES));
  const [filterStat, setFilterStat] = useState<Set<Status>>(new Set(["open", "triaged"]));
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Finding | null>(null);

  function toggleSev(s: Severity) {
    setFilterSev((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }
  function toggleStat(s: Status) {
    setFilterStat((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  async function quickStatus(f: Finding, status: Status) {
    await updateFinding(eid, f.id, { status });
    onChange();
  }

  async function remove(f: Finding) {
    if (!confirm(`Delete finding "${f.title}"?`)) return;
    await deleteFinding(eid, f.id);
    onChange();
  }

  const filtered = findings
    .filter((f) => filterSev.has(f.severity) && filterStat.has(f.status))
    .sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
      return order[a.severity] - order[b.severity];
    });

  return (
    <div className="p-6">
      <div className="flex items-center mb-3 gap-3">
        <span className="text-[11px] text-ink-dim">
          {filtered.length} of {findings.length}
        </span>
        <span className="flex-1" />
        <button onClick={() => setShowNew(true)}
                className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold">
          + New finding
        </button>
      </div>

      <div className="flex items-center gap-4 mb-4 text-[11px] flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-ink-muted tracking-wider">SEV:</span>
          {SEVERITIES.map((s) => (
            <button key={s} onClick={() => toggleSev(s)}
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
          {STATUSES.map((s) => (
            <button key={s} onClick={() => toggleStat(s)}
                    className={
                      "px-1.5 py-0.5 rounded border uppercase tracking-wider " +
                      (filterStat.has(s)
                        ? "border-divider text-ink-primary bg-bg-nav-active"
                        : "border-divider text-ink-dim opacity-50")
                    }>
              {s.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="text-[12px] text-ink-dim italic">
          {findings.length === 0
            ? "No findings yet. Add one manually, or promote any scan result via the AI chat."
            : "No findings match the current filters."}
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((f) => (
          <div key={f.id} className="border border-divider rounded p-3">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={"text-[10px] uppercase tracking-wider border rounded px-1.5 " + SEV_BG[f.severity]}>
                    {f.severity}
                  </span>
                  <h3 className="text-[13px] font-bold text-ink-primary truncate">
                    {f.title}
                  </h3>
                  {f.cvss != null && (
                    <span className="text-[10px] text-ink-muted">CVSS {f.cvss}</span>
                  )}
                </div>
                <div className="text-[10px] text-ink-dim mb-1">
                  {f.status} · {new Date(f.ts).toLocaleString()}
                </div>
                {f.description && (
                  <div className="text-[12px] text-ink-primary whitespace-pre-wrap mb-1">
                    {f.description}
                  </div>
                )}
                {f.evidence && (
                  <pre className="text-[11px] text-ink-muted whitespace-pre-wrap
                                  bg-bg-panel border border-divider rounded p-2 mt-1
                                  max-h-32 overflow-y-auto">
                    {f.evidence}
                  </pre>
                )}
              </div>
              <div className="flex flex-col gap-1 shrink-0 text-[11px]">
                <select value={f.status}
                        onChange={(e) => quickStatus(f, e.target.value as Status)}
                        className="bg-bg-base border border-divider rounded px-1.5 py-0.5
                                   text-[11px] focus:outline-none focus:border-accent">
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                </select>
                <button onClick={() => setEditing(f)}
                        className="px-2 py-0.5 rounded border border-divider text-ink-primary">
                  Edit
                </button>
                <button onClick={() => remove(f)}
                        className="px-2 py-0.5 rounded border border-danger text-danger">
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {(showNew || editing) && (
        <FindingEditor
          eid={eid}
          initial={editing}
          results={results}
          onClose={() => { setShowNew(false); setEditing(null); }}
          onSaved={() => { setShowNew(false); setEditing(null); onChange(); }}
        />
      )}
    </div>
  );
}

// ── Finding editor (duplicated from Findings.tsx so it can be removed) ──────

function FindingEditor({
  eid, initial, results, onClose, onSaved,
}: {
  eid: string;
  initial: Finding | null;
  results: ScanResult[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [severity, setSeverity] = useState<Severity>(initial?.severity ?? "medium");
  const [cvss, setCvss] = useState<string>(initial?.cvss != null ? String(initial.cvss) : "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [evidence, setEvidence] = useState(initial?.evidence ?? "");
  const [linkedId, setLinkedId] = useState(initial?.linked_result_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Uploads are keyed by finding id; a draft finding has no id yet so this
  // section only appears in edit mode.
  const [screenshots, setScreenshots] = useState<{ id: string; mime: string; filename: string; size_bytes: number }[]>([]);
  const [uploading, setUploading] = useState(false);

  async function refreshScreenshots() {
    if (!initial) return;
    try {
      const r = await authFetch(`/engagements/${eid}/findings/${initial.id}/screenshots`);
      if (r.ok) {
        const data = await r.json();
        setScreenshots(data.screenshots || []);
      }
    } catch { /* ignore */ }
  }

  useEffect(() => { void refreshScreenshots(); }, [initial?.id]);

  async function uploadFiles(files: FileList | null) {
    if (!initial || !files || files.length === 0) return;
    setUploading(true); setError("");
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const r = await authFetch(
          `/engagements/${eid}/findings/${initial.id}/screenshots`,
          { method: "POST", body: fd },
        );
        if (!r.ok) {
          throw new Error(await parseError(r));
        }
      }
      await refreshScreenshots();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function deleteShot(sid: string) {
    await authFetch(`/engagements/${eid}/screenshots/${sid}`, { method: "DELETE" });
    await refreshScreenshots();
  }

  function onPaste(e: React.ClipboardEvent) {
    if (!initial) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f && f.type.startsWith("image/")) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      void uploadFiles(dt.files);
    }
  }

  async function save() {
    setSaving(true); setError("");
    try {
      const cvssNum = cvss.trim() ? parseFloat(cvss) : null;
      if (initial) {
        await updateFinding(eid, initial.id, {
          title, severity, description, evidence,
          cvss: Number.isFinite(cvssNum as number) ? cvssNum : null,
        } as Partial<Finding>);
      } else {
        await createFinding(eid, {
          title, severity, description, evidence,
          cvss: Number.isFinite(cvssNum as number) ? cvssNum : null,
          linked_result_id: linkedId || null,
        });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-bg-base/70 backdrop-blur-sm flex items-start
                    justify-center pt-[8vh] px-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
         onPaste={onPaste}>
      <div className="w-full max-w-2xl bg-bg-card border border-divider rounded-lg
                      shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center px-4 py-3 border-b border-divider">
          <span className="text-accent text-[11px] font-bold tracking-widest">
            {initial ? "EDIT FINDING" : "NEW FINDING"}
          </span>
          <span className="flex-1" />
          <button onClick={onClose} className="text-ink-muted hover:text-ink-primary px-1">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="block text-[11px] text-ink-muted tracking-wider mb-1">TITLE</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus
                   placeholder="Reflected XSS on /search via q parameter"
                   className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                              text-[13px] focus:outline-none focus:border-accent" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-ink-muted tracking-wider mb-1">SEVERITY</label>
              <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}
                      className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                 text-[12px] focus:outline-none focus:border-accent">
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-ink-muted tracking-wider mb-1">
                CVSS (optional, 0–10)
              </label>
              <input type="number" min={0} max={10} step={0.1}
                     value={cvss} onChange={(e) => setCvss(e.target.value)}
                     className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                text-[12px] focus:outline-none focus:border-accent" />
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-ink-muted tracking-wider mb-1">DESCRIPTION</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                      rows={4}
                      placeholder="What is the issue? Impact? Remediation?"
                      className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                 text-[12px] focus:outline-none focus:border-accent" />
          </div>

          <div>
            <label className="block text-[11px] text-ink-muted tracking-wider mb-1">EVIDENCE</label>
            <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)}
                      rows={5}
                      placeholder="Reproduction steps, request/response snippets, output snippet…"
                      className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                 text-[12px] font-mono focus:outline-none focus:border-accent" />
          </div>

          {!initial && (
            <div>
              <label className="block text-[11px] text-ink-muted tracking-wider mb-1">
                LINK TO A SCAN RESULT (optional)
              </label>
              <select value={linkedId} onChange={(e) => setLinkedId(e.target.value)}
                      className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                 text-[12px] focus:outline-none focus:border-accent">
                <option value="">— none —</option>
                {results.map((r) => (
                  <option key={r.id} value={r.id}>
                    [{r.tool}] {r.target || r.summary.slice(0, 60)} · {new Date(r.ts).toLocaleTimeString()}
                  </option>
                ))}
              </select>
            </div>
          )}

          {initial && (
            <div>
              <label className="block text-[11px] text-ink-muted tracking-wider mb-1">
                SCREENSHOTS · paste or drop images to attach
              </label>
              <input type="file" accept="image/*" multiple
                     onChange={(e) => uploadFiles(e.target.files)}
                     disabled={uploading}
                     className="block w-full text-[11px] text-ink-muted
                                file:mr-3 file:py-1 file:px-2 file:border file:border-divider
                                file:bg-bg-base file:text-accent file:rounded
                                file:cursor-pointer" />
              {screenshots.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {screenshots.map((s) => (
                    <div key={s.id} className="relative border border-divider rounded overflow-hidden">
                      <img src={`${BACKEND_URL}/engagements/${eid}/screenshots/${s.id}`}
                           alt={s.filename}
                           className="w-full h-24 object-cover" />
                      <div className="absolute inset-x-0 bottom-0 bg-bg-base/90 px-1 py-0.5
                                      flex items-center text-[10px]">
                        <span className="truncate flex-1 text-ink-muted">{s.filename}</span>
                        <button onClick={() => deleteShot(s.id)}
                                className="text-danger hover:underline ml-1">×</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-ink-dim mt-1">
                Embedded inline in the engagement's HTML report.
              </p>
            </div>
          )}

          {error && <div className="text-[12px] text-danger">{error}</div>}
        </div>

        <div className="border-t border-divider px-4 py-3 flex gap-2 justify-end">
          <button onClick={onClose}
                  className="px-3 py-1.5 rounded border border-divider text-ink-muted text-[12px]">
            Cancel
          </button>
          <button onClick={save} disabled={saving || !title.trim()}
                  className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                             disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? "Saving…" : initial ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Report (iframe) ─────────────────────────────────────────────────────────

function ReportPane({ eid }: { eid: string }) {
  const html = reportUrl(eid, "html");
  const md = reportUrl(eid, "md");
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-3 border-b border-divider flex items-center gap-2">
        <span className="text-[11px] text-ink-muted">
          Live render from the engagement's current findings + evidence.
        </span>
        <span className="flex-1" />
        <a href={md} target="_blank" rel="noreferrer"
           className="px-3 py-1.5 rounded bg-bg-card border border-divider
                      text-ink-primary text-[12px] hover:border-accent transition">
          Download Markdown
        </a>
        <a href={html} target="_blank" rel="noreferrer"
           className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                      hover:bg-accentDim transition">
          Download HTML
        </a>
      </div>
      <div className="flex-1 bg-bg-card">
        <iframe src={html} title="Engagement report"
                className="w-full h-full border-0 bg-white" />
      </div>
    </div>
  );
}

// ── Lab-mode report ─────────────────────────────────────────────────────────

function LabReport({
  onJumpTo, hasActiveEng, mode,
}: {
  onJumpTo: (id: string) => void;
  hasActiveEng: boolean;
  mode: "lab" | "engagement";
}) {
  const events = useSessionLog();

  function generate() {
    const md = buildLabMarkdown(events);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lab-session-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">
          WORKSPACE
        </div>
        <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
          Lab Report
        </h2>
        <p className="text-[11px] text-ink-muted mt-1 max-w-2xl">
          {mode === "engagement" && !hasActiveEng
            ? "No engagement selected. Lab session activity is captured locally in this window — generate a quick markdown summary, or activate an engagement to use the full workspace."
            : "Lab mode keeps work ad-hoc — switch to Engagement mode and activate an engagement for the full evidence + findings + report workspace."}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center mb-3 gap-3">
          <h3 className="text-[12px] font-bold text-ink-primary tracking-widest">
            SESSION ACTIVITY
          </h3>
          <span className="text-[11px] text-ink-dim">
            {events.length} {events.length === 1 ? "event" : "events"}
          </span>
          <span className="flex-1" />
          <button onClick={generate} disabled={events.length === 0}
                  className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                             disabled:opacity-40 disabled:cursor-not-allowed">
            Generate report
          </button>
          <button onClick={() => onJumpTo("engagements")}
                  className="px-3 py-1.5 rounded border border-divider text-ink-primary text-[12px]">
            Choose engagement
          </button>
        </div>

        {events.length === 0 ? (
          <div className="border border-divider rounded-lg p-6 bg-bg-card text-center">
            <p className="text-[13px] text-ink-muted mb-3">
              No tools have been run in this session yet.
            </p>
            <button onClick={() => onJumpTo("tools")}
                    className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold">
              Open a tool →
            </button>
          </div>
        ) : (
          <ol className="space-y-2">
            {[...events].reverse().map((e, i) => (
              <li key={i} className="rounded-md border border-divider bg-bg-card p-3">
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-accent font-mono">{e.category}</span>
                  <span className="text-ink-dim ml-auto tabular-nums">
                    {new Date(e.ts).toLocaleString()}
                  </span>
                </div>
                <div className="text-[12px] text-ink-muted mt-1 whitespace-pre-wrap line-clamp-3 font-mono">
                  {e.summary}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function buildLabMarkdown(events: SessionEvent[]): string {
  const lines: string[] = [];
  lines.push(`# Lab Session Report`);
  lines.push(``);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Events captured: ${events.length}`);
  lines.push(``);
  lines.push(`## Methodology`);
  lines.push(``);
  if (events.length === 0) {
    lines.push(`_No tool activity recorded in this session._`);
  } else {
    for (const e of events) {
      lines.push(`### ${e.category}`);
      lines.push(`- **When:** ${e.ts}`);
      lines.push(``);
      lines.push("```");
      lines.push(e.summary);
      lines.push("```");
      lines.push(``);
    }
  }
  return lines.join("\n");
}
