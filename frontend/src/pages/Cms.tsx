import { useState } from "react";
import { fetchCms, type CmsReport } from "../api";
import EmptyStateComponent from "../components/EmptyState";
import StatsBar from "../components/StatsBar";
import CopyButton from "../components/CopyButton";

const CONF_TINT: Record<string, string> = {
  high: "text-phos border-phos/40 bg-phos/10",
  med:  "text-accent border-accent/40 bg-accent/10",
  low:  "text-ink-muted border-divider bg-bg-card",
};

export default function Cms() {
  const [url, setUrl] = useState("https://example.com");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReason, setConfirmReason] = useState<string | null>(null);
  const [report, setReport] = useState<CmsReport | null>(null);

  async function run(confirm = false) {
    const u = url.trim();
    if (!u) return;
    setBusy(true); setError(null); setConfirmReason(null); setReport(null);
    try {
      const r = await fetchCms(u, confirm);
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
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Web</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              CMS / Stack Fingerprint
            </h2>
          </div>
          <div className="flex-1 flex gap-2 items-center max-w-2xl">
            <span className="text-ink-dim text-sm select-none">›</span>
            <input
              type="text" value={url} onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") run(); }}
              placeholder="https://target.example.com"
              className="flex-1 bg-bg-card border border-divider rounded
                         px-3 py-1.5 text-sm font-mono text-ink-primary placeholder:text-ink-dim
                         focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
              autoCorrect="off" spellCheck={false} />
            <button onClick={() => run()} disabled={busy}
              className="bg-accent hover:bg-accentDim active:translate-y-px
                         text-white text-xs font-bold tracking-wide px-3.5 py-1.5 rounded
                         disabled:opacity-50 border border-accent/60">
              {busy ? "Probing…" : "▶ Fingerprint"}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {confirmReason && (
          <ConfirmBanner reason={confirmReason} target={url}
            onCancel={() => setConfirmReason(null)}
            onConfirm={() => { setConfirmReason(null); run(true); }} />
        )}
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">Error — {error}</div>
        )}
        {!report && !error && !confirmReason && !busy && (
          <EmptyStateComponent
            icon="🧩"
            title="CMS / Stack Fingerprint"
            description="Detects CMSes, frontend / backend frameworks, CDNs, hosting providers. One HTTP GET, headers + HTML + cookies inspection. ~40 signatures."
            exampleTarget="https://example.com"
            onExample={setUrl}
          />
        )}

        {report && (
          <>
            <div className="rounded-md border border-divider bg-bg-card px-4 py-3 flex items-center gap-6">
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Host</div>
                <div className="text-sm font-mono font-bold text-ink-primary">{report.host}</div>
                <div className="text-[11px] text-ink-muted">HTTP {report.status_code} · {report.elapsed_seconds.toFixed(2)}s</div>
              </div>
              <div className="flex-1" />
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Technologies</div>
                <div className="text-sm font-mono text-ink-primary">{report.technologies.length}</div>
              </div>
            </div>

            {Object.entries(report.by_category).map(([cat, techs]) => (
              <Card key={cat} title={cat}>
                <div className="flex flex-wrap gap-2">
                  {techs.map((t) => (
                    <div key={t.name}
                      className={"px-2.5 py-1 rounded border text-[11px] " + (CONF_TINT[t.confidence] ?? CONF_TINT.low)}>
                      <span className="font-bold">{t.name}</span>
                      {t.version && <span className="ml-1 opacity-70">v{t.version}</span>}
                      <span className="ml-1 text-[9px] uppercase tracking-wider opacity-60">
                        {t.confidence}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            ))}

            {Object.keys(report.interesting_headers).length > 0 && (
              <Card title="Interesting headers">
                {Object.entries(report.interesting_headers).map(([k, v]) => (
                  <Row key={k} k={k} v={v} />
                ))}
              </Card>
            )}

            {report.findings.length > 0 && (
              <Card title={`Findings · ${report.findings.length}`}>
                <ul className="space-y-1">
                  {report.findings.map((f, i) => (
                    <li
                      key={i}
                      style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                      className="group flex items-start gap-2 mhp-result-in"
                    >
                      <span className={"text-[10px] uppercase tracking-widest " +
                        (f.severity === "high" ? "text-danger" :
                         f.severity === "warn" ? "text-amber" : "text-ink-muted")}>
                        {f.severity}
                      </span>
                      <span className="text-ink-primary flex-1">{f.label}</span>
                      <span className="text-ink-muted">{f.detail}</span>
                      <CopyButton text={`[${f.severity}] ${f.label} — ${f.detail}`} />
                    </li>
                  ))}
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

function ConfirmBanner({ reason, target, onCancel, onConfirm }:
  { reason: string; target: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="rounded-md border-l-4 border-amber/40 border-y border-r border-divider
                    bg-amber/5 px-4 py-3 flex items-start gap-3">
      <span className="text-amber text-lg leading-none">⚠</span>
      <div className="flex-1 text-sm font-mono text-ink-primary">{target} — {reason}</div>
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
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md overflow-hidden border border-divider">
      <header className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]
                         text-ink-dim border-b border-divider bg-bg-panel">{title}</header>
      <div className="bg-bg-card p-3 text-xs font-mono">{children}</div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-0.5">
      <span className="w-32 shrink-0 text-ink-dim break-all">{k}</span>
      <span className="text-ink-primary break-all">{v}</span>
    </div>
  );
}
