import { useEffect, useRef, useState } from "react";
import { openWs, type PingEvent } from "../api";
import EmptyStateComponent from "../components/EmptyState";
import StatsBar from "../components/StatsBar";
import CopyButton from "../components/CopyButton";

export default function Ping() {
  const [target,   setTarget]   = useState("8.8.8.8");
  const [count,    setCount]    = useState(0);
  const [interval, setInterval] = useState(1.0);
  const [running,  setRunning]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [lines,    setLines]    = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => () => {
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  function start() {
    if (running) return;
    setRunning(true); setError(null); setLines([]);
    const ws = openWs("/ws/ping");
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ target, count, interval }));
    ws.onmessage = (e) => {
      const ev = JSON.parse(e.data) as PingEvent;
      if (ev.type === "started") setLines([`$ ${ev.cmd}`]);
      else if (ev.type === "line") setLines((l) => [...l, ev.text]);
      else if (ev.type === "done") { setRunning(false); ws.close(); }
      else if (ev.type === "error") { setError(ev.detail); setRunning(false); ws.close(); }
    };
    ws.onerror = () => { setError("WebSocket error"); setRunning(false); };
    ws.onclose = () => { if (running) setRunning(false); };
  }

  function stop() {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: "stop" }));
    }
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Discovery</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">Ping</h2>
          </div>

          <div className="flex-1 grid grid-cols-[1fr_90px_100px_auto] gap-2 items-end">
            <Field label="Host">
              <input value={target} onChange={(e) => setTarget(e.target.value)}
                     onKeyDown={(e) => { if (e.key === "Enter") start(); }}
                     disabled={running}
                     placeholder="IP or hostname"
                     className={inputCls()} />
            </Field>
            <Field label="Count">
              <input type="number" min={0} max={1000}
                     value={count} onChange={(e) => setCount(parseInt(e.target.value, 10) || 0)}
                     disabled={running} placeholder="∞"
                     className={inputCls()} />
            </Field>
            <Field label="Interval (s)">
              <input type="number" step="0.1" min={0.1} max={10}
                     value={interval} onChange={(e) => setInterval(parseFloat(e.target.value) || 1.0)}
                     disabled={running}
                     className={inputCls()} />
            </Field>
            <div>
              {!running ? (
                <button onClick={start} className={btnPrimary()}>▶ Ping</button>
              ) : (
                <button onClick={stop} className={btnStop()}>■ Stop</button>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono mb-4">
            Error — {error}
          </div>
        )}
        {lines.length === 0 && !running && !error && (
          <EmptyStateComponent
            icon="📡"
            title="Ping"
            description="Send ICMP echo requests to check reachability and round-trip latency."
            exampleTarget="8.8.8.8"
            onExample={setTarget}
          />
        )}
        {lines.length > 0 && (
          <pre className="font-mono text-[12px] leading-snug whitespace-pre-wrap
                          bg-bg-card border border-divider rounded p-3 text-ink-primary">
            {lines.map((ln, i) => (
              <div key={i} className={ln.startsWith("$") ? "text-ink-dim" :
                                       ln.includes("Request timeout") ? "text-amber" :
                                       ln.includes("bytes from") ? "text-phos" : ""}>
                {ln || " "}
              </div>
            ))}
          </pre>
        )}
        {lines.length > 0 && (
          <div className="mt-2 relative">
            <div className="absolute -top-9 right-1">
              <CopyButton text={lines.join("\n")} alwaysVisible label="Copy all" />
            </div>
            <StatsBar
              total={lines.filter((ln) => ln.includes("bytes from")).length}
              running={running}
              extra={lines.filter((ln) => ln.includes("Request timeout")).length > 0
                ? `${lines.filter((ln) => ln.includes("Request timeout")).length} timeouts`
                : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const inputCls = () =>
  "w-full bg-bg-card border border-divider rounded px-3 py-1.5 text-sm font-mono " +
  "text-ink-primary placeholder:text-ink-dim focus:outline-none focus:border-accent " +
  "focus:ring-1 focus:ring-accent/30 disabled:opacity-60";
const btnPrimary = () =>
  "bg-accent hover:bg-accentDim active:translate-y-px text-white text-xs font-bold " +
  "tracking-wide px-3.5 py-1.5 rounded transition border border-accent/60";
const btnStop = () =>
  "bg-danger/10 hover:bg-danger/20 active:translate-y-px text-danger text-xs font-bold " +
  "tracking-wide px-3.5 py-1.5 rounded transition border border-danger/60";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest text-ink-dim block mb-1">{label}</span>
      {children}
    </label>
  );
}
