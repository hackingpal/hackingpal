import { useEffect, useState } from "react";
import {
  createFinding,
  deleteFinding,
  listFindings,
  listResults,
  updateFinding,
  useActiveEngagementId,
  type Finding,
  type ScanResult,
} from "../lib/engagement";
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

export default function Findings() {
  const activeId = useActiveEngagementId();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [filterSev, setFilterSev] = useState<Set<Severity>>(new Set(SEVERITIES));
  const [filterStat, setFilterStat] = useState<Set<Status>>(new Set(["open", "triaged"]));
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Finding | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    if (!activeId) return;
    setLoading(true); setError("");
    try {
      const [f, r] = await Promise.all([listFindings(activeId), listResults(activeId, 200)]);
      setFindings(f);
      setResults(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [activeId]);

  if (!activeId) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-ink-dim p-6 text-center">
        <p className="text-[13px] mb-2">No active engagement.</p>
        <p className="text-[11px]">Pick one from the engagement pill in the top bar to see its findings.</p>
      </div>
    );
  }

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
    await updateFinding(activeId!, f.id, { status });
    void refresh();
  }

  async function remove(f: Finding) {
    if (!confirm(`Delete finding "${f.title}"?`)) return;
    await deleteFinding(activeId!, f.id);
    void refresh();
  }

  const filtered = findings
    .filter((f) => filterSev.has(f.severity) && filterStat.has(f.status))
    .sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
      return order[a.severity] - order[b.severity];
    });

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="flex items-center mb-3 gap-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">FINDINGS</h2>
        <span className="text-[11px] text-ink-dim">
          {filtered.length} of {findings.length}
        </span>
        <span className="flex-1" />
        <button onClick={() => setShowNew(true)}
                className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold">
          + New finding
        </button>
      </header>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-4 text-[11px]">
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

      {error && <div className="text-[12px] text-danger mb-2">⚠ {error}</div>}
      {loading && <div className="text-[12px] text-ink-dim">Loading…</div>}

      {!loading && filtered.length === 0 && (
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
          eid={activeId}
          initial={editing}
          results={results}
          onClose={() => { setShowNew(false); setEditing(null); }}
          onSaved={() => { setShowNew(false); setEditing(null); void refresh(); }}
        />
      )}
    </div>
  );
}

// ── Editor modal ────────────────────────────────────────────────────────────

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

  // Screenshot attachments (only meaningful for existing findings — uploads are
  // keyed by finding id, and a new finding doesn't have one yet)
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

          {error && <div className="text-[12px] text-danger">⚠ {error}</div>}
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
