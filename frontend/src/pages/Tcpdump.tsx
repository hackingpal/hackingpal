import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchTcpdumpInterfaces, fetchTcpdumpStatus,
  installTcpdumpSudoers, openWs,
  type TcpdumpEvent, type TcpdumpStatus,
} from "../api";
import EmptyStateComponent from "../components/EmptyState";
import StatsBar from "../components/StatsBar";
import CopyButton from "../components/CopyButton";
import SetupWizard, { type SetupStep } from "../components/SetupWizard";
import { shouldAutoOpen } from "../lib/setupState";

export default function Tcpdump() {
  const [status,    setStatus]    = useState<TcpdumpStatus | null>(null);
  const [ifaces,    setIfaces]    = useState<string[]>(["any"]);
  const [iface,     setIface]     = useState("en0");
  const [filter,    setFilter]    = useState("");
  const [count,     setCount]     = useState(0);
  const [verbose,   setVerbose]   = useState(false);
  const [resolve,   setResolve]   = useState(false);
  const [running,   setRunning]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [lines,     setLines]     = useState<string[]>([]);
  const [captured,  setCaptured]  = useState(0);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [introDone,  setIntroDone]  = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const autoOpenedRef = useRef(false);

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

  useEffect(() => () => {
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  // Auto-open the SetupWizard the first time we see needs-install state.
  useEffect(() => {
    if (status === null || autoOpenedRef.current) return;
    if (shouldAutoOpen("tcpdump", !status.passwordless)) {
      autoOpenedRef.current = true;
      setWizardOpen(true);
    }
  }, [status]);

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
  const needsUpgrade = status !== null && status.passwordless && !!status.needs_upgrade;

  const wizardSteps = useMemo<SetupStep[]>(() => {
    const passwordless = !!status?.passwordless;
    return [
      {
        id: "intro",
        title: "Why tcpdump needs a one-time admin prompt",
        description: (
          <>
            tcpdump reads raw packets straight off your network interfaces, so
            macOS gates it behind <code className="text-ink-primary">sudo</code>.
            We&apos;ll drop a single passwordless sudoers entry for{" "}
            <code className="text-ink-primary">/usr/sbin/tcpdump</code> —
            no other binaries get root access.
          </>
        ),
        done: introDone || passwordless,
        cta: { label: "I'm ready", onRun: () => setIntroDone(true) },
      },
      {
        id: "install",
        title: "Grant passwordless sudo",
        description: (
          <>
            macOS will pop the standard admin dialog once. Approve it and
            you&apos;ll never see it again for tcpdump.
          </>
        ),
        done: passwordless,
        cta: {
          label: "Install Permission",
          busyLabel: "Installing",
          onRun: async () => {
            await installTcpdumpSudoers();
            await refreshStatus();
          },
        },
      },
    ];
  }, [status, introDone]);

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
            : needsUpgrade
              ? (
                <span className="text-amber">
                  ⚠ LEGACY SUDOERS ENTRY · upgrade to argv-restricted ·{" "}
                  <button
                    onClick={() => setWizardOpen(true)}
                    className="underline decoration-dotted hover:text-accent transition"
                  >
                    Re-install
                  </button>
                </span>
              )
              : status.passwordless
                ? <span className="text-phos">● PASSWORDLESS SUDO READY · {status.user}</span>
                : (
                  <span className="text-amber">
                    ⚠ ADMIN PASSWORD REQUIRED ·{" "}
                    <button
                      onClick={() => setWizardOpen(true)}
                      className="underline decoration-dotted hover:text-accent transition"
                    >
                      Run setup
                    </button>
                  </span>
                )
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

        {needsInstall && !wizardOpen && (
          <div className="border border-amber/50 bg-amber/5 rounded px-4 py-3 mb-4
                          flex items-start gap-3">
            <div className="flex-1">
              <div className="text-amber text-sm font-bold">One-time admin permission</div>
              <div className="text-xs text-ink-muted mt-1 leading-relaxed">
                tcpdump needs passwordless sudo to capture packets. Open the setup
                wizard to walk through it — macOS will prompt for your password once,
                never again.
              </div>
            </div>
            <button onClick={() => setWizardOpen(true)}
                    className={btnPrimary()}>
              Run Setup
            </button>
          </div>
        )}

        {needsUpgrade && !wizardOpen && (
          <div className="border border-amber/50 bg-amber/5 rounded px-4 py-3 mb-4
                          flex items-start gap-3">
            <div className="flex-1">
              <div className="text-amber text-sm font-bold">
                Sudoers entry needs upgrade
              </div>
              <div className="text-xs text-ink-muted mt-1 leading-relaxed">
                Your existing tcpdump sudoers entry is the legacy unrestricted form.
                Re-installing replaces it with an argv-restricted entry that denies
                dangerous flags ({" "}
                <code className="text-ink-primary">-z</code>{" / "}
                <code className="text-ink-primary">-w</code>{" / "}
                <code className="text-ink-primary">--postrotate-command</code>
                {" "}…). One more admin prompt and you&apos;re done.
              </div>
            </div>
            <button onClick={async () => {
                      await installTcpdumpSudoers();
                      await refreshStatus();
                    }}
                    className={btnPrimary()}>
              Re-install
            </button>
          </div>
        )}

        {lines.length === 0 && !running && !error && !needsInstall && (
          <EmptyStateComponent
            icon="📦"
            title="TCPDump"
            description="Capture live packet traffic on a network interface with an optional BPF filter."
            hint="Try filter `tcp port 443` or `icmp` to scope the capture."
          />
        )}

        <SetupWizard
          open={wizardOpen}
          toolKey="tcpdump"
          title="Set Up TCPDump"
          steps={wizardSteps}
          onClose={() => setWizardOpen(false)}
        />

        {lines.length > 0 && (
          <div className="bg-bg-card border border-divider rounded overflow-hidden relative">
            <div className="absolute top-2 right-2 z-10">
              <CopyButton text={lines.join("\n")} alwaysVisible label="Copy all" />
            </div>
            <pre className="font-mono text-[11px] leading-snug whitespace-pre-wrap
                            p-3 text-ink-primary max-h-[calc(100vh-320px)] overflow-auto">
              {lines.map((ln, i) => {
                const lo = ln.toLowerCase();
                let cls = "";
                if (ln.startsWith("$")) cls = "text-ink-dim";
                else if (lo.includes("tcp")) cls = "text-accent";
                else if (lo.includes("udp")) cls = "text-phos";
                else if (lo.includes("icmp")) cls = "text-amber";
                else if (lo.includes("arp"))  cls = "text-amber";
                else if (lo.includes("error") || lo.includes("warning")) cls = "text-danger";
                return (
                  <div
                    key={i}
                    style={{ animationDelay: `${Math.min(i, 12) * 15}ms` }}
                    className={`mhp-result-in ${cls}`}
                  >
                    {ln || " "}
                  </div>
                );
              })}
            </pre>
            <StatsBar
              total={lines.length - (lines[0]?.startsWith("$") ? 1 : 0)}
              running={running}
              extra={captured > 0 ? `${captured} captured` : undefined}
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
