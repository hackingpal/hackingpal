import { useEffect, useRef, useState } from "react";
import {
  fetchTcpdumpInterfaces, fetchTcpdumpStatus,
  installTcpdumpSudoers, openWs,
  type TcpdumpEvent, type TcpdumpStatus,
} from "../api";

export default function Tcpdump() {
  const [status,    setStatus]    = useState<TcpdumpStatus | null>(null);
  const [ifaces,    setIfaces]    = useState<string[]>(["any"]);
  const [iface,     setIface]     = useState("en0");
  const [filter,    setFilter]    = useState("");
  const [count,     setCount]     = useState(0);
  const [verbose,   setVerbose]   = useState(false);
  const [resolve,   setResolve]   = useState(false);
  const [running,   setRunning]   = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [lines,     setLines]     = useState<string[]>([]);
  const [captured,  setCaptured]  = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  async function refreshStatus() {
    try {
      const [s, ifs] = await Promise.all([fetchTcpdumpStatus(), fetchTcpdumpInterfaces()]);
      setStatus(s);
      setIfaces(ifs.interfaces);
      if (!ifs.interfaces.includes(iface)) setIface(ifs.interfaces[1] ?? "any");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { void refreshStatus(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function install() {
    setInstalling(true); setError(null);
    try {
      await installTcpdumpSudoers();
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  }

  function start() {
    if (running || !status?.passwordless) return;
    setRunning(true); setError(null); setLines([]); setCaptured(0);
    const ws = openWs("/ws/tcpdump");
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ iface, filter, count, verbose, resolve }));
    ws.onmessage = (e) => {
      const ev = JSON.parse(e.data) as TcpdumpEvent;
      if (ev.type === "started") setLines([`$ ${ev.cmd}`]);
      else if (ev.type === "line") setLines((l) => [...l.slice(-999), ev.text]);
      else if (ev.type === "stopped") { setCaptured(ev.captured); setRunning(false); ws.close(); }
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

  const needsInstall = status !== null && !status.passwordless;

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Recon</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">TCPDump</h2>
          </div>

          <div className="flex-1 grid grid-cols-[140px_1fr_90px_auto_auto] gap-2 items-end">
            <Field label="Interface">
              <select value={iface} onChange={(e) => setIface(e.target.value)}
                      disabled={running}
                      className={inputCls() + " appearance-none"}>
                {ifaces.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </Field>
            <Field label="BPF Filter">
              <input value={filter} onChange={(e) => setFilter(e.target.value)}
                     onKeyDown={(e) => { if (e.key === "Enter") start(); }}
                     disabled={running}
                     placeholder='e.g.  tcp port 80  |  host 8.8.8.8'
                     className={inputCls()} />
            </Field>
            <Field label="Count">
              <input type="number" min={0} max={100000}
                     value={count} onChange={(e) => setCount(parseInt(e.target.value, 10) || 0)}
                     disabled={running} placeholder="∞"
                     className={inputCls()} />
            </Field>
            <div className="flex flex-col gap-1 pt-4">
              <label className="text-[10px] tracking-widest text-ink-muted flex items-center gap-1.5">
                <input type="checkbox" checked={verbose} onChange={(e) => setVerbose(e.target.checked)}
                       disabled={running} />
                VERBOSE
              </label>
              <label className="text-[10px] tracking-widest text-ink-muted flex items-center gap-1.5">
                <input type="checkbox" checked={resolve} onChange={(e) => setResolve(e.target.checked)}
                       disabled={running} />
                RESOLVE DNS
              </label>
            </div>
            <div>
              {!running ? (
                <button onClick={start} disabled={needsInstall || !status}
                        className={btnPrimary() + " disabled:opacity-50 disabled:cursor-not-allowed"}>
                  ▶ Capture
                </button>
              ) : (
                <button onClick={stop} className={btnStop()}>■ Stop</button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-2 text-[10px] tracking-widest text-ink-dim flex items-center gap-2">
          {status === null
            ? <span>Checking permissions…</span>
            : status.passwordless
              ? <span className="text-phos">● PASSWORDLESS SUDO READY · {status.user}</span>
              : <span className="text-amber">⚠ ADMIN PASSWORD REQUIRED — install one-time permission below</span>
          }
          {!running && captured > 0 && (
            <span className="ml-auto">CAPTURED {captured}</span>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono mb-4">
            Error — {error}
          </div>
        )}

        {needsInstall && (
          <div className="border border-amber/50 bg-amber/5 rounded px-4 py-3 mb-4
                          flex items-start gap-3">
            <div className="flex-1">
              <div className="text-amber text-sm font-bold">One-time admin permission</div>
              <div className="text-xs text-ink-muted mt-1 leading-relaxed">
                tcpdump needs root to capture packets. Click <em>Install</em> to add a
                passwordless sudoers entry just for <code className="text-ink-primary">/usr/sbin/tcpdump</code>.
                macOS will prompt for your password once — never again.
              </div>
            </div>
            <button onClick={install} disabled={installing}
                    className={btnPrimary() + " disabled:opacity-50"}>
              {installing ? "Installing…" : "Install Permission"}
            </button>
          </div>
        )}

        {lines.length === 0 && !running && !error && !needsInstall && (
          <div className="text-ink-dim text-xs font-mono">
            Set an interface and press <kbd className="px-1.5 py-0.5 rounded bg-bg-card
              border border-divider text-[10px] text-ink-primary">▶ Capture</kbd>
          </div>
        )}

        {lines.length > 0 && (
          <pre className="font-mono text-[11px] leading-snug whitespace-pre-wrap
                          bg-bg-card border border-divider rounded p-3 text-ink-primary
                          max-h-[calc(100vh-280px)] overflow-auto">
            {lines.map((ln, i) => {
              const lo = ln.toLowerCase();
              let cls = "";
              if (ln.startsWith("$")) cls = "text-ink-dim";
              else if (lo.includes("tcp")) cls = "text-accent";
              else if (lo.includes("udp")) cls = "text-phos";
              else if (lo.includes("icmp")) cls = "text-amber";
              else if (lo.includes("arp"))  cls = "text-amber";
              else if (lo.includes("error") || lo.includes("warning")) cls = "text-danger";
              return <div key={i} className={cls}>{ln || " "}</div>;
            })}
          </pre>
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
