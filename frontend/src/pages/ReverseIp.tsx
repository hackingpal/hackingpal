import { useState } from "react";
import { fetchReverseIp, type ReverseIpReport } from "../api";

export default function ReverseIp() {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReason, setConfirmReason] = useState<string | null>(null);
  const [report, setReport] = useState<ReverseIpReport | null>(null);
  const [filter, setFilter] = useState("");

  async function run(confirm = false) {
    const t = target.trim();
    if (!t) return;
    setBusy(true); setError(null); setConfirmReason(null); setReport(null);
    try {
      const r = await fetchReverseIp(t, confirm);
      if ("needConfirm" in r) setConfirmReason(r.reason);
      else setReport(r);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const filtered = report
    ? report.domains.filter((d) => d.includes(filter.toLowerCase()))
    : [];

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">OSINT</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              Reverse IP
            </h2>
          </div>
          <div className="flex-1 flex gap-2 items-center max-w-2xl">
            <span className="text-ink-dim text-sm select-none">›</span>
            <input
              type="text" value={target} onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") run(); }}
              placeholder="IP address or hostname"
              className="flex-1 bg-bg-card border border-divider rounded
                         px-3 py-1.5 text-sm font-mono text-ink-primary
                         placeholder:text-ink-dim
                         focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
              autoCorrect="off" spellCheck={false}
            />
            <button onClick={() => run()} disabled={busy}
              className="bg-accent hover:bg-accentDim active:translate-y-px
                         text-white text-xs font-bold tracking-wide px-3.5 py-1.5 rounded
                         disabled:opacity-50 disabled:cursor-not-allowed border border-accent/60">
              {busy ? "Looking up…" : "▶ Look up"}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {confirmReason && (
          <div className="rounded-md border-l-4 border-amber/40 border-y border-r border-divider
                          bg-amber/5 px-4 py-3 flex items-start gap-3">
            <span className="text-amber text-lg leading-none">⚠</span>
            <div className="flex-1 text-sm font-mono text-ink-primary">{target} — {confirmReason}</div>
            <button onClick={() => setConfirmReason(null)}
              className="text-[11px] font-bold tracking-wide px-3 py-1.5 rounded
                         bg-bg-card border border-divider text-ink-dim hover:text-ink-primary transition">
              Cancel
            </button>
            <button onClick={() => { setConfirmReason(null); run(true); }}
              className="text-[11px] font-bold tracking-wide px-3 py-1.5 rounded
                         bg-amber/20 border border-amber/40 text-amber hover:bg-amber/30 transition">
              ▶ Proceed
            </button>
          </div>
        )}
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">
            Error — {error}
          </div>
        )}
        {!report && !error && !confirmReason && !busy && <EmptyState />}

        {report && (
          <>
            {report.rate_limited && (
              <div className="rounded-md border-l-4 border-amber/40 border-y border-r border-divider
                              bg-amber/5 px-4 py-2 text-[12px] text-amber font-mono">
                ⚠ HackerTarget free tier rate-limited. Try again tomorrow (~50/day).
              </div>
            )}

            <div className="rounded-md border border-divider bg-bg-card px-4 py-3 flex items-center gap-6">
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">IP</div>
                <div className="mt-0.5 text-sm font-mono font-bold text-ink-primary">{report.ip}</div>
              </div>
              <div className="flex-1" />
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Co-hosted</div>
                <div className="mt-0.5 text-sm font-mono text-ink-primary">{report.count.toLocaleString()}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Elapsed</div>
                <div className="mt-0.5 text-sm font-mono text-ink-primary">{report.elapsed_seconds.toFixed(1)}s</div>
              </div>
            </div>

            {report.findings.length > 0 && (
              <Card title="Findings">
                <ul className="space-y-1">
                  {report.findings.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={"text-[10px] uppercase tracking-widest " +
                        (f.severity === "warn" ? "text-amber" :
                         f.severity === "high" ? "text-danger" : "text-ink-muted")}>
                        {f.severity}
                      </span>
                      <span className="text-ink-primary flex-1">{f.label}</span>
                      <span className="text-ink-muted">{f.detail}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card title={`Domains · ${report.count}`}>
              {report.domains.length === 0 ? (
                <div className="text-ink-dim">No co-hosted domains reported.</div>
              ) : (
                <>
                  <input
                    type="text" placeholder="filter…" value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="w-full bg-bg-base border border-divider rounded
                               px-2 py-1 mb-2 text-[11px] font-mono text-ink-primary
                               placeholder:text-ink-dim focus:outline-none focus:border-accent"
                  />
                  <div className="max-h-96 overflow-auto grid grid-cols-2 gap-x-3 gap-y-0.5">
                    {filtered.slice(0, 400).map((d, i) => (
                      <span key={i} className="text-ink-primary break-all">{d}</span>
                    ))}
                    {filtered.length > 400 && (
                      <span className="text-ink-dim col-span-2 mt-2">
                        … {filtered.length - 400} more
                      </span>
                    )}
                  </div>
                </>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full min-h-[260px] flex items-center justify-center">
      <div className="text-center max-w-md">
        <pre className="text-ink-dim text-[11px] leading-tight select-none">
{`        ┌──────────────┐
        │ REVERSE  IP  │
        │  shared host │
        └──────────────┘`}
        </pre>
        <div className="mt-4 text-xs text-ink-muted">
          What other domains live on a given IP.<br />
          Backed by HackerTarget free tier (~50/day rate limit).
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md overflow-hidden border border-divider">
      <header className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]
                         text-ink-dim border-b border-divider bg-bg-panel">
        {title}
      </header>
      <div className="bg-bg-card p-3 text-xs font-mono">{children}</div>
    </section>
  );
}
