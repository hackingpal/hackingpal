import { useState } from "react";
import { decodeJwt, type JwtReport } from "../api";

const SEV: Record<string, { dot: string; text: string }> = {
  info: { dot: "bg-ink-dim", text: "text-ink-muted" },
  warn: { dot: "bg-amber",   text: "text-amber" },
  high: { dot: "bg-danger",  text: "text-danger" },
};

export default function Jwt() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<JwtReport | null>(null);

  async function run() {
    const t = token.trim();
    if (!t) return;
    setBusy(true); setError(null); setReport(null);
    try { setReport(await decodeJwt(t)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Web</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              JWT Analyzer
            </h2>
          </div>
          <div className="flex-1" />
          <button onClick={run} disabled={busy || !token.trim()}
            className="bg-accent hover:bg-accentDim active:translate-y-px
                       text-white text-xs font-bold tracking-wide px-3.5 py-1.5 rounded
                       disabled:opacity-50 border border-accent/60">
            {busy ? "Decoding…" : "▶ Decode"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        <Card title="Token (paste full JWT — header.payload.signature)">
          <textarea value={token} onChange={(e) => setToken(e.target.value)}
            rows={5} placeholder="eyJhbGciOi..."
            spellCheck={false} autoCorrect="off"
            className="w-full bg-bg-base border border-divider rounded
                       px-2 py-1.5 text-[11px] font-mono text-ink-primary placeholder:text-ink-dim
                       focus:outline-none focus:border-accent resize-y break-all" />
        </Card>

        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">Error — {error}</div>
        )}

        {report && (
          <>
            <div className="rounded-md border border-divider bg-bg-card px-4 py-3 grid grid-cols-4 gap-4">
              <Stat label="alg" value={report.alg || "—"}
                    tone={report.alg === "NONE" ? "text-danger" : "text-ink-primary"} />
              <Stat label="typ" value={report.typ || "—"} tone="text-ink-primary" />
              <Stat label="signature" value={report.signature_present ? "yes" : "absent"}
                    tone={report.signature_present ? "text-phos" : "text-danger"} />
              <Stat label="expired"
                    value={report.claims_meta.expired ? "yes" : "no"}
                    tone={report.claims_meta.expired ? "text-amber" : "text-phos"} />
            </div>

            {report.weak_secret_match && (
              <div className="rounded-md border-l-4 border-danger border-y border-r border-divider
                              bg-danger/10 px-4 py-3 text-sm font-mono">
                <div className="text-[10px] uppercase tracking-[0.25em] text-danger">
                  Critical · Weak HMAC secret
                </div>
                <div className="mt-1 text-ink-primary">
                  Signature verifies with: <span className="text-danger font-bold">
                    {report.weak_secret_match.secret}
                  </span>
                </div>
              </div>
            )}

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

            <Card title="Header">
              <pre className="text-[11px] text-ink-primary whitespace-pre-wrap break-all">
                {JSON.stringify(report.header, null, 2)}
              </pre>
            </Card>

            <Card title="Payload (claims)">
              <pre className="text-[11px] text-ink-primary whitespace-pre-wrap break-all">
                {JSON.stringify(report.payload, null, 2)}
              </pre>
              <div className="mt-3 text-ink-dim">
                {report.claims_meta.iat_iso && <Row k="iat" v={report.claims_meta.iat_iso} />}
                {report.claims_meta.nbf_iso && <Row k="nbf" v={report.claims_meta.nbf_iso} />}
                {report.claims_meta.exp_iso && <Row k="exp" v={report.claims_meta.exp_iso} />}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">{label}</div>
      <div className={"mt-0.5 text-sm font-mono font-bold " + tone}>{value}</div>
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
      <span className="w-12 shrink-0 text-ink-dim">{k}</span>
      <span className="text-ink-primary break-all">{v}</span>
    </div>
  );
}
