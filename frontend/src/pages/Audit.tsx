/**
 * Audit Log page.
 *
 * Read-only timeline view of every tool invocation (one row per action,
 * INSERTed at start and UPDATEd at end). Filters: engagement / tool /
 * status. Click a row for the full argv + summary + error.
 *
 * The audit log is the trust anchor for engagement reports — that's why
 * nothing on this page can edit or delete a row.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

type Action = {
  id: string;
  engagement_id: string | null;
  ts_start: string;
  ts_end: string | null;
  tool: string;
  target: string;
  argv: string[];
  approver: string;
  mode: "lab" | "engagement";
  status: "started" | "completed" | "error" | "stopped";
  summary: string;
  error: string | null;
};

type ListResp = { count: number; actions: Action[] };
type StatsResp = {
  tools: { tool: string; total: number;
           completed: number; error: number; stopped: number; started: number }[];
};

const STATUS_COLOR: Record<Action["status"], string> = {
  started:   "text-amber  border-amber/40",
  completed: "text-phos   border-phos/40",
  error:     "text-danger border-danger/50",
  stopped:   "text-ink-dim border-divider",
};

export default function Audit() {
  const [actions, setActions] = useState<Action[]>([]);
  const [stats, setStats] = useState<StatsResp | null>(null);
  const [toolFilter, setToolFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<Action["status"] | "">("");
  const [engagementFilter, setEngagementFilter] = useState("");
  const [selected, setSelected] = useState<Action | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (toolFilter)       params.set("tool", toolFilter);
      if (statusFilter)     params.set("status", statusFilter);
      if (engagementFilter) params.set("engagement_id", engagementFilter);
      const qs = params.toString();
      const r = await api<ListResp>(`/audit-log${qs ? "?" + qs : ""}`);
      setActions(r.actions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [toolFilter, statusFilter, engagementFilter]);
  useEffect(() => {
    api<StatsResp>("/audit-log/stats").then(setStats).catch(() => {});
  }, [actions.length]);

  // Distinct tool list for the filter chip row, derived from what's loaded.
  const toolChoices = useMemo(() => {
    const seen = new Set<string>();
    actions.forEach((a) => seen.add(a.tool));
    return Array.from(seen).sort();
  }, [actions]);

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 pt-4 pb-2 border-b border-divider">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">AUDIT LOG</h2>
        <p className="text-[11px] text-ink-dim">
          Append-only record of every tool invocation. Feeds the engagement
          report. Read-only — nothing on this page edits or deletes.
        </p>
      </header>

      <div className="px-4 py-2 bg-bg-card border-b border-divider flex flex-wrap gap-2 items-center text-[11px]">
        <span className="text-ink-muted tracking-wider">FILTER</span>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}
                className="bg-bg-base border border-divider rounded px-2 py-1">
          <option value="">all statuses</option>
          {(["started", "completed", "error", "stopped"] as const).map((s) =>
            <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={toolFilter} onChange={(e) => setToolFilter(e.target.value)}
                className="bg-bg-base border border-divider rounded px-2 py-1 max-w-[200px]">
          <option value="">all tools</option>
          {toolChoices.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input value={engagementFilter} onChange={(e) => setEngagementFilter(e.target.value)}
               placeholder="engagement id"
               className="bg-bg-base border border-divider rounded px-2 py-1 w-[180px] font-mono" />
        {(toolFilter || statusFilter || engagementFilter) && (
          <button onClick={() => { setToolFilter(""); setStatusFilter(""); setEngagementFilter(""); }}
                  className="text-ink-dim hover:text-ink-primary">clear</button>
        )}
        <button onClick={load} disabled={loading}
                className="ml-auto px-2 py-1 rounded border border-divider text-ink-primary
                           hover:border-accent disabled:opacity-40">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {stats && stats.tools.length > 0 && (
        <div className="px-4 py-2 border-b border-divider bg-bg-panel
                        flex flex-wrap gap-1.5 text-[10px]">
          {stats.tools.slice(0, 12).map((t) => (
            <button key={t.tool}
                    onClick={() => setToolFilter(toolFilter === t.tool ? "" : t.tool)}
                    className={"px-2 py-0.5 rounded border " +
                      (toolFilter === t.tool
                        ? "border-accent text-accent"
                        : "border-divider text-ink-muted hover:text-ink-primary")}>
              {t.tool}
              <span className="text-phos ml-1">{t.completed}</span>
              {t.error > 0   && <span className="text-danger ml-1">{t.error}</span>}
              {t.stopped > 0 && <span className="text-ink-dim ml-1">{t.stopped}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="w-1/2 border-r border-divider overflow-y-auto">
          {error && <div className="m-3 text-[11px] text-danger">⚠ {error}</div>}
          {actions.length === 0 && !loading && (
            <div className="m-3 text-[11px] text-ink-dim italic">
              No audit rows yet. Tools record an entry per invocation once they're wired
              into <code className="text-amber">lib/audit_log.py</code>.
            </div>
          )}
          {actions.map((a) => (
            <button key={a.id} onClick={() => setSelected(a)}
                    className={"w-full text-left px-3 py-2 border-b border-divider " +
                      "hover:bg-bg-nav-hover " +
                      (selected?.id === a.id ? "bg-bg-nav-hover" : "")}>
              <div className="flex items-center gap-2">
                <span className={"text-[9px] uppercase tracking-wider px-1.5 rounded border " +
                  STATUS_COLOR[a.status]}>{a.status}</span>
                <span className="text-[11px] font-mono text-ink-primary">{a.tool}</span>
                <span className="ml-auto text-[10px] text-ink-dim">
                  {a.ts_start.slice(11, 19)}
                </span>
              </div>
              <div className="text-[10px] text-ink-muted mt-1 font-mono truncate">
                {a.target || "—"}
              </div>
              {a.summary && (
                <div className="text-[10px] text-ink-dim mt-0.5">{a.summary}</div>
              )}
              <div className="text-[9px] text-ink-dim mt-1 flex gap-2">
                <span className={a.mode === "engagement" ? "text-accent" : ""}>
                  {a.mode}
                </span>
                {a.engagement_id && (
                  <span className="font-mono">eng:{a.engagement_id.slice(0, 8)}</span>
                )}
                <span>by {a.approver}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="w-1/2 overflow-y-auto">
          {!selected ? (
            <div className="m-4 text-[11px] text-ink-dim italic">
              Select an action to see argv + result.
            </div>
          ) : (
            <div className="p-4 space-y-3">
              <div>
                <div className="text-[14px] font-bold text-ink-primary">{selected.tool}</div>
                <div className="text-[10px] text-ink-dim font-mono">{selected.id}</div>
              </div>
              <Field label="STATUS">
                <span className={"px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider " +
                  STATUS_COLOR[selected.status]}>{selected.status}</span>
              </Field>
              <Field label="TARGET">
                <code className="text-[11px] text-ink-primary font-mono">{selected.target || "—"}</code>
              </Field>
              <Field label="ARGV">
                {selected.argv.length === 0 ? (
                  <span className="text-[11px] text-ink-dim italic">none recorded</span>
                ) : (
                  <pre className="bg-bg-base border border-divider rounded p-2 text-[10px]
                                  font-mono text-amber overflow-x-auto">
                    {selected.argv.join(" ")}
                  </pre>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="MODE">
                  <span className={selected.mode === "engagement" ? "text-accent" : "text-ink-muted"}>
                    {selected.mode}
                  </span>
                </Field>
                <Field label="APPROVER">
                  <span className="text-ink-muted">{selected.approver}</span>
                </Field>
                <Field label="STARTED">
                  <span className="text-[10px] font-mono text-ink-muted">{selected.ts_start}</span>
                </Field>
                <Field label="ENDED">
                  <span className="text-[10px] font-mono text-ink-muted">{selected.ts_end || "—"}</span>
                </Field>
              </div>
              {selected.engagement_id && (
                <Field label="ENGAGEMENT">
                  <code className="text-[11px] font-mono text-ink-primary">{selected.engagement_id}</code>
                </Field>
              )}
              {selected.summary && (
                <Field label="SUMMARY">
                  <span className="text-[11px] text-ink-primary">{selected.summary}</span>
                </Field>
              )}
              {selected.error && (
                <Field label="ERROR">
                  <pre className="bg-danger/10 border border-danger/30 rounded p-2 text-[11px]
                                  font-mono text-danger whitespace-pre-wrap">
                    {selected.error}
                  </pre>
                </Field>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-ink-dim tracking-wider mb-1">{label}</div>
      <div>{children}</div>
    </div>
  );
}
