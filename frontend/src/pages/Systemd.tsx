import { useEffect, useMemo, useState } from "react";
import {
  fetchSystemdUnits, fetchSystemdUnit, fetchSystemdJournal,
  type SystemdUnit, type SystemdUnitDetail,
} from "../api";

type State = "all" | "enabled" | "active" | "failed" | "running" | "static" | "disabled" | "masked";
type Type  = "service" | "timer" | "socket" | "target" | "mount" | "path";

const ACTIVE_TINT: Record<string, string> = {
  failed:     "text-danger",
  active:     "text-phos",
  activating: "text-amber",
  inactive:   "text-ink-dim",
  reloading:  "text-amber",
};

export default function Systemd() {
  const [state,  setState]  = useState<State>("all");
  const [type,   setType]   = useState<Type>("service");
  const [units,  setUnits]  = useState<SystemdUnit[]>([]);
  const [busy,   setBusy]   = useState(true);
  const [error,  setError]  = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const [selected, setSelected] = useState<string | null>(null);
  const [detail,   setDetail]   = useState<SystemdUnitDetail | null>(null);
  const [journal,  setJournal]  = useState<string[] | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  async function run() {
    setBusy(true); setError(null);
    try {
      const r = await fetchSystemdUnits(type, state);
      setUnits(r.units);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void run(); }, [state, type]);

  async function loadDetail(name: string) {
    setSelected(name); setDetailBusy(true); setDetail(null); setJournal(null);
    try {
      const [d, j] = await Promise.all([
        fetchSystemdUnit(name),
        fetchSystemdJournal(name, 200).catch(() => ({ lines: [], rc: 0, name })),
      ]);
      setDetail(d); setJournal(j.lines);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailBusy(false);
    }
  }

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return units;
    return units.filter((u) =>
      u.name.toLowerCase().includes(q) ||
      u.description.toLowerCase().includes(q),
    );
  }, [units, filter]);

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Monitoring</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              Systemd Units
            </h2>
          </div>
          <Select label="type"  value={type}  options={["service","timer","socket","target","mount","path"]}
                  onChange={(v) => setType(v as Type)} />
          <Select label="state" value={state} options={["all","active","failed","running","enabled","disabled","static","masked"]}
                  onChange={(v) => setState(v as State)} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)}
                 placeholder="filter…"
                 className="flex-1 bg-bg-card border border-divider rounded
                            px-3 py-1 text-xs font-mono text-ink-primary
                            placeholder:text-ink-dim focus:outline-none focus:border-accent" />
          <span className="text-[10px] text-ink-dim">{units.length} units</span>
          <button onClick={run} disabled={busy}
                  className="bg-accent text-white text-xs font-bold px-3 py-1 rounded border border-accent/60 disabled:opacity-50">
            {busy ? "Loading…" : "↻ Reload"}
          </button>
        </div>
      </header>

      {error && (
        <div className="m-4 border border-danger/40 bg-danger/10 text-danger
                        rounded px-3 py-2 text-sm font-mono">Error — {error}</div>
      )}

      <div className="flex-1 grid grid-cols-[2fr_3fr] gap-0 overflow-hidden">
        {/* unit list */}
        <div className="overflow-auto border-r border-divider">
          <div className="grid grid-cols-[1fr_80px_60px] gap-2 px-3 py-1.5
                          bg-bg-panel border-b border-divider text-[10px]
                          uppercase tracking-[0.2em] text-ink-dim sticky top-0">
            <span>Unit · Description</span><span>Active</span><span>Sub</span>
          </div>
          {visible.map((u) => (
            <button key={u.name} onClick={() => loadDetail(u.name)}
                    className={"w-full text-left grid grid-cols-[1fr_80px_60px] gap-2 " +
                               "px-3 py-1.5 text-[11px] font-mono border-b border-divider/40 " +
                               "hover:bg-bg-card " +
                               (selected === u.name ? "bg-bg-card" : "")}>
              <div className="truncate">
                <div className="text-ink-primary truncate">{u.name}</div>
                <div className="text-[10px] text-ink-dim truncate">{u.description}</div>
              </div>
              <span className={ACTIVE_TINT[u.active] || "text-ink-muted"}>{u.active}</span>
              <span className="text-ink-muted">{u.sub}</span>
            </button>
          ))}
        </div>

        {/* detail pane */}
        <div className="overflow-auto p-4 space-y-3">
          {!selected && (
            <div className="text-ink-dim text-xs">Select a unit to view status + journal.</div>
          )}
          {selected && detailBusy && (
            <div className="text-ink-dim text-xs">Loading {selected}…</div>
          )}
          {detail && (
            <>
              <div className="rounded border border-divider bg-bg-card p-3">
                <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">unit</div>
                <div className="text-sm font-mono font-bold text-ink-primary">{detail.name}</div>
                <div className="text-[11px] text-ink-muted mt-0.5">{detail.description}</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-2 text-[11px] font-mono">
                  <Field k="Active"      v={detail.active_state} />
                  <Field k="Sub"         v={detail.sub_state} />
                  <Field k="Load"        v={detail.load_state} />
                  <Field k="File state"  v={detail.file_state} />
                  <Field k="MainPID"     v={detail.main_pid} />
                  <Field k="Restart"     v={`${detail.restart} (${detail.restart_sec})`} />
                  <Field k="User"        v={detail.user || "(default)"} />
                  <Field k="Group"       v={detail.group || "(default)"} />
                  <Field k="ExecStart"   v={detail.exec_start || "(none)"} />
                  <Field k="Fragment"    v={detail.fragment_path} />
                </div>
              </div>

              <div className="rounded border border-divider bg-bg-card p-3">
                <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">journal · last {journal?.length ?? 0}</div>
                <pre className="mt-1 text-[11px] text-ink-muted whitespace-pre-wrap max-h-[420px] overflow-auto">
                  {(journal ?? []).join("\n") || "(no entries)"}
                </pre>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Select({ label, value, options, onChange }:
  { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1 text-[10px] text-ink-dim uppercase tracking-widest">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
              className="ml-1 bg-bg-card border border-divider rounded px-2 py-0.5
                         text-xs font-mono text-ink-primary focus:outline-none focus:border-accent">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-divider/40 py-0.5">
      <span className="text-ink-muted">{k}</span>
      <span className="text-ink-primary text-right truncate ml-2" title={v}>{v || "—"}</span>
    </div>
  );
}
