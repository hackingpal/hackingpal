import { useState } from "react";
import { fetchEmailAudit, type EmailReport } from "../api";
import EmptyStateComponent from "../components/EmptyState";
import StatsBar from "../components/StatsBar";
import CopyButton from "../components/CopyButton";

const SEV: Record<string, { text: string; dot: string }> = {
  info: { text: "text-ink-muted", dot: "bg-ink-dim" },
  warn: { text: "text-amber",     dot: "bg-amber"   },
  high: { text: "text-danger",    dot: "bg-danger"  },
};

export default function EmailSecurity() {
  const [domain, setDomain] = useState("anthropic.com");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReason, setConfirmReason] = useState<string | null>(null);
  const [report, setReport] = useState<EmailReport | null>(null);

  async function run(confirm = false) {
    const d = domain.trim();
    if (!d) return;
    setBusy(true); setError(null); setConfirmReason(null); setReport(null);
    try {
      const r = await fetchEmailAudit(d, confirm);
      if ("needConfirm" in r) setConfirmReason(r.reason);
      else setReport(r);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">OSINT</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              Email Security
            </h2>
          </div>
          <div className="flex-1 flex gap-2 items-center max-w-2xl">
            <span className="text-ink-dim text-sm select-none">›</span>
            <input
              type="text" value={domain} onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") run(); }}
              placeholder="domain.com"
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
              {busy ? "Auditing…" : "▶ Audit"}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {confirmReason && (
          <div className="rounded-md border-l-4 border-amber/40 border-y border-r border-divider
                          bg-amber/5 px-4 py-3 flex items-start gap-3">
            <span className="text-amber text-lg leading-none">⚠</span>
            <div className="flex-1 text-sm font-mono text-ink-primary">
              {domain} — {confirmReason}
            </div>
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
        {!report && !error && !confirmReason && !busy && (
          <EmptyStateComponent
            icon="📧"
            title="Email Security"
            description="DNS-only audit: SPF, DMARC, MTA-STS, BIMI, DKIM (common selectors)"
            exampleTarget="anthropic.com"
            onExample={setDomain}
          />
        )}

        {report && (
          <>
            <Banner report={report} />

            <Card title="SPF (Sender Policy Framework)" status={spfStatus(report)}>
              {report.spf.present ? (
                <>
                  <pre className="text-[11px] text-ink-muted whitespace-pre-wrap mb-2">{report.spf.raw}</pre>
                  <Row k="all qualifier" v={qualifierText(report.spf.all_qualifier)} />
                  <Row k="mechanisms" v={report.spf.mechanisms.length} />
                </>
              ) : (
                <div className="text-danger">No v=spf1 record on apex</div>
              )}
            </Card>

            <Card title="DMARC" status={dmarcStatus(report)}>
              {report.dmarc.present ? (
                <>
                  <pre className="text-[11px] text-ink-muted whitespace-pre-wrap mb-2">{report.dmarc.raw}</pre>
                  {Object.entries(report.dmarc.tags).map(([k, v]) => (
                    <Row key={k} k={k} v={v} />
                  ))}
                </>
              ) : (
                <div className="text-danger">No DMARC record at _dmarc.{report.domain}</div>
              )}
            </Card>

            <Card title="MTA-STS" status={report.mta_sts.present ? "ok" : "info"}>
              {report.mta_sts.present ? (
                <>
                  <pre className="text-[11px] text-ink-muted whitespace-pre-wrap mb-2">{report.mta_sts.raw}</pre>
                  {report.mta_sts.tags && Object.entries(report.mta_sts.tags).map(([k, v]) => (
                    <Row key={k} k={k} v={v} />
                  ))}
                </>
              ) : (
                <div className="text-ink-dim">Not configured (optional)</div>
              )}
            </Card>

            <Card title="DKIM selectors found"
                  status={report.dkim.wildcard ? "warn"
                          : report.dkim.selectors_found.length ? "ok" : "info"}>
              {report.dkim.wildcard ? (
                <div className="text-amber">
                  Wildcard *._domainkey.{report.domain} returns DKIM-shaped records for any selector.
                  Individual selector probing is meaningless on this domain.
                  {report.dkim.wildcard_record && (
                    <pre className="mt-2 text-[11px] text-ink-muted whitespace-pre-wrap break-all">
                      {report.dkim.wildcard_record}
                    </pre>
                  )}
                </div>
              ) : report.dkim.selectors_found.length === 0 ? (
                <div className="text-ink-dim">No common selector responded (may use a custom selector)</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {report.dkim.selectors_found.map((s) => (
                    <div key={s}>
                      <div className="text-accent">{s}._domainkey.{report.domain}</div>
                      <pre className="text-[11px] text-ink-muted whitespace-pre-wrap break-all">
                        {report.dkim.raw[s]?.slice(0, 220)}{report.dkim.raw[s]?.length > 220 ? "…" : ""}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="BIMI" status={report.bimi.present ? "ok" : "info"}>
              {report.bimi.present ? (
                <pre className="text-[11px] text-ink-muted whitespace-pre-wrap">{report.bimi.raw}</pre>
              ) : (
                <div className="text-ink-dim">No BIMI record (optional, requires DMARC enforcement first)</div>
              )}
            </Card>

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
          </>
        )}
      </div>
    </div>
  );
}

function spfStatus(r: EmailReport): "ok" | "warn" | "fail" | "info" {
  if (!r.spf.present) return "fail";
  if (r.spf.all_qualifier === "-") return "ok";
  if (r.spf.all_qualifier === "~") return "info";
  if (r.spf.all_qualifier === "+" || r.spf.all_qualifier === "?") return "warn";
  return "info";
}

function dmarcStatus(r: EmailReport): "ok" | "warn" | "fail" | "info" {
  if (!r.dmarc.present) return "fail";
  const p = r.dmarc.tags["p"]?.toLowerCase();
  if (p === "reject") return "ok";
  if (p === "quarantine") return "info";
  if (p === "none") return "warn";
  return "info";
}

function qualifierText(q: string): React.ReactNode {
  switch (q) {
    case "-": return <span className="text-phos">-all (hard fail)</span>;
    case "~": return <span className="text-amber">~all (soft fail)</span>;
    case "?": return <span className="text-amber">?all (neutral)</span>;
    case "+": return <span className="text-danger">+all (permissive — bad)</span>;
    default:  return <span className="text-ink-dim">(none)</span>;
  }
}

function Banner({ report }: { report: EmailReport }) {
  return (
    <div className="rounded-md border border-divider bg-bg-card px-4 py-3 flex items-center gap-6">
      <div>
        <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Domain</div>
        <div className="mt-0.5 text-sm font-mono font-bold text-ink-primary">{report.domain}</div>
      </div>
      <div className="flex-1" />
      <StatusPill label="SPF"     ok={report.spf.present} />
      <StatusPill label="DMARC"   ok={report.dmarc.present} />
      <StatusPill label="MTA-STS" ok={report.mta_sts.present} />
      <StatusPill label="DKIM"    ok={report.dkim.selectors_found.length > 0} />
      <StatusPill label="BIMI"    ok={report.bimi.present} />
    </div>
  );
}

function StatusPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">{label}</div>
      <div className={"mt-0.5 text-sm font-mono " + (ok ? "text-phos" : "text-ink-dim")}>
        {ok ? "✓" : "—"}
      </div>
    </div>
  );
}

function Card({
  title, status = "info", children,
}: {
  title: string;
  status?: "ok" | "warn" | "fail" | "info";
  children: React.ReactNode;
}) {
  const accent =
    status === "fail" ? "border-danger/40" :
    status === "warn" ? "border-amber/40" :
    status === "ok"   ? "border-phos/40"  : "border-divider";
  return (
    <section className={"rounded-md overflow-hidden border " + accent}>
      <header className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]
                         text-ink-dim border-b border-divider bg-bg-panel">
        {title}
      </header>
      <div className="bg-bg-card p-3 text-xs font-mono">{children}</div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-0.5">
      <span className="w-28 shrink-0 text-ink-dim">{k}</span>
      <span className="text-ink-primary break-all">{v}</span>
    </div>
  );
}
