import { useEffect, useState } from "react";
import { fetchMacosPosture, type MacosPosture } from "../api";

const STATUS_TINT = (good: boolean | null): string =>
  good === null ? "text-ink-dim" : good ? "text-phos" : "text-danger";

export default function MacosPosturePage() {
  const [report, setReport] = useState<MacosPosture | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try { setReport(await fetchMacosPosture()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void run(); }, []);

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Forensics</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              macOS Posture
            </h2>
          </div>
          <div className="flex-1" />
          <button onClick={run} disabled={busy}
            className="bg-accent hover:bg-accentDim active:translate-y-px
                       text-white text-xs font-bold tracking-wide px-3.5 py-1.5 rounded
                       disabled:opacity-50 border border-accent/60">
            {busy ? "Checking…" : "↻ Rescan"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">Error — {error}</div>
        )}
        {report && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="SIP"        value={report.sip.status}
                    good={report.sip.status === "enabled"} />
              <Stat label="Gatekeeper" value={report.gatekeeper.status}
                    good={report.gatekeeper.status === "enabled"} />
              <Stat label="FileVault"  value={report.filevault.status}
                    good={report.filevault.status === "on"} />
              <Stat label="Firewall"   value={report.firewall.global_state === 0 ? "off" :
                                              report.firewall.global_state === 1 ? "on" :
                                              report.firewall.global_state === 2 ? "block all" : "?"}
                    good={report.firewall.global_state >= 1} />
              <Stat label="Stealth mode" value={report.firewall.stealth ? "on" : "off"}
                    good={report.firewall.stealth} />
              <Stat label="XProtect" value={report.xprotect.version || "?"} good={null} />
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

            <Card title="Raw output (collapsed sections)">
              <details><summary className="cursor-pointer text-ink-dim">SIP</summary>
                <pre className="mt-1 text-[11px] text-ink-muted whitespace-pre-wrap">{report.sip.raw}</pre>
              </details>
              <details className="mt-2"><summary className="cursor-pointer text-ink-dim">Gatekeeper</summary>
                <pre className="mt-1 text-[11px] text-ink-muted whitespace-pre-wrap">{report.gatekeeper.raw}</pre>
              </details>
              <details className="mt-2"><summary className="cursor-pointer text-ink-dim">FileVault</summary>
                <pre className="mt-1 text-[11px] text-ink-muted whitespace-pre-wrap">{report.filevault.raw}</pre>
              </details>
              <details className="mt-2"><summary className="cursor-pointer text-ink-dim">Firewall</summary>
                <pre className="mt-1 text-[11px] text-ink-muted whitespace-pre-wrap">{report.firewall.raw}</pre>
              </details>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, good }:
  { label: string; value: string; good: boolean | null }) {
  return (
    <div className="rounded-md border border-divider bg-bg-card px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">{label}</div>
      <div className={"mt-0.5 text-base font-mono font-bold " + STATUS_TINT(good)}>
        {value}
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
