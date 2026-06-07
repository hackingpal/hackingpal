import { useState } from "react";
import { fetchTlsAudit, isApiError, type TlsReport } from "../api";
import SeverityBadge, { normalizeSeverity } from "../components/SeverityBadge";
import StatsBar from "../components/StatsBar";
import EmptyStateComponent from "../components/EmptyState";
import CopyButton from "../components/CopyButton";

const PROTO_TIER: Record<string, "legacy" | "modern"> = {
  "SSLv3":   "legacy",
  "TLSv1.0": "legacy",
  "TLSv1.1": "legacy",
  "TLSv1.2": "modern",
  "TLSv1.3": "modern",
};

export default function TlsAudit() {
  const [host, setHost] = useState("anthropic.com");
  const [port, setPort] = useState(443);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [report, setReport] = useState<TlsReport | null>(null);

  async function run() {
    const h = host.trim();
    if (!h) return;
    setBusy(true);
    setError(null);
    setTimedOut(false);
    setReport(null);
    try {
      setReport(await fetchTlsAudit(h, port));
    } catch (e) {
      if (isApiError(e, "TIMEOUT")) setTimedOut(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3 flex flex-col gap-2">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">
              Recon
            </div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              TLS Auditor
            </h2>
          </div>

          <div className="flex-1 flex gap-2 items-center max-w-2xl">
            <span className="text-ink-dim text-sm select-none">›</span>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") run(); }}
              placeholder="host"
              className="flex-1 bg-bg-card border border-divider rounded
                         px-3 py-1.5 text-sm font-mono text-ink-primary
                         placeholder:text-ink-dim
                         focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
                         transition"
              autoCorrect="off"
              spellCheck={false}
            />
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(parseInt(e.target.value) || 443)}
              className="w-20 bg-bg-card border border-divider rounded
                         px-2 py-1.5 text-sm font-mono text-ink-primary
                         focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
              min={1}
              max={65535}
            />
            <button
              onClick={run}
              disabled={busy}
              className="bg-accent hover:bg-accentDim active:translate-y-px
                         text-white text-xs font-bold tracking-wide
                         px-3.5 py-1.5 rounded transition
                         disabled:opacity-50 disabled:cursor-not-allowed
                         border border-accent/60"
            >
              {busy ? "Auditing…" : "▶ Audit"}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {timedOut && (
          <div className="border border-amber/40 bg-amber/10 text-amber
                          rounded px-3 py-2 text-sm font-mono flex items-center gap-3">
            <span>⏱</span>
            <div className="flex-1">
              <div className="font-bold">TLS audit timed out</div>
              <div className="text-[11px] text-ink-muted">
                The server didn't respond in time. Retry, or check connectivity.
              </div>
            </div>
            <button
              onClick={run}
              className="text-[10px] uppercase tracking-widest px-2 py-1 rounded border
                         border-amber/40 text-amber hover:bg-amber/10 transition"
            >
              Retry
            </button>
          </div>
        )}

        {error && !timedOut && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">
            Error — {error}
          </div>
        )}

        {!report && !error && !timedOut && !busy && (
          <EmptyStateComponent
            icon="🔒"
            title="TLS Auditor"
            description="Cert chain · expiry · SAN · TLS version support · HSTS"
            exampleTarget="anthropic.com"
            onExample={setHost}
          />
        )}

        {report && (
          <>
            {report.policy.verdict === "warn" && (
              <div className="rounded-md border-l-4 border-amber/40 border-y border-r border-divider
                              bg-amber/5 px-4 py-2 text-[11px] text-ink-muted font-mono">
                <span className="text-amber">⚠ external target</span> — {report.policy.reason}
              </div>
            )}

            <Banner report={report} />

            <CertCard report={report} />
            <ProtocolGrid protocols={report.protocols} />

            {report.negotiated_cipher && (
              <Card title="Negotiated cipher">
                <Row k="Cipher"   v={report.negotiated_cipher.name} />
                <Row k="Protocol" v={report.negotiated_cipher.protocol} />
                <Row k="Bits"     v={String(report.negotiated_cipher.bits)} />
              </Card>
            )}

            <Card title="HTTP / HSTS">
              <Row k="HSTS"
                   v={report.hsts.present
                      ? <span className="text-phos">✓ present (max-age {report.hsts.max_age}s
                          {report.hsts.include_subdomains ? ", includeSubDomains" : ""}
                          {report.hsts.preload ? ", preload" : ""})</span>
                      : <span className="text-amber">✗ not set</span>} />
              <Row k="HTTP→HTTPS"
                   v={report.http_redirect_to_https === true
                      ? <span className="text-phos">✓ redirects</span>
                      : report.http_redirect_to_https === false
                        ? <span className="text-amber">✗ no redirect</span>
                        : <span className="text-ink-dim">(not tested)</span>} />
            </Card>

            {report.findings.length > 0 && (
              <Card title={`Findings · ${report.findings.length}`}>
                <ul className="space-y-1">
                  {report.findings.map((f, i) => (
                    <li
                      key={i}
                      style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                      className="group flex items-start gap-2 mhp-result-in"
                    >
                      <SeverityBadge severity={normalizeSeverity(f.severity)} />
                      <span className="text-ink-primary flex-1">{f.label}</span>
                      <span className="text-ink-muted">{f.detail}</span>
                      <CopyButton text={`[${f.severity}] ${f.label} — ${f.detail}`} />
                    </li>
                  ))}
                </ul>
                <StatsBar
                  total={report.findings.length}
                  critical={report.findings.filter((f) => f.severity === "high").length}
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

function Banner({ report }: { report: TlsReport }) {
  const days = report.cert.days_until_expiry ?? 999;
  const exp =
    days < 0     ? { text: `EXPIRED ${-days}d ago`,   cls: "text-danger" } :
    days < 14    ? { text: `expires in ${days}d`,     cls: "text-danger" } :
    days < 30    ? { text: `expires in ${days}d`,     cls: "text-amber"  } :
                   { text: `valid · ${days}d left`,   cls: "text-phos"   };

  return (
    <div className="rounded-md border border-divider bg-bg-card px-4 py-3 flex items-center gap-4">
      <div>
        <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Host</div>
        <div className="mt-0.5 text-sm font-mono font-bold text-ink-primary break-all">
          {report.host}:{report.port}
        </div>
        <div className="mt-0.5 text-[11px] text-ink-muted">{report.ip}</div>
      </div>
      <div className="flex-1" />
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Certificate</div>
        <div className={"mt-0.5 text-sm font-mono " + exp.cls}>{exp.text}</div>
      </div>
    </div>
  );
}

function CertCard({ report }: { report: TlsReport }) {
  const c = report.cert;
  return (
    <Card title="Certificate">
      <Row k="Subject"    v={c.subject ?? "—"} />
      <Row k="Issuer"     v={c.issuer ?? "—"} />
      <Row k="Hostname"   v={c.hostname_matches
                              ? <span className="text-phos">✓ matches CN/SAN</span>
                              : <span className="text-danger">✗ does not match</span>} />
      <Row k="Self-signed"
           v={c.self_signed
              ? <span className="text-amber">yes</span>
              : <span className="text-phos">no</span>} />
      <Row k="Key"        v={`${c.key_type ?? "?"} · ${c.key_bits ?? "?"} bits`} />
      <Row k="Signature"  v={c.signature_algorithm ?? "—"} />
      <Row k="Not before" v={(c.not_before ?? "").split("T")[0]} />
      <Row k="Not after"  v={(c.not_after  ?? "").split("T")[0]} />
      <Row k="SHA-256"    v={<span className="text-ink-muted break-all">{c.sha256 ?? "—"}</span>} />
      {c.sans && c.sans.length > 0 && (
        <Row k={`SANs · ${c.sans.length}`} v={
          <div className="flex flex-col">
            {c.sans.slice(0, 12).map((s, i) => <span key={i}>{s}</span>)}
            {c.sans.length > 12 && <span className="text-ink-dim">… and {c.sans.length - 12} more</span>}
          </div>
        }/>
      )}
    </Card>
  );
}

function ProtocolGrid({ protocols }: { protocols: Record<string, string> }) {
  const order = ["SSLv3", "TLSv1.0", "TLSv1.1", "TLSv1.2", "TLSv1.3"];
  return (
    <Card title="Protocol support">
      <div className="grid grid-cols-[100px_1fr] gap-y-1">
        {order.map((v) => {
          const state = protocols[v] ?? "not_tested";
          const tier = PROTO_TIER[v];
          let icon: string;
          let cls: string;
          if (state === "supported" && tier === "legacy") {
            icon = "✗ supported"; cls = "text-danger";
          } else if (state === "supported") {
            icon = "✓ supported"; cls = "text-phos";
          } else if (state === "unsupported" && tier === "modern" && v === "TLSv1.3") {
            icon = "✗ off"; cls = "text-amber";
          } else if (state === "unsupported") {
            icon = "✓ off"; cls = "text-ink-muted";
          } else {
            icon = "— not tested"; cls = "text-ink-dim";
          }
          return (
            <div key={v} className="contents">
              <span className="text-ink-dim">{v}</span>
              <span className={cls}>{icon}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Card({
  title, accent, children,
}: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <section className={"rounded-md overflow-hidden border " + (accent ?? "border-divider")}>
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
