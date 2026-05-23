import { useEffect, useState } from "react";
import { fetchFirewallRules, type FirewallRules } from "../api";

export default function FirewallRulesPage() {
  const [report, setReport] = useState<FirewallRules | null>(null);
  const [busy,   setBusy]   = useState(true);
  const [error,  setError]  = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try { setReport(await fetchFirewallRules()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void run(); }, []);

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Monitoring</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              Firewall Rules
            </h2>
          </div>
          {report && (
            <div className="flex gap-5 items-end">
              <Stat label="Backend" value={report.backend} good={report.backend !== "none" ? null : false} />
              <Stat label="Tables"  value={String(report.summary.tables)} good={null} />
              <Stat label="Chains"  value={String(report.summary.chains)} good={null} />
              <Stat label="Rules"   value={String(report.summary.rules)}  good={null} />
            </div>
          )}
          <div className="flex-1" />
          <button onClick={run} disabled={busy}
                  className="bg-accent text-white text-xs font-bold px-3 py-1 rounded border border-accent/60 disabled:opacity-50">
            {busy ? "Reading…" : "↻ Reload"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 space-y-3">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">Error — {error}</div>
        )}
        {report?.needs_root && (
          <div className="border border-amber/40 bg-amber/10 text-amber
                          rounded px-3 py-2 text-sm font-mono">
            Insufficient permissions to read firewall rules. Run the backend
            via a privileged helper (or `sudo`) to see actual rules. Raw error:
            <pre className="mt-1 text-[11px] text-ink-muted whitespace-pre-wrap">{report.error}</pre>
          </div>
        )}
        {report && !report.needs_root && report.tables.length === 0 && (
          <div className="text-ink-dim text-xs">
            No rules loaded {report.backend !== "none" ? `(backend: ${report.backend})` : ""}.
          </div>
        )}

        {report?.tables.map((t, ti) => (
          <section key={ti} className="rounded border border-divider overflow-hidden">
            <header className="px-3 py-1.5 bg-bg-panel border-b border-divider
                               flex justify-between text-[11px] font-mono">
              <span className="text-ink-primary">
                table <span className="text-ink-muted">{t.family}</span> {t.name}
              </span>
              <span className="text-ink-dim">{t.chains.length} chain(s)</span>
            </header>
            {t.chains.map((c, ci) => (
              <div key={ci} className="border-t border-divider/40 first:border-0">
                <div className="px-3 py-1 bg-bg-card flex justify-between
                                text-[11px] font-mono text-ink-muted">
                  <span>
                    chain <span className="text-ink-primary">{c.name}</span>
                    {c.hook && <> · hook {c.hook}</>}
                    {c.policy && <> · policy <span className={c.policy.toLowerCase() === "drop" ? "text-phos" : "text-amber"}>{c.policy}</span></>}
                  </span>
                  <span className="text-ink-dim">{c.rules.length} rule(s)</span>
                </div>
                <pre className="px-3 py-1.5 text-[11px] font-mono text-ink-muted whitespace-pre-wrap">
                  {c.rules.length === 0 ? "(no rules)" : c.rules.join("\n")}
                </pre>
              </div>
            ))}
          </section>
        ))}

        {report?.raw && (
          <details className="rounded border border-divider bg-bg-card">
            <summary className="cursor-pointer text-ink-dim text-xs px-3 py-1.5">Raw output</summary>
            <pre className="px-3 py-2 text-[10px] text-ink-muted whitespace-pre-wrap max-h-[500px] overflow-auto">{report.raw}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, good }:
  { label: string; value: string; good: boolean | null }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-ink-dim">{label}</div>
      <div className={"text-base font-mono font-bold " +
        (good === null ? "text-ink-primary" : good ? "text-phos" : "text-danger")}>{value}</div>
    </div>
  );
}
