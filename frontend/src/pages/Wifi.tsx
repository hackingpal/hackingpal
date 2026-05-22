import { useEffect, useState } from "react";
import { fetchWifiReport, type WifiFinding, type WifiReport, type WifiSeverity } from "../api";

const SEV_DOT: Record<WifiSeverity, string> = {
  pass: "bg-phos", info: "bg-ink-dim", warn: "bg-amber", fail: "bg-danger",
};
const SEV_TEXT: Record<WifiSeverity, string> = {
  pass: "text-phos", info: "text-ink-muted", warn: "text-amber", fail: "text-danger",
};

export default function Wifi() {
  const [report, setReport] = useState<WifiReport | null>(null);
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try { setReport(await fetchWifiReport()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  useEffect(() => { void run(); }, []);

  const grouped = (report?.findings ?? []).reduce((acc, f) => {
    (acc[f.section] ??= []).push(f); return acc;
  }, {} as Record<string, WifiFinding[]>);

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3 flex items-end gap-6">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Utilities</div>
          <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">WiFi Integrity</h2>
        </div>
        <div className="flex-1 text-xs text-ink-muted">
          SSID + encryption check, gateway ARP, DNS hijack heuristic.
        </div>
        <button onClick={run} disabled={busy}
                className="bg-accent hover:bg-accentDim active:translate-y-px
                           text-white text-xs font-bold tracking-wide
                           px-3.5 py-1.5 rounded transition border border-accent/60
                           disabled:opacity-50">
          {busy ? "Running…" : "↻ Run Check"}
        </button>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">Error — {error}</div>
        )}
        {!report && busy && <div className="text-ink-dim text-xs">Running checks…</div>}
        {report && Object.entries(grouped).map(([section, items]) => (
          <section key={section}
                   className="border border-divider rounded-md overflow-hidden bg-bg-card">
            <header className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]
                               text-ink-dim border-b border-divider bg-bg-panel">
              {section}
            </header>
            <div className="p-3 font-mono text-xs space-y-1.5">
              {items.map((f, i) => (
                <div key={i}>
                  <div className="flex items-baseline gap-2">
                    <span className={"inline-block w-1.5 h-1.5 rounded-full mt-1 " + SEV_DOT[f.severity]} />
                    <span className="w-32 shrink-0 text-ink-dim">{f.label}</span>
                    <span className={SEV_TEXT[f.severity] + " break-all"}>
                      {f.value}
                    </span>
                  </div>
                  {f.note && (
                    <div className="ml-6 mt-0.5 text-[11px] text-ink-muted whitespace-pre-line">
                      {f.note}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
