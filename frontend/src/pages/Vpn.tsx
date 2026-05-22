import { useEffect, useState } from "react";
import { fetchVpnStatus, startVpn, stopVpn, type VpnStatus } from "../api";

export default function Vpn() {
  const [status, setStatus] = useState<VpnStatus | null>(null);
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  async function refresh() {
    try { setStatus(await fetchVpnStatus()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  useEffect(() => { void refresh(); }, []);

  async function toggle() {
    if (!status?.available) return;
    setBusy(true); setError(null);
    try {
      if (status.running) await stopVpn();
      else                await startVpn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3 flex items-end gap-6">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Utilities</div>
          <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">VPN Manager</h2>
        </div>
        <div className="flex-1 flex items-center gap-3">
          {status && (
            <>
              <span className={"inline-flex items-center gap-1.5 text-xs uppercase tracking-widest " +
                                (status.running ? "text-phos" : "text-ink-muted")}>
                <span className={"inline-block w-1.5 h-1.5 rounded-full " +
                                  (status.running ? "bg-phos animate-pulse" : "bg-ink-dim")} />
                {status.running ? "RUNNING" : "STOPPED"}
              </span>
              <span className="text-[10px] text-ink-dim">WireGuard wg0</span>
            </>
          )}
        </div>
        {status?.available && (
          <button onClick={toggle} disabled={busy}
                  className={status.running
                    ? "bg-danger/10 hover:bg-danger/20 text-danger border border-danger/60 " +
                      "text-xs font-bold tracking-wide px-3.5 py-1.5 rounded transition " +
                      "active:translate-y-px disabled:opacity-50"
                    : "bg-accent hover:bg-accentDim text-white border border-accent/60 " +
                      "text-xs font-bold tracking-wide px-3.5 py-1.5 rounded transition " +
                      "active:translate-y-px disabled:opacity-50"}>
            {busy ? "…" : status.running ? "■ Stop" : "▶ Start"}
          </button>
        )}
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">Error — {error}</div>
        )}

        {status === null && <div className="text-ink-dim text-xs">Loading…</div>}

        {status && !status.available && (
          <div className="border border-amber/50 bg-amber/5 rounded px-4 py-3">
            <div className="text-amber text-sm font-bold">WireGuard not configured</div>
            <div className="mt-1 text-xs text-ink-muted">
              Missing paths:
              <ul className="mt-1 space-y-0.5">
                {status.missing.map((m) => (
                  <li key={m} className="font-mono text-ink-primary">· {m}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {status && status.available && (
          <>
            <section className="border border-divider rounded-md overflow-hidden bg-bg-card">
              <header className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]
                                 text-ink-dim border-b border-divider bg-bg-panel">
                Server
              </header>
              <div className="p-3 font-mono text-xs space-y-0.5">
                <Row k="Config" v={status.config_path} />
                <Row k="State"  v={status.running ? "active" : "inactive"} />
                {status.wg_show && (
                  <pre className="mt-2 text-[11px] text-ink-muted whitespace-pre-wrap
                                  border-l border-divider pl-3">
                    {status.wg_show}
                  </pre>
                )}
              </div>
            </section>

            <section className="border border-divider rounded-md overflow-hidden bg-bg-card">
              <header className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]
                                 text-ink-dim border-b border-divider bg-bg-panel">
                Clients ({status.clients.length})
              </header>
              <div className="font-mono text-xs">
                {status.clients.length === 0 ? (
                  <div className="p-3 text-ink-dim">No client configs found</div>
                ) : (
                  status.clients.map((c, i) => (
                    <div key={c.name}
                         className={"grid grid-cols-[1fr_220px] gap-3 px-3 py-1 " +
                                    (i % 2 === 0 ? "bg-bg-card" : "bg-bg-row-alt")}>
                      <span className="text-ink-primary">{c.name}</span>
                      <span className="text-ink-muted">{c.address || "—"}</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 text-ink-dim">{k}</span>
      <span className="text-ink-primary break-all">{v}</span>
    </div>
  );
}
