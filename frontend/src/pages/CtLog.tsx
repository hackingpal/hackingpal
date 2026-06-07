import { useState } from "react";
import { fetchCtSearch, type CtReport } from "../api";
import EmptyStateComponent from "../components/EmptyState";
import StatsBar from "../components/StatsBar";
import CopyButton from "../components/CopyButton";

const SEV: Record<string, { text: string; dot: string }> = {
  info: { text: "text-ink-muted", dot: "bg-ink-dim" },
  warn: { text: "text-amber",     dot: "bg-amber"   },
  high: { text: "text-danger",    dot: "bg-danger"  },
};

export default function CtLog() {
  const [domain, setDomain] = useState("anthropic.com");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReason, setConfirmReason] = useState<string | null>(null);
  const [report, setReport] = useState<CtReport | null>(null);
  const [filter, setFilter] = useState("");

  async function run(confirm = false) {
    const d = domain.trim();
    if (!d) return;
    setBusy(true); setError(null); setConfirmReason(null); setReport(null);
    try {
      const r = await fetchCtSearch(d, confirm);
      if ("needConfirm" in r) setConfirmReason(r.reason);
      else setReport(r);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const filtered = report
    ? report.subdomains.filter((s) => s.includes(filter.toLowerCase()))
    : [];

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">OSINT</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              CT Log Search
            </h2>
          </div>
          <div className="flex-1 flex gap-2 items-center max-w-2xl">
            <span className="text-ink-dim text-sm select-none">›</span>
            <input
              type="text" value={domain} onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") run(); }}
              placeholder="example.com"
              className="flex-1 bg-bg-card border border-divider rounded
                         px-3 py-1.5 text-sm font-mono text-ink-primary
                         placeholder:text-ink-dim
                         focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
              autoCorrect="off" spellCheck={false}
            />
            <button
              onClick={() => run()} disabled={busy}
              className="bg-accent hover:bg-accentDim active:translate-y-px
                         text-white text-xs font-bold tracking-wide px-3.5 py-1.5 rounded
                         disabled:opacity-50 disabled:cursor-not-allowed border border-accent/60"
            >
              {busy ? "Querying crt.sh…" : "▶ Search CT logs"}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {confirmReason && (
          <ConfirmBanner
            reason={confirmReason} target={domain}
            onCancel={() => setConfirmReason(null)}
            onConfirm={() => { setConfirmReason(null); run(true); }}
          />
        )}
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">
            Error — {error}
          </div>
        )}
        {!report && !error && !confirmReason && !busy && (
          <EmptyStateComponent
            icon="📜"
            title="CT Log Search"
            description="Pulls every cert ever issued under a domain. Surfaces subdomains a wordlist enum will never find."
            exampleTarget="anthropic.com"
            onExample={setDomain}
          />
        )}

        {report && (
          <>
            {report.throttled && (
              <div className="rounded-md border-l-4 border-amber/40 border-y border-r border-divider
                              bg-amber/5 px-4 py-2 text-[12px] text-amber font-mono">
                ⚠ crt.sh returned 502 (rate-limited). Cached empty result for 60s — try again in a minute.
              </div>
            )}
            <Banner report={report} />
            {report.findings.length > 0 && (
              <Card title={`Findings · ${report.findings.length}`}>
                <ul className="space-y-1">
                  {report.findings.map((f, i) => {
                    const sev = SEV[f.severity] ?? SEV.info;
                    return (
                      <li
                        key={i}
                        style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                        className="group flex items-start gap-2 mhp-result-in"
                      >
                        <span className={"inline-block w-2 h-2 rounded-full mt-1.5 " + sev.dot} />
                        <span className={"text-[10px] uppercase tracking-widest " + sev.text}>
                          {f.severity}
                        </span>
                        <span className="text-ink-primary flex-1">{f.label}</span>
                        <span className="text-ink-muted">{f.detail}</span>
                        <CopyButton text={`[${f.severity}] ${f.label} — ${f.detail}`} />
                      </li>
                    );
                  })}
                </ul>
                <StatsBar
                  total={report.findings.length}
                  high={report.findings.filter((f) => f.severity === "high").length}
                  medium={report.findings.filter((f) => f.severity === "warn").length}
                  className="mt-2 -mx-3 -mb-3"
                />
              </Card>
            )}

            <Card title={`Subdomains · ${report.subdomains.length}`}>
              <input
                type="text" placeholder="filter…" value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full bg-bg-base border border-divider rounded
                           px-2 py-1 mb-2 text-[11px] font-mono text-ink-primary
                           placeholder:text-ink-dim focus:outline-none focus:border-accent"
              />
              <div className="max-h-80 overflow-auto grid grid-cols-2 gap-x-3 gap-y-0.5">
                {filtered.slice(0, 400).map((s, i) => (
                  <div
                    key={i}
                    style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                    className="group flex items-center gap-2 mhp-result-in"
                  >
                    <span className="text-ink-primary break-all flex-1">{s}</span>
                    <CopyButton text={s} />
                  </div>
                ))}
                {filtered.length > 400 && (
                  <span className="text-ink-dim col-span-2 mt-2">
                    … {filtered.length - 400} more (refine filter to see)
                  </span>
                )}
              </div>
            </Card>

            {report.wildcard_subdomains.length > 0 && (
              <Card title={`Wildcard SANs · ${report.wildcard_subdomains.length}`}>
                <div className="flex flex-col gap-0.5">
                  {report.wildcard_subdomains.map((s, i) => (
                    <span key={i} className="text-amber break-all">{s}</span>
                  ))}
                </div>
              </Card>
            )}

            <Card title="Recent certificates">
              <div className="flex flex-col gap-0.5">
                <div className="grid grid-cols-[2fr_2fr_1fr_1fr_auto] gap-x-3">
                  <span className="text-ink-dim text-[10px] uppercase tracking-wider">CN</span>
                  <span className="text-ink-dim text-[10px] uppercase tracking-wider">Issuer</span>
                  <span className="text-ink-dim text-[10px] uppercase tracking-wider">Not before</span>
                  <span className="text-ink-dim text-[10px] uppercase tracking-wider">Not after</span>
                  <span />
                </div>
                {report.recent_certs.map((c, i) => (
                  <div
                    key={i}
                    style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                    className="group grid grid-cols-[2fr_2fr_1fr_1fr_auto] gap-x-3 items-center mhp-result-in"
                  >
                    <span className="text-ink-primary break-all">{c.name}</span>
                    <span className="text-ink-muted break-all">{c.issuer}</span>
                    <span className="text-ink-muted">{c.not_before.split("T")[0]}</span>
                    <span className="text-ink-muted">{c.not_after.split("T")[0]}</span>
                    <CopyButton text={`${c.name} · ${c.issuer} · ${c.not_before.split("T")[0]} → ${c.not_after.split("T")[0]}`} />
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Banner({ report }: { report: CtReport }) {
  return (
    <div className="rounded-md border border-divider bg-bg-card px-4 py-3 flex items-center gap-6">
      <div>
        <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Domain</div>
        <div className="mt-0.5 text-sm font-mono font-bold text-ink-primary">{report.domain}</div>
      </div>
      <div className="flex-1" />
      <Stat label="CT records" value={report.total_records.toLocaleString()} />
      <Stat label="Unique subs" value={report.subdomains.length.toLocaleString()} />
      <Stat label="Wildcards"   value={report.wildcard_subdomains.length.toLocaleString()} />
      <Stat label="Last 7 days" value={report.recent_7d_count.toLocaleString()} />
      <Stat label="Elapsed"     value={`${report.elapsed_seconds.toFixed(1)}s`} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">{label}</div>
      <div className="mt-0.5 text-sm font-mono text-ink-primary">{value}</div>
    </div>
  );
}

function ConfirmBanner({
  reason, target, onCancel, onConfirm,
}: { reason: string; target: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="rounded-md border-l-4 border-amber/40 border-y border-r border-divider
                    bg-amber/5 px-4 py-3 flex items-start gap-3">
      <span className="text-amber text-lg leading-none">⚠</span>
      <div className="flex-1">
        <div className="text-[10px] uppercase tracking-[0.25em] text-amber">External target</div>
        <div className="mt-1 text-sm font-mono text-ink-primary">
          About to query crt.sh for <span className="text-amber">{target}</span> — {reason}
        </div>
        <div className="mt-1 text-[11px] text-ink-muted">
          This hits the public CT log search — passive, but external.
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel}
          className="text-[11px] font-bold tracking-wide px-3 py-1.5 rounded
                     bg-bg-card border border-divider text-ink-dim hover:text-ink-primary transition">
          Cancel
        </button>
        <button onClick={onConfirm}
          className="text-[11px] font-bold tracking-wide px-3 py-1.5 rounded
                     bg-amber/20 border border-amber/40 text-amber hover:bg-amber/30 transition">
          ▶ Proceed
        </button>
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
