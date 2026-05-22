import { useState } from "react";
import { fetchGraphql, type GraphqlReport } from "../api";

export default function Graphql() {
  const [url, setUrl] = useState("https://example.com/graphql");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReason, setConfirmReason] = useState<string | null>(null);
  const [report, setReport] = useState<GraphqlReport | null>(null);

  async function run(confirm = false) {
    const u = url.trim();
    if (!u) return;
    setBusy(true); setError(null); setConfirmReason(null); setReport(null);
    try {
      const r = await fetchGraphql(u, confirm);
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
              GraphQL Introspection
            </h2>
          </div>
          <div className="flex-1 flex gap-2 items-center max-w-2xl">
            <span className="text-ink-dim text-sm select-none">›</span>
            <input
              type="text" value={url} onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") run(); }}
              placeholder="https://target.example.com/graphql"
              className="flex-1 bg-bg-card border border-divider rounded
                         px-3 py-1.5 text-sm font-mono text-ink-primary placeholder:text-ink-dim
                         focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
              autoCorrect="off" spellCheck={false} />
            <button onClick={() => run()} disabled={busy}
              className="bg-accent hover:bg-accentDim active:translate-y-px
                         text-white text-xs font-bold tracking-wide px-3.5 py-1.5 rounded
                         disabled:opacity-50 border border-accent/60">
              {busy ? "Probing…" : "▶ Introspect"}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {confirmReason && (
          <div className="rounded-md border-l-4 border-amber/40 border-y border-r border-divider
                          bg-amber/5 px-4 py-3 flex items-start gap-3">
            <span className="text-amber text-lg leading-none">⚠</span>
            <div className="flex-1 text-sm font-mono text-ink-primary">{url} — {confirmReason}</div>
            <button onClick={() => setConfirmReason(null)}
              className="text-[11px] font-bold tracking-wide px-3 py-1.5 rounded
                         bg-bg-card border border-divider text-ink-dim hover:text-ink-primary">
              Cancel
            </button>
            <button onClick={() => { setConfirmReason(null); run(true); }}
              className="text-[11px] font-bold tracking-wide px-3 py-1.5 rounded
                         bg-amber/20 border border-amber/40 text-amber hover:bg-amber/30">
              ▶ Proceed
            </button>
          </div>
        )}
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">Error — {error}</div>
        )}
        {!report && !error && !confirmReason && !busy && <EmptyState />}

        {report && (
          <>
            <div className="rounded-md border border-divider bg-bg-card px-4 py-3 flex items-center gap-6">
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Target</div>
                <div className="text-sm font-mono font-bold text-ink-primary">{report.host}</div>
                <div className="text-[11px] text-ink-muted">HTTP {report.status_code} · {report.elapsed_seconds.toFixed(2)}s</div>
              </div>
              <div className="flex-1" />
              <Stat label="Introspection"
                    value={report.introspection_enabled ? "ENABLED" : "blocked"}
                    tone={report.introspection_enabled ? "text-danger" : "text-phos"} />
              {report.introspection_enabled && (
                <>
                  <Stat label="Types"     value={String(report.type_count ?? 0)}  tone="text-ink-primary" />
                  <Stat label="Queries"   value={String(report.queries?.length ?? 0)} tone="text-ink-primary" />
                  <Stat label="Mutations" value={String(report.mutations?.length ?? 0)} tone="text-amber" />
                </>
              )}
            </div>

            {report.findings.length > 0 && (
              <Card title={`Findings · ${report.findings.length}`}>
                <ul className="space-y-1">
                  {report.findings.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={"text-[10px] uppercase tracking-widest " +
                        (f.severity === "high" ? "text-danger" :
                         f.severity === "warn" ? "text-amber" : "text-ink-muted")}>
                        {f.severity}
                      </span>
                      <span className="text-ink-primary flex-1">{f.label}</span>
                      <span className="text-ink-muted">{f.detail}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {report.introspection_enabled && report.queries && report.queries.length > 0 && (
              <Card title={`Queries · ${report.queries.length}`}>
                <FieldList fields={report.queries} />
              </Card>
            )}

            {report.introspection_enabled && report.mutations && report.mutations.length > 0 && (
              <Card title={`Mutations · ${report.mutations.length}`}>
                <FieldList fields={report.mutations} accent="text-amber" />
              </Card>
            )}

            {report.introspection_enabled && report.deprecated && report.deprecated.length > 0 && (
              <Card title={`Deprecated · ${report.deprecated.length}`}>
                {report.deprecated.map((f, i) => (
                  <div key={i} className="border-b border-divider py-1">
                    <span className="text-ink-dim">{f.parent}.</span>
                    <span className="text-ink-primary">{f.field}</span>
                    <span className="text-ink-muted">: {f.type}</span>
                    {f.reason && <div className="text-[10px] text-amber">{f.reason}</div>}
                  </div>
                ))}
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FieldList({ fields, accent }:
  { fields: { field: string; type: string; args: { name: string; type: string }[]; description: string }[];
    accent?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {fields.map((f, i) => (
        <div key={i} className="border-b border-divider py-1 last:border-0">
          <span className={accent ?? "text-accent"}>{f.field}</span>
          {f.args.length > 0 && (
            <span className="text-ink-muted">
              ({f.args.map((a) => `${a.name}: ${a.type}`).join(", ")})
            </span>
          )}
          <span className="text-ink-dim">: {f.type}</span>
          {f.description && (
            <div className="text-[10px] text-ink-muted">{f.description}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">{label}</div>
      <div className={"mt-0.5 text-sm font-mono font-bold " + tone}>{value}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full min-h-[260px] flex items-center justify-center">
      <div className="text-center max-w-md">
        <pre className="text-ink-dim text-[11px] leading-tight select-none">
{`        ┌──────────────┐
        │  GRAPHQL     │
        │  introspect  │
        └──────────────┘`}
        </pre>
        <div className="mt-4 text-xs text-ink-muted">
          POSTs the standard introspection query.<br />
          If enabled (common dev/staging leak) you get the entire schema.
        </div>
      </div>
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
