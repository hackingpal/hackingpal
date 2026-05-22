import { useEffect, useState } from "react";
import {
  createEngagement,
  deleteEngagement,
  listEngagements,
  reportUrl,
  setActiveEngagementId,
  updateEngagement,
  useActiveEngagementId,
  type Engagement,
} from "../lib/engagement";
import { BACKEND_URL, parseError } from "../api";

export default function Engagements() {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Engagement | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState<Engagement | null>(null);
  const activeId = useActiveEngagementId();

  async function refresh() {
    setLoading(true); setError("");
    try {
      setEngagements(await listEngagements(showArchived));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [showArchived]);

  async function archive(e: Engagement) {
    if (!confirm(`Archive "${e.name}"? It will stop appearing in the active list (you can still open its report).`)) return;
    await updateEngagement(e.id, { status: "archived" });
    if (e.id === activeId) setActiveEngagementId(null);
    void refresh();
  }

  async function complete(e: Engagement) {
    await updateEngagement(e.id, { status: "completed" });
    void refresh();
  }

  async function reactivate(e: Engagement) {
    await updateEngagement(e.id, { status: "active" });
    void refresh();
  }

  async function remove(e: Engagement) {
    if (!confirm(`Permanently delete "${e.name}" and ALL its results & findings? This cannot be undone.`)) return;
    await deleteEngagement(e.id);
    if (e.id === activeId) setActiveEngagementId(null);
    void refresh();
  }

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="flex items-center mb-3 gap-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">ENGAGEMENTS</h2>
        <span className="text-[11px] text-ink-dim">
          {engagements.length} {showArchived ? "total" : "active"}
        </span>
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-[11px] cursor-pointer text-ink-muted">
          <input type="checkbox" checked={showArchived}
                 onChange={(e) => setShowArchived(e.target.checked)} />
          show archived
        </label>
        <button onClick={() => setCreating(true)}
                className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold">
          + New engagement
        </button>
      </header>

      <p className="text-[11px] text-ink-dim mb-4 leading-relaxed">
        An <b>engagement</b> is a named container for a piece of work — scope,
        results, findings, and the final report. Activate one (via the pill in
        the top bar) and every scan result auto-saves to it.
      </p>

      {error && <div className="text-[12px] text-danger mb-3">⚠ {error}</div>}
      {loading && <div className="text-[12px] text-ink-dim">Loading…</div>}

      {!loading && engagements.length === 0 && (
        <div className="text-[12px] text-ink-dim italic">
          No engagements yet. Click <b>+ New engagement</b> to start one.
        </div>
      )}

      <div className="space-y-2">
        {engagements.map((e) => (
          <div key={e.id}
               className={"border rounded p-3 transition " +
                 (e.id === activeId
                   ? "border-accent/60 bg-accent/[0.04]"
                   : "border-divider hover:bg-bg-nav-hover")}>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-[14px] font-bold text-ink-primary truncate">
                    {e.name}
                  </h3>
                  {e.id === activeId && (
                    <span className="text-[10px] uppercase tracking-wider text-accent
                                     border border-accent/40 rounded px-1.5">
                      active
                    </span>
                  )}
                  <span className="text-[9px] uppercase tracking-wider text-ink-dim
                                   border border-divider rounded px-1.5">
                    {e.status}
                  </span>
                </div>
                <div className="text-[11px] text-ink-dim mb-1">
                  {e.scope.length} scope · {e.exclusions.length} excl · updated{" "}
                  {new Date(e.updated_at).toLocaleString()}
                </div>
                {e.scope.length > 0 && (
                  <div className="text-[11px] text-ink-muted font-mono truncate">
                    {e.scope.slice(0, 4).join(", ")}{e.scope.length > 4 ? " …" : ""}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1 shrink-0 text-[11px]">
                {e.id !== activeId && (
                  <button onClick={() => setActiveEngagementId(e.id)}
                          className="px-2 py-0.5 rounded bg-accent text-white">
                    Activate
                  </button>
                )}
                <button onClick={() => setEditing(e)}
                        className="px-2 py-0.5 rounded border border-divider text-ink-primary">
                  Edit
                </button>
                <a href={reportUrl(e.id, "html")} target="_blank" rel="noreferrer"
                   className="px-2 py-0.5 rounded border border-divider text-ink-primary text-center">
                  Report (HTML)
                </a>
                <a href={reportUrl(e.id, "md")}
                   className="px-2 py-0.5 rounded border border-divider text-ink-muted text-center">
                  Report (MD)
                </a>
                <button onClick={() => setExporting(e)}
                        className="px-2 py-0.5 rounded border border-divider text-ink-primary">
                  Export → GitHub
                </button>
                {e.status === "active" && (
                  <button onClick={() => complete(e)}
                          className="px-2 py-0.5 rounded border border-divider text-ink-muted">
                    Mark complete
                  </button>
                )}
                {e.status === "archived" ? (
                  <button onClick={() => reactivate(e)}
                          className="px-2 py-0.5 rounded border border-divider text-ink-muted">
                    Unarchive
                  </button>
                ) : (
                  <button onClick={() => archive(e)}
                          className="px-2 py-0.5 rounded border border-divider text-ink-muted">
                    Archive
                  </button>
                )}
                <button onClick={() => remove(e)}
                        className="px-2 py-0.5 rounded border border-danger text-danger">
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {(creating || editing) && (
        <EngagementEditor
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); void refresh(); }}
        />
      )}

      {exporting && (
        <GithubExportModal
          engagement={exporting}
          onClose={() => setExporting(null)}
        />
      )}
    </div>
  );
}

// ── GitHub Issues export modal ──────────────────────────────────────────────

function GithubExportModal({
  engagement, onClose,
}: {
  engagement: Engagement;
  onClose: () => void;
}) {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [labelPrefix, setLabelPrefix] = useState("mhp");
  const [picked, setPicked] = useState<Set<string>>(new Set(["critical", "high", "medium"]));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    created: { finding_id: string; issue_number: number; url: string }[];
    failed: { finding_id: string; detail?: string; status?: number }[];
    total_findings: number;
  } | null>(null);

  function toggle(s: string) {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  async function go() {
    setRunning(true); setError(""); setResult(null);
    try {
      const r = await fetch(`${BACKEND_URL}/engagements/${engagement.id}/export/github`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: owner.trim(),
          repo: repo.trim(),
          label_prefix: labelPrefix.trim() || "mhp",
          severity_filter: [...picked],
        }),
      });
      if (!r.ok) throw new Error(await parseError(r));
      setResult(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setRunning(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-bg-base/70 backdrop-blur-sm flex items-start
                    justify-center pt-[10vh] px-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-xl bg-bg-card border border-divider rounded-lg
                      shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center px-4 py-3 border-b border-divider">
          <span className="text-accent text-[11px] font-bold tracking-widest">
            EXPORT TO GITHUB ISSUES
          </span>
          <span className="flex-1" />
          <button onClick={onClose} className="text-ink-muted hover:text-ink-primary px-1">✕</button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <p className="text-[12px] text-ink-muted">
            Exporting findings from <b>{engagement.name}</b> as GitHub issues.
            Uses the <code>github_token</code> stored in your Keychain (needs <code>repo</code> scope).
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-ink-muted tracking-wider mb-1">OWNER</label>
              <input value={owner} onChange={(e) => setOwner(e.target.value)}
                     disabled={running}
                     placeholder="myorg"
                     className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                text-[12px] font-mono focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="block text-[11px] text-ink-muted tracking-wider mb-1">REPO</label>
              <input value={repo} onChange={(e) => setRepo(e.target.value)}
                     disabled={running}
                     placeholder="my-app"
                     className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                text-[12px] font-mono focus:outline-none focus:border-accent" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-ink-muted tracking-wider mb-1">LABEL PREFIX</label>
            <input value={labelPrefix} onChange={(e) => setLabelPrefix(e.target.value)}
                   disabled={running}
                   placeholder="mhp"
                   className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                              text-[12px] font-mono focus:outline-none focus:border-accent" />
            <p className="text-[10px] text-ink-dim mt-1">
              Each issue gets label <code>{labelPrefix}/{"<severity>"}</code> (e.g. <code>{labelPrefix}/high</code>).
            </p>
          </div>
          <div>
            <div className="text-[11px] text-ink-muted tracking-wider mb-1">EXPORT WHICH SEVERITIES</div>
            <div className="flex gap-3 text-[12px]">
              {["critical", "high", "medium", "low", "info"].map((s) => (
                <label key={s} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={picked.has(s)} disabled={running}
                         onChange={() => toggle(s)} />
                  <span className="text-ink-primary">{s}</span>
                </label>
              ))}
            </div>
          </div>

          {error && <div className="text-[12px] text-danger">⚠ {error}</div>}

          {result && (
            <div className="bg-bg-panel border border-divider rounded p-2 text-[12px]">
              <div className="text-phos font-bold">
                ✓ Created {result.created.length} issue{result.created.length === 1 ? "" : "s"}{" "}
                <span className="text-ink-muted">of {result.total_findings} filtered findings</span>
              </div>
              {result.created.slice(0, 5).map((c) => (
                <div key={c.finding_id} className="text-[11px]">
                  <a href={c.url} target="_blank" rel="noreferrer"
                     className="text-accent hover:underline">#{c.issue_number}</a>
                  <span className="text-ink-dim ml-2">→ {c.url}</span>
                </div>
              ))}
              {result.created.length > 5 && (
                <div className="text-[10px] text-ink-dim">…and {result.created.length - 5} more</div>
              )}
              {result.failed.length > 0 && (
                <details className="mt-1">
                  <summary className="text-danger text-[11px] cursor-pointer">
                    {result.failed.length} failed
                  </summary>
                  {result.failed.map((f, i) => (
                    <div key={i} className="text-[11px] text-ink-muted font-mono">
                      {f.finding_id}: {f.detail ?? `HTTP ${f.status}`}
                    </div>
                  ))}
                </details>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-divider px-4 py-3 flex gap-2 justify-end">
          <button onClick={onClose}
                  className="px-3 py-1.5 rounded border border-divider text-ink-muted text-[12px]">
            Close
          </button>
          <button onClick={go} disabled={running || !owner.trim() || !repo.trim() || picked.size === 0}
                  className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                             disabled:opacity-40 disabled:cursor-not-allowed">
            {running ? "Exporting…" : "Create Issues"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Editor modal ────────────────────────────────────────────────────────────

function EngagementEditor({
  initial, onClose, onSaved,
}: {
  initial: Engagement | null;
  onClose: () => void;
  onSaved: (e: Engagement) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [scope, setScope] = useState((initial?.scope ?? []).join("\n"));
  const [exclusions, setExclusions] = useState((initial?.exclusions ?? []).join("\n"));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true); setError("");
    try {
      const scopeArr = scope.split("\n").map((s) => s.trim()).filter(Boolean);
      const exclArr = exclusions.split("\n").map((s) => s.trim()).filter(Boolean);
      let e: Engagement;
      if (initial) {
        e = await updateEngagement(initial.id, {
          name, scope: scopeArr, exclusions: exclArr, notes,
        });
      } else {
        e = await createEngagement({ name, scope: scopeArr, exclusions: exclArr, notes });
      }
      onSaved(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-bg-base/70 backdrop-blur-sm flex items-start
                    justify-center pt-[10vh] px-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl bg-bg-card border border-divider rounded-lg
                      shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center px-4 py-3 border-b border-divider">
          <span className="text-accent text-[11px] font-bold tracking-widest">
            {initial ? "EDIT ENGAGEMENT" : "NEW ENGAGEMENT"}
          </span>
          <span className="flex-1" />
          <button onClick={onClose} className="text-ink-muted hover:text-ink-primary px-1">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="block text-[11px] text-ink-muted tracking-wider mb-1">NAME</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
                   placeholder="ACME Q1 2026 — external pentest"
                   className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                              text-[13px] focus:outline-none focus:border-accent" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-ink-muted tracking-wider mb-1">
                IN-SCOPE (one per line)
              </label>
              <textarea value={scope} onChange={(e) => setScope(e.target.value)}
                        rows={6}
                        placeholder={"example.com\n*.example.com\n203.0.113.0/24"}
                        className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                   text-[12px] font-mono focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="block text-[11px] text-ink-muted tracking-wider mb-1">
                OUT-OF-SCOPE (one per line)
              </label>
              <textarea value={exclusions} onChange={(e) => setExclusions(e.target.value)}
                        rows={6}
                        placeholder={"admin.example.com\n198.51.100.4"}
                        className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                   text-[12px] font-mono focus:outline-none focus:border-accent" />
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-ink-muted tracking-wider mb-1">NOTES</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                      rows={4} placeholder="Client contact, kickoff date, rules of engagement…"
                      className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                 text-[12px] focus:outline-none focus:border-accent" />
          </div>

          {error && <div className="text-[12px] text-danger">⚠ {error}</div>}
        </div>

        <div className="border-t border-divider px-4 py-3 flex gap-2 justify-end">
          <button onClick={onClose}
                  className="px-3 py-1.5 rounded border border-divider text-ink-muted text-[12px]">
            Cancel
          </button>
          <button onClick={save} disabled={saving || !name.trim()}
                  className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                             disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? "Saving…" : initial ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
