import { useState } from "react";
import { fetchWhois, type WhoisReport } from "../api";

const SEV: Record<string, { text: string; dot: string }> = {
  info: { text: "text-ink-muted", dot: "bg-ink-dim" },
  warn: { text: "text-amber",     dot: "bg-amber"   },
  high: { text: "text-danger",    dot: "bg-danger"  },
};

export default function Whois() {
  const [target, setTarget] = useState("anthropic.com");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<WhoisReport | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  async function run() {
    const t = target.trim();
    if (!t) return;
    setBusy(true);
    setError(null);
    setReport(null);
    setShowRaw(false);
    try {
      setReport(await fetchWhois(t));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
              Discovery
            </div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              WHOIS · ASN
            </h2>
          </div>

          <div className="flex-1 flex gap-2 items-center max-w-2xl">
            <span className="text-ink-dim text-sm select-none">›</span>
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") run(); }}
              placeholder="domain.com, 1.2.3.4, or 1.2.3.0/24"
              className="flex-1 bg-bg-card border border-divider rounded
                         px-3 py-1.5 text-sm font-mono text-ink-primary
                         placeholder:text-ink-dim
                         focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
                         transition"
              autoCorrect="off"
              spellCheck={false}
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
              {busy ? "Querying…" : "▶ Look up"}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">
            Error — {error}
          </div>
        )}

        {!report && !error && !busy && <EmptyState />}

        {report && (
          <>
            {report.policy.verdict === "warn" && (
              <div className="rounded-md border-l-4 border-amber/40 border-y border-r border-divider
                              bg-amber/5 px-4 py-2 text-[11px] text-ink-muted font-mono">
                <span className="text-amber">⚠ external target</span> — {report.policy.reason}
              </div>
            )}

            <Banner report={report} />

            {report.target_type === "domain" && <DomainCard report={report} />}
            {(report.target_type === "ip" || report.target_type === "cidr") &&
              <NetworkCard report={report} />}
            {report.asn.number && <AsnCard report={report} />}

            {report.findings.length > 0 && (
              <Card title={`Findings · ${report.findings.length}`}>
                <ul className="space-y-1">
                  {report.findings.map((f, i) => {
                    const sev = SEV[f.severity] ?? SEV.info;
                    return (
                      <li key={i} className="flex items-start gap-2">
                        <span className={"inline-block w-2 h-2 rounded-full mt-1.5 " + sev.dot} />
                        <span className={"text-[10px] uppercase tracking-widest " + sev.text}>
                          {f.severity}
                        </span>
                        <span className="text-ink-primary flex-1">{f.label}</span>
                        <span className="text-ink-muted">{f.detail}</span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}

            <Card
              title={showRaw ? "Raw WHOIS · hide" : "Raw WHOIS · show"}
              onTitleClick={() => setShowRaw((v) => !v)}
            >
              {showRaw ? (
                <pre className="text-[11px] text-ink-muted whitespace-pre-wrap leading-tight max-h-96 overflow-auto">
                  {report.raw || "(empty)"}
                </pre>
              ) : (
                <div className="text-ink-dim">click to expand</div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Banner({ report }: { report: WhoisReport }) {
  const label =
    report.target_type === "domain" ? "Domain" :
    report.target_type === "cidr"   ? "CIDR"   : "IP";
  const right =
    report.target_type === "domain"
      ? (report.resolved_ip ?? "—")
      : (report.network.org ?? "—");
  return (
    <div className="rounded-md border border-divider bg-bg-card px-4 py-3 flex items-center gap-4">
      <div>
        <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">
          {label}
        </div>
        <div className="mt-0.5 text-sm font-mono font-bold text-ink-primary break-all">
          {report.target}
        </div>
      </div>
      <div className="flex-1" />
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">
          {report.target_type === "domain" ? "Resolved IP" : "Organisation"}
        </div>
        <div className="mt-0.5 text-sm font-mono text-ink-primary">{right}</div>
      </div>
    </div>
  );
}

function DomainCard({ report }: { report: WhoisReport }) {
  const d = report.domain;
  return (
    <Card title="Registration">
      <Row k="Registrar"  v={d.registrar ?? <span className="text-ink-dim">—</span>} />
      <Row k="Registrant" v={d.registrant ?? <span className="text-ink-dim">—</span>} />
      <Row k="Created"    v={d.created ?? <span className="text-ink-dim">—</span>} />
      <Row k="Updated"    v={d.updated ?? <span className="text-ink-dim">—</span>} />
      <Row k="Expires"    v={d.expires ?? <span className="text-ink-dim">—</span>} />
      {d.nameservers && d.nameservers.length > 0 && (
        <Row k="Nameservers" v={
          <div className="flex flex-col">
            {d.nameservers.slice(0, 8).map((ns, i) => <span key={i}>{ns}</span>)}
          </div>
        }/>
      )}
      {d.status && d.status.length > 0 && (
        <Row k="Status" v={
          <div className="flex flex-col">
            {d.status.slice(0, 6).map((s, i) => <span key={i}>{s}</span>)}
          </div>
        }/>
      )}
    </Card>
  );
}

function NetworkCard({ report }: { report: WhoisReport }) {
  const n = report.network;
  return (
    <Card title="Network">
      <Row k="Range"   v={n.netrange ?? <span className="text-ink-dim">—</span>} />
      <Row k="CIDR"    v={n.cidr ?? <span className="text-ink-dim">—</span>} />
      <Row k="Org"     v={n.org ?? <span className="text-ink-dim">—</span>} />
      <Row k="Country" v={n.country ?? <span className="text-ink-dim">—</span>} />
    </Card>
  );
}

function AsnCard({ report }: { report: WhoisReport }) {
  const a = report.asn;
  return (
    <Card title="Autonomous System">
      <Row k="ASN"        v={<span className="text-accent">AS{a.number}</span>} />
      <Row k="Name"       v={a.name ?? <span className="text-ink-dim">—</span>} />
      <Row k="Prefix"     v={a.prefix ?? <span className="text-ink-dim">—</span>} />
      <Row k="Country"    v={a.country ?? <span className="text-ink-dim">—</span>} />
      <Row k="Registry"   v={a.registry ?? <span className="text-ink-dim">—</span>} />
      <Row k="Allocated"  v={a.allocated ?? <span className="text-ink-dim">—</span>} />
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="h-full min-h-[260px] flex items-center justify-center">
      <div className="text-center max-w-md">
        <pre className="text-ink-dim text-[11px] leading-tight select-none">
{`        ┌──────────────┐
        │   W H O I S  │
        │   ▶ ASN ▶    │
        └──────────────┘`}
        </pre>
        <div className="mt-4 text-xs text-ink-muted">
          Registrar · netblock · BGP origin ASN
        </div>
        <div className="mt-2 text-[10px] text-ink-dim">
          Try a domain, IP, or CIDR.
        </div>
      </div>
    </div>
  );
}

function Card({
  title, accent, onTitleClick, children,
}: { title: string; accent?: string; onTitleClick?: () => void; children: React.ReactNode }) {
  return (
    <section className={"rounded-md overflow-hidden border " + (accent ?? "border-divider")}>
      <header
        className={"px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] " +
                   "text-ink-dim border-b border-divider bg-bg-panel " +
                   (onTitleClick ? "cursor-pointer hover:text-ink-primary transition" : "")}
        onClick={onTitleClick}
      >
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
