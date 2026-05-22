import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  BACKEND_URL, openWs,
  fetchRevInterfaces, fetchRevListeners, fetchRevSessions, fetchPayloadKinds,
  createRevListener, stopRevListener, killRevSession, generatePayload,
  type BindInterface, type RevListener, type RevSession, type PayloadKind,
  type RevWsEvent,
} from "../api";

type Tab = "listeners" | "payloads" | "sessions";

export default function ReverseShell() {
  const [tab, setTab] = useState<Tab>("listeners");
  const [ifaces, setIfaces] = useState<BindInterface[]>([]);
  const [listeners, setListeners] = useState<RevListener[]>([]);
  const [sessions, setSessions] = useState<RevSession[]>([]);
  const [kinds, setKinds] = useState<PayloadKind[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openSession, setOpenSession] = useState<string | null>(null);

  async function refresh() {
    try {
      const [i, l, s] = await Promise.all([
        fetchRevInterfaces(), fetchRevListeners(), fetchRevSessions(),
      ]);
      setIfaces(i.interfaces);
      setListeners(l.listeners);
      setSessions(s.sessions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh();
    fetchPayloadKinds().then((r) => setKinds(r.kinds)).catch(() => {});
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Exploit</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">Reverse Shell</h2>
          </div>
          <div className="flex-1 flex gap-1">
            {(["listeners", "payloads", "sessions"] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={
                  "px-3 py-1.5 text-xs font-bold tracking-wide rounded border " +
                  (tab === t
                    ? "bg-accent/15 text-accent border-accent/60"
                    : "bg-bg-card text-ink-muted border-divider hover:text-ink-primary")
                }>
                {t.toUpperCase()}
                {t === "sessions" && sessions.length > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center
                                  w-4 h-4 rounded-full bg-phos/20 text-phos text-[9px]">
                    {sessions.length}
                  </span>
                )}
              </button>
            ))}
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
        {tab === "listeners" && (
          <ListenersTab
            interfaces={ifaces} listeners={listeners} onChange={refresh}
            onError={setError}
          />
        )}
        {tab === "payloads" && (
          <PayloadsTab kinds={kinds} listeners={listeners} onError={setError} />
        )}
        {tab === "sessions" && (
          <SessionsTab
            sessions={sessions} onOpen={(sid) => setOpenSession(sid)}
            onKill={async (sid) => { await killRevSession(sid).catch(() => {}); refresh(); }}
          />
        )}
      </div>

      {openSession && (
        <SessionTerminal sid={openSession} onClose={() => setOpenSession(null)} />
      )}
    </div>
  );
}

// ── Listeners tab ─────────────────────────────────────────────────────────────

function ListenersTab({
  interfaces, listeners, onChange, onError,
}: {
  interfaces: BindInterface[];
  listeners: RevListener[];
  onChange: () => void;
  onError: (e: string | null) => void;
}) {
  const [host, setHost] = useState("0.0.0.0");
  const [port, setPort] = useState(4444);
  const [autoUpgrade, setAutoUpgrade] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (interfaces.length && !interfaces.some((i) => i.addr === host)) {
      setHost(interfaces[1]?.addr ?? interfaces[0]?.addr ?? "0.0.0.0");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interfaces.length]);

  async function start() {
    setCreating(true); onError(null);
    try {
      await createRevListener(host, port, autoUpgrade);
      onChange();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function stop(id: string) {
    onError(null);
    try {
      await stopRevListener(id);
      onChange();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <div className="bg-bg-card border border-divider rounded p-4 mb-6">
        <div className="grid grid-cols-[1fr_120px_auto_auto] gap-3 items-end">
          <Field label="Bind interface">
            <select value={host} onChange={(e) => setHost(e.target.value)}
                    className={inputCls() + " appearance-none"}>
              {interfaces.map((i) => (
                <option key={i.addr} value={i.addr}>
                  {i.name} — {i.addr}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Port">
            <input type="number" min={1} max={65535} value={port}
                   onChange={(e) => setPort(parseInt(e.target.value, 10) || 0)}
                   className={inputCls()} />
          </Field>
          <label className="text-[10px] tracking-widest text-ink-muted flex items-center gap-1.5 pb-2">
            <input type="checkbox" checked={autoUpgrade}
                   onChange={(e) => setAutoUpgrade(e.target.checked)} />
            AUTO-UPGRADE PTY
          </label>
          <button onClick={start} disabled={creating} className={btnPrimary()}>
            {creating ? "Starting…" : "▶ Start Listener"}
          </button>
        </div>
        <p className="text-[10px] text-ink-dim mt-3 leading-relaxed">
          Listener binds a raw TCP socket. A reverse-shell payload (see PAYLOADS tab)
          run on the target host will dial back into this socket and appear under SESSIONS.
        </p>
      </div>

      {listeners.length === 0 ? (
        <div className="text-ink-dim text-xs font-mono">No active listeners.</div>
      ) : (
        <div className="border border-divider rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-card text-[10px] tracking-widest text-ink-dim">
              <tr>
                <th className="text-left px-3 py-2">Bind</th>
                <th className="text-left px-3 py-2">Port</th>
                <th className="text-left px-3 py-2">PTY</th>
                <th className="text-left px-3 py-2">Sessions</th>
                <th className="text-right px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {listeners.map((l) => (
                <tr key={l.id} className="border-t border-divider">
                  <td className="px-3 py-2 font-mono text-xs">{l.host}</td>
                  <td className="px-3 py-2 font-mono text-xs">{l.port}</td>
                  <td className="px-3 py-2 text-xs">
                    {l.auto_upgrade ? <span className="text-phos">auto</span>
                                    : <span className="text-ink-dim">off</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{l.sessions}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => stop(l.id)} className={btnStop()}>
                      ■ Stop
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Payloads tab ──────────────────────────────────────────────────────────────

function PayloadsTab({
  kinds, listeners, onError,
}: {
  kinds: PayloadKind[];
  listeners: RevListener[];
  onError: (e: string | null) => void;
}) {
  const [kind, setKind] = useState("bash-tcp");
  const [lhost, setLhost] = useState("");
  const [lport, setLport] = useState(4444);
  const [cmd, setCmd] = useState("");
  const [copied, setCopied] = useState(false);

  // Default LHOST/LPORT to the most recent listener (it's almost always what you want)
  useEffect(() => {
    if (!listeners.length) return;
    const latest = listeners[listeners.length - 1];
    if (!lhost) {
      // 0.0.0.0 isn't a useful LHOST — fall back to a real iface guess.
      setLhost(latest.host === "0.0.0.0" || latest.host === "127.0.0.1"
        ? "127.0.0.1" : latest.host);
    }
    setLport(latest.port);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listeners.length]);

  async function generate() {
    onError(null); setCopied(false);
    try {
      const r = await generatePayload(kind, lhost, lport);
      setCmd(r.cmd);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function copy() {
    if (!cmd) return;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  const groups = useMemo(() => {
    const out: Record<string, PayloadKind[]> = {};
    for (const k of kinds) (out[k.platform] = out[k.platform] || []).push(k);
    return out;
  }, [kinds]);

  return (
    <>
      <div className="bg-bg-card border border-divider rounded p-4 mb-4">
        <div className="grid grid-cols-[1fr_1fr_120px_auto] gap-3 items-end">
          <Field label="Kind">
            <select value={kind} onChange={(e) => setKind(e.target.value)}
                    className={inputCls() + " appearance-none"}>
              {Object.entries(groups).map(([plat, ks]) => (
                <optgroup key={plat} label={plat.toUpperCase()}>
                  {ks.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="LHOST">
            <input value={lhost} onChange={(e) => setLhost(e.target.value)}
                   placeholder="callback IP" className={inputCls()} />
          </Field>
          <Field label="LPORT">
            <input type="number" min={1} max={65535} value={lport}
                   onChange={(e) => setLport(parseInt(e.target.value, 10) || 0)}
                   className={inputCls()} />
          </Field>
          <button onClick={generate} disabled={!lhost} className={btnPrimary()}>
            Generate
          </button>
        </div>
        {kinds.find((k) => k.id === kind)?.note && (
          <p className="text-[10px] text-ink-dim mt-3">
            {kinds.find((k) => k.id === kind)?.note}
          </p>
        )}
      </div>

      {cmd && (
        <div className="bg-bg-card border border-divider rounded">
          <div className="flex items-center justify-between px-3 py-2 border-b border-divider">
            <span className="text-[10px] tracking-widest text-ink-dim">PAYLOAD</span>
            <button onClick={copy} className="text-xs text-accent hover:text-ink-primary">
              {copied ? "✓ Copied" : "Copy"}
            </button>
          </div>
          <pre className="font-mono text-[11px] leading-snug whitespace-pre-wrap
                          text-ink-primary p-3 select-all break-all">{cmd}</pre>
        </div>
      )}
    </>
  );
}

// ── Sessions tab ──────────────────────────────────────────────────────────────

function SessionsTab({
  sessions, onOpen, onKill,
}: {
  sessions: RevSession[];
  onOpen: (id: string) => void;
  onKill: (id: string) => void;
}) {
  if (sessions.length === 0) {
    return (
      <div className="text-ink-dim text-xs font-mono">
        No active sessions. Start a listener and run a payload on the target.
      </div>
    );
  }
  return (
    <div className="border border-divider rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-bg-card text-[10px] tracking-widest text-ink-dim">
          <tr>
            <th className="text-left px-3 py-2">ID</th>
            <th className="text-left px-3 py-2">Remote</th>
            <th className="text-left px-3 py-2">PTY</th>
            <th className="text-left px-3 py-2">↓/↑ bytes</th>
            <th className="text-left px-3 py-2">Transcript</th>
            <th className="text-right px-3 py-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className="border-t border-divider hover:bg-bg-card/40">
              <td className="px-3 py-2 font-mono text-xs">{s.id}</td>
              <td className="px-3 py-2 font-mono text-xs">{s.remote}</td>
              <td className="px-3 py-2 text-xs">
                {s.upgraded ? <span className="text-phos">on</span>
                            : <span className="text-amber">raw</span>}
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-ink-muted">
                {s.bytes_in} / {s.bytes_out}
              </td>
              <td className="px-3 py-2 font-mono text-[10px] text-ink-dim truncate max-w-[280px]">
                {s.transcript.split("/").pop()}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                <button onClick={() => onOpen(s.id)} className={btnPrimary() + " mr-2"}>
                  Open
                </button>
                <button onClick={() => onKill(s.id)} className={btnStop()}>
                  Kill
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Terminal modal ────────────────────────────────────────────────────────────

function SessionTerminal({ sid, onClose }: { sid: string; onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      fontFamily: "ui-monospace, Menlo, monospace",
      fontSize: 12,
      cursorBlink: true,
      theme: { background: "#0a0d10", foreground: "#d0d6dc" },
      convertEol: false,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const ws = openWs(`/ws/reverse-shell/${sid}`);
    wsRef.current = ws;

    const sendInput = (data: string) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const b64 = btoa(unescape(encodeURIComponent(data)));
      ws.send(JSON.stringify({ type: "input", data: b64 }));
    };

    ws.onopen = () => {
      setStatus("open");
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    ws.onmessage = (e) => {
      const ev = JSON.parse(e.data) as RevWsEvent;
      if (ev.type === "history" || ev.type === "data") {
        const bin = atob(ev.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        term.write(bytes);
      } else if (ev.type === "info") {
        term.writeln(`\x1b[33m[*] ${ev.text}\x1b[0m`);
      } else if (ev.type === "closed") {
        term.writeln("\r\n\x1b[31m[!] session closed\x1b[0m");
        setStatus("closed");
      }
    };
    ws.onclose = () => setStatus("closed");
    ws.onerror = () => setStatus("closed");

    term.onData(sendInput);

    const onResize = () => {
      try { fit.fit(); } catch { /* host not measured yet */ }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      try { ws.close(); } catch { /* already closed */ }
      term.dispose();
    };
  }, [sid]);

  function sendUpgrade() {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "upgrade" }));
    }
  }

  const transcriptUrl = `${BACKEND_URL}`; // no static endpoint — show path only

  return (
    <div className="fixed inset-0 z-40 bg-black/80 flex flex-col p-6">
      <div className="bg-bg-card border border-divider rounded flex flex-col flex-1 overflow-hidden">
        <header className="px-4 py-2 border-b border-divider flex items-center gap-3">
          <span className="text-[10px] tracking-widest text-ink-dim">SESSION</span>
          <span className="font-mono text-xs text-ink-primary">{sid}</span>
          <span className={
            "text-[10px] tracking-widest px-2 py-0.5 rounded " +
            (status === "open" ? "bg-phos/15 text-phos"
              : status === "connecting" ? "bg-amber/15 text-amber"
              : "bg-danger/15 text-danger")
          }>
            {status.toUpperCase()}
          </span>
          <div className="flex-1" />
          <button onClick={sendUpgrade} disabled={status !== "open"}
                  className={btnPrimary() + " disabled:opacity-50"}>
            Upgrade PTY
          </button>
          <button onClick={onClose} className={btnStop()}>Close</button>
        </header>
        <div ref={hostRef} className="flex-1 bg-bg-base p-2 overflow-hidden" />
        <footer className="px-3 py-1.5 border-t border-divider text-[10px] text-ink-dim font-mono">
          transcript at <span className="text-ink-muted">~/network_tools/shells/</span>
          — closing this window does not kill the session
          <span className="ml-2 opacity-0">{transcriptUrl}</span>
        </footer>
      </div>
    </div>
  );
}

// ── shared atoms ──────────────────────────────────────────────────────────────

const inputCls = () =>
  "w-full bg-bg-base border border-divider rounded px-3 py-1.5 text-sm font-mono " +
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
