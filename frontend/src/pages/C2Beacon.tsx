import { useEffect, useState } from "react";
import { api, BACKEND_URL, parseError } from "../api";

type Callback = {
  ts: string; source: string; method: string; path: string;
  bytes_in: number; preview: string;
};

type Listener = {
  id: string; port: number; host: string; mode: "http" | "tcp";
  token: string; created_at: string;
  callbacks: Callback[]; callback_count: number;
};

type Beacons = Record<string, string>;

type ListResp = {
  listeners: Listener[];
  beacons: Record<string, Beacons>;
};

export default function C2Beacon() {
  const [data, setData] = useState<ListResp | null>(null);
  const [port, setPort] = useState(8080);
  const [host, setHost] = useState("0.0.0.0");
  const [mode, setMode] = useState<"http" | "tcp">("http");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    try { setData(await api<ListResp>("/c2/listeners")); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, []);

  async function start() {
    setLoading(true); setError("");
    try {
      const r = await fetch(`${BACKEND_URL}/c2/listener`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port, host, mode }),
      });
      if (!r.ok) throw new Error(await parseError(r));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }

  async function stop(id: string) {
    if (!confirm("Stop this listener?")) return;
    await fetch(`${BACKEND_URL}/c2/listener/${id}`, { method: "DELETE" });
    void refresh();
  }

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">C2 BEACON SIMULATOR</h2>
        <p className="text-[11px] text-ink-dim">
          Spin up listeners on chosen ports, then fire the suggested beacon
          commands from a target host. Use this to confirm whether your egress
          firewall actually blocks the ports/methods you assume it does.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 mb-4 space-y-2">
        <div className="text-[10px] text-ink-muted tracking-wider">START LISTENER</div>
        <div className="grid grid-cols-4 gap-2 text-[12px]">
          <label>port <input type="number" min={1} max={65535} value={port}
                 onChange={(e) => setPort(parseInt(e.target.value) || 8080)}
                 className="ml-1 w-20 bg-bg-base border border-divider rounded px-1.5 py-0.5
                            font-mono focus:outline-none focus:border-accent" /></label>
          <label>bind <input value={host} onChange={(e) => setHost(e.target.value)}
                 className="ml-1 w-28 bg-bg-base border border-divider rounded px-1.5 py-0.5
                            font-mono focus:outline-none focus:border-accent" /></label>
          <label>mode <select value={mode} onChange={(e) => setMode(e.target.value as "http" | "tcp")}
                 className="ml-1 bg-bg-base border border-divider rounded px-1.5 py-0.5
                            font-mono focus:outline-none focus:border-accent">
                 <option value="http">http</option>
                 <option value="tcp">tcp</option>
                 </select></label>
          <button onClick={start} disabled={loading}
                  className="px-3 py-0.5 rounded bg-accent text-white text-[12px] font-bold disabled:opacity-40">
            Start
          </button>
        </div>
        {error && <div className="text-[11px] text-danger">⚠ {error}</div>}
        <p className="text-[10px] text-ink-dim mt-1">
          Listeners bind to <code>0.0.0.0</code> by default. You'll need your
          firewall open + a routable IP (LAN address, or expose via ngrok /
          Cloudflare tunnel for off-net beacons). Suggested commands below use
          a <code>&lt;your-ip&gt;</code> placeholder — replace before pasting.
        </p>
      </div>

      {data && data.listeners.length === 0 && (
        <div className="text-[12px] text-ink-dim italic">No listeners yet.</div>
      )}

      <div className="space-y-3">
        {data?.listeners.map((l) => (
          <div key={l.id} className="border border-divider rounded p-3">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-[10px] uppercase border border-accent/40 text-accent rounded px-1.5">
                {l.mode}
              </span>
              <span className="font-mono text-[13px] text-ink-primary">
                {l.host}:{l.port}
              </span>
              <span className="text-[10px] text-ink-dim font-mono">token={l.token}</span>
              <span className="text-[10px] text-ink-dim">
                {l.callback_count} callback{l.callback_count === 1 ? "" : "s"}
              </span>
              <span className="flex-1" />
              <button onClick={() => stop(l.id)}
                      className="px-2 py-0.5 rounded border border-danger text-danger text-[11px]">
                Stop
              </button>
            </div>

            {/* Beacon command suggestions */}
            <div className="bg-bg-panel border border-divider rounded p-2 mb-2">
              <div className="text-[10px] text-ink-muted tracking-wider mb-1">SUGGESTED BEACONS</div>
              <div className="space-y-1">
                {Object.entries(data.beacons[l.id] || {}).map(([name, cmd]) => (
                  <div key={name} className="flex items-start gap-2 text-[11px]">
                    <span className="font-mono text-amber w-20 shrink-0">{name}:</span>
                    <code className="font-mono text-phos break-all flex-1">{cmd}</code>
                    <button onClick={() => navigator.clipboard?.writeText(cmd)}
                            className="text-[10px] text-accent hover:underline shrink-0">copy</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Callback log */}
            {l.callbacks.length > 0 ? (
              <div>
                <div className="text-[10px] text-ink-muted tracking-wider mb-1">CALLBACKS</div>
                <div className="bg-bg-panel border border-divider rounded overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead className="bg-bg-base border-b border-divider text-ink-muted text-[10px]">
                      <tr>
                        <th className="text-left px-2 py-1">TIME</th>
                        <th className="text-left px-2 py-1">SOURCE</th>
                        <th className="text-left px-2 py-1 w-16">METHOD</th>
                        <th className="text-left px-2 py-1">PATH</th>
                        <th className="text-right px-2 py-1 w-16">BYTES</th>
                      </tr>
                    </thead>
                    <tbody>
                      {l.callbacks.slice().reverse().map((c, i) => (
                        <tr key={i} className="border-b border-divider align-top">
                          <td className="px-2 py-1 font-mono text-ink-dim">{c.ts.split("T")[1]?.replace("Z", "")}</td>
                          <td className="px-2 py-1 font-mono text-phos">{c.source}</td>
                          <td className="px-2 py-1 font-mono text-amber">{c.method}</td>
                          <td className="px-2 py-1 font-mono text-ink-primary truncate max-w-[200px]">{c.path}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{c.bytes_in}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-ink-dim italic">
                Waiting for callbacks… (refreshes every 2s)
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
