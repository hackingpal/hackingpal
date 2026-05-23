import { useEffect, useMemo, useState } from "react";
import {
  fetchPersistenceAudit, type ForensicSeverity, type PersistenceEntry, type SignStatus,
} from "../api";

const SEV: Record<ForensicSeverity, { dot: string; text: string; bg: string }> = {
  info: { dot: "bg-ink-dim", text: "text-ink-muted", bg: "bg-bg-card" },
  warn: { dot: "bg-amber",   text: "text-amber",     bg: "bg-amber/5" },
  high: { dot: "bg-danger",  text: "text-danger",    bg: "bg-danger/5" },
};

const SIGN_TINT: Record<SignStatus, string> = {
  "apple":         "text-phos",
  "developer-id":  "text-ink-muted",
  "ad-hoc":        "text-amber",
  "unsigned":      "text-amber",
  "invalid":       "text-danger",
  "missing":       "text-danger",
  "":              "text-ink-dim",
};

type Filter = "all" | ForensicSeverity;

export default function Persistence() {
  const [entries, setEntries] = useState<PersistenceEntry[]>([]);
  const [busy,    setBusy]    = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [filter,  setFilter]  = useState<Filter>("all");

  async function run() {
    setBusy(true); setError(null);
    try {
      const r = await fetchPersistenceAudit();
      setEntries(r.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void run(); }, []);

  const counts = useMemo(() => {
    const c = { high: 0, warn: 0, info: 0 };
    for (const e of entries) c[e.severity]++;
    return c;
  }, [entries]);

  const visible = useMemo(
    () => filter === "all" ? entries : entries.filter((e) => e.severity === filter),
    [entries, filter],
  );

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Forensics</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              Persistence Audit
            </h2>
          </div>

          <div className="flex items-end gap-5">
            <Counter label="HIGH"  count={counts.high} tone="text-danger" />
            <Counter label="WARN"  count={counts.warn} tone="text-amber" />
            <Counter label="INFO"  count={counts.info} tone="text-ink-muted" />
          </div>

          <div className="flex-1 text-xs text-ink-muted">
            Scans system auto-start locations (LaunchAgents/Daemons on macOS;
            systemd, cron, autostart, rc.local on Linux). Targets are verified
            for integrity and flagged if missing, world-writable, or in a temp dir.
          </div>

          <div className="flex gap-1">
            {(["all","high","warn","info"] as const).map((f) => (
              <FilterChip key={f} active={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f.toUpperCase()}
              </FilterChip>
            ))}
          </div>

          <button onClick={run} disabled={busy}
                  className="bg-accent hover:bg-accentDim active:translate-y-px
                             text-white text-xs font-bold tracking-wide
                             px-3.5 py-1.5 rounded transition border border-accent/60
                             disabled:opacity-50">
            {busy ? "Scanning…" : "↻ Rescan"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono mb-4">Error — {error}</div>
        )}
        {busy && entries.length === 0 && (
          <div className="text-ink-dim text-xs">Scanning persistence locations…</div>
        )}
        {visible.length > 0 && (
          <section className="border border-divider rounded-md overflow-hidden">
            <div className="grid grid-cols-[120px_1fr_120px_140px] gap-3 px-3 py-1.5
                            bg-bg-panel border-b border-divider text-[10px]
                            uppercase tracking-[0.2em] text-ink-dim">
              <span>Source</span>
              <span>Label · Program</span>
              <span>Signature</span>
              <span>Behavior</span>
            </div>
            <div className="font-mono text-[11px]">
              {visible.map((e, i) => (
                <div key={e.plist}
                     className={"grid grid-cols-[120px_1fr_120px_140px] gap-3 px-3 py-2 " +
                                "border-l-2 " + SEV[e.severity].bg + " " +
                                (e.severity === "high" ? "border-l-danger" :
                                 e.severity === "warn" ? "border-l-amber" :
                                                          "border-l-transparent ") +
                                (i % 2 === 0 ? "" : " bg-opacity-50")}>
                  <span className="text-ink-muted">{e.source}</span>
                  <div>
                    <div className="text-ink-primary truncate">{e.label}</div>
                    <div className={"text-[10px] mt-0.5 truncate " +
                                    (e.suspicious_path ? "text-danger" : "text-ink-dim")}>
                      {e.program || "(no program specified)"}
                      {e.suspicious_path && " · ⚠ in temp dir"}
                    </div>
                  </div>
                  <span className={"flex items-center gap-1.5 " + SIGN_TINT[e.sign_status]}>
                    <span className={"inline-block w-1.5 h-1.5 rounded-full " + SEV[e.severity].dot} />
                    {e.sign_status || "—"}
                  </span>
                  <div className="text-ink-dim text-[10px] space-y-0.5">
                    {e.run_at_load    && <div>· run at load</div>}
                    {e.keep_alive     && <div>· keep alive</div>}
                    {e.start_interval && <div>· every {e.start_interval}s</div>}
                    {!e.run_at_load && !e.keep_alive && !e.start_interval && <div>—</div>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        {!busy && entries.length === 0 && !error && (
          <div className="text-ink-dim text-xs">No persistence entries found.</div>
        )}
      </div>
    </div>
  );
}

function Counter({ label, count, tone }:
  { label: string; count: number; tone: string }) {
  return (
    <div>
      <div className="text-[10px] tracking-widest text-ink-dim">{label}</div>
      <div className={"text-base font-bold tabular-nums " + tone}>{count}</div>
    </div>
  );
}

function FilterChip({ active, onClick, children }:
  { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
            className={"text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-md border " +
              (active
                ? "bg-accent text-white border-accent"
                : "bg-transparent text-ink-muted border-divider hover:text-ink-primary")}>
      {children}
    </button>
  );
}
