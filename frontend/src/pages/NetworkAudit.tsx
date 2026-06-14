import { useEffect, useRef, useState } from "react";
import { openWs, type AuditEvent, type AuditOpenPort, type RiskTier } from "../api";
import SeverityBadge, { type Severity } from "../components/SeverityBadge";
import StatsBar from "../components/StatsBar";
import EmptyStateComponent from "../components/EmptyState";
import CopyButton from "../components/CopyButton";
import { useCriticalPulseSet } from "../lib/useCriticalPulse";

type Row = {
  ip: string; hostname: string; isSelf: boolean;
  openRisky: AuditOpenPort[]; risk: RiskTier;
};

const RISK_ORDER: Record<RiskTier, number> = {
  critical: 0, high: 1, medium: 2, low: 3, clean: 4,
};

function riskToSeverity(r: RiskTier): Severity {
  if (r === "critical") return "critical";
  if (r === "high") return "high";
  if (r === "medium") return "medium";
  if (r === "low") return "low";
  return "info";
}

export default function NetworkAudit() {
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [phase,   setPhase]   = useState<"discovery" | "audit" | null>(null);
  const [pct,     setPct]     = useState(0);
  const [label,   setLabel]   = useState("");
  const [rows,    setRows]    = useState<Row[]>([]);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [targetHost, setTargetHost] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  const pulsing = useCriticalPulseSet(
    rows,
    (r) => r.ip,
    (r) => r.risk === "critical",
  );

  useEffect(() => () => {
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  function start() {
    if (running) return;
    setRunning(true); setStopped(false); setError(null);
    setPhase(null); setPct(0); setLabel(""); setRows([]); setElapsed(null);
    setStartedAt(Date.now());

    const trimmedTarget = targetHost.trim();
    const ws = openWs("/ws/audit");
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify(
      trimmedTarget ? { target_host: trimmedTarget } : {},
    ));

    ws.onmessage = (e) => {
      const ev = JSON.parse(e.data) as AuditEvent;
      switch (ev.type) {
        case "started":
          break;
        case "phase":
          setPhase(ev.phase);
          break;
        case "progress":
          setPct(ev.pct); setLabel(ev.label);
          break;
        case "host":
          setRows((r) => [
            ...r,
            { ip: ev.ip, hostname: ev.hostname, isSelf: ev.is_self,
              openRisky: ev.open_risky, risk: ev.risk_level },
          ].sort((a, b) =>
            RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || a.ip.localeCompare(b.ip)));
          break;
        case "done":
          setElapsed(ev.elapsed); setStopped(ev.stopped);
          setRunning(false); ws.close();
          break;
        case "error":
          setError(ev.detail); setRunning(false); ws.close();
          break;
      }
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
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">
              Recon
            </div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              Network Audit
            </h2>
          </div>
          <div className="flex-1 text-xs text-ink-muted">
            Discovers live hosts on your subnet and checks each for insecure
            open ports (FTP, Telnet, SMB, RDP, etc.).
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] uppercase tracking-[0.2em] text-ink-dim mb-1">
              Target host (optional)
            </label>
            <input
              type="text"
              value={targetHost}
              onChange={(e) => setTargetHost(e.target.value)}
              disabled={running}
              placeholder="e.g. 127.0.0.1"
              className="bg-bg-card border border-divider rounded px-2 py-1
                         text-xs font-mono text-ink-primary placeholder:text-ink-dim
                         focus:border-accent focus:outline-none w-48
                         disabled:opacity-50"
            />
            {targetHost.trim() && (
              <div className="mt-1 text-[10px] text-amber font-mono">
                Discovery skipped — auditing this host only
              </div>
            )}
          </div>
          {!running ? (
            <button onClick={start}
                    className="bg-accent hover:bg-accentDim active:translate-y-px
                               text-white text-xs font-bold tracking-wide
                               px-3.5 py-1.5 rounded transition border border-accent/60">
              ▶ Start Audit
            </button>
          ) : (
            <button onClick={stop}
                    className="bg-danger/10 hover:bg-danger/20 active:translate-y-px
                               text-danger text-xs font-bold tracking-wide
                               px-3.5 py-1.5 rounded transition border border-danger/60">
              ■ Stop
            </button>
          )}
        </div>

        {(running || elapsed !== null) && (
          <div className="mt-3 space-y-1">
            <div className="h-1 rounded bg-bg-card overflow-hidden">
              <div className="h-full bg-accent transition-[width] duration-100"
                   style={{ width: `${Math.min(100, Math.round(pct * 100))}%` }} />
            </div>
            <div className="flex justify-between text-[10px] tracking-widest text-ink-dim font-mono">
              <span>
                {phase ? phase.toUpperCase() : "—"}
                {" · "}
                {label}
              </span>
              <span>
                {Math.round(pct * 100)}% · {rows.length} hosts audited
                {elapsed !== null && ` · ${elapsed}s`}
                {stopped && " · STOPPED"}
              </span>
            </div>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-auto p-6">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono mb-4">
            Error — {error}
          </div>
        )}

        {rows.length === 0 && !running && !error && (
          <EmptyStateComponent
            icon="🛡️"
            title="Network Audit"
            description="Discovers live hosts on your subnet and checks each for insecure open ports (FTP, Telnet, SMB, RDP, etc.)."
            hint={<>Phase 1: discover live hosts · Phase 2: probe 18 risky ports per host</>}
          />
        )}

        {(rows.length > 0 || running) && (
          <section className="border border-divider rounded-md overflow-hidden bg-bg-card">
            <div className="grid grid-cols-[140px_1fr_240px_120px_60px] gap-3 px-3 py-1.5
                            bg-bg-panel border-b border-divider text-[10px]
                            uppercase tracking-[0.2em] text-ink-dim">
              <span>IP Address</span><span>Hostname</span>
              <span>Risky Ports</span><span>Risk Level</span><span></span>
            </div>
            <div className="font-mono text-xs">
              {rows.map((r, i) => {
                const pulse = pulsing.has(r.ip) ? " mhp-critical-pulse" : "";
                const sev = riskToSeverity(r.risk);
                const copyText = `${r.ip}\t${r.hostname || ""}\t${r.openRisky.map((p) => `${p.port}/${p.service}`).join(",")}\t${r.risk}`;
                return (
                  <div key={r.ip}
                       style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                       className={"group grid grid-cols-[140px_1fr_240px_120px_60px] gap-3 px-3 py-1 items-start mhp-result-in" +
                                  (r.isSelf ? " bg-accent/10" : i % 2 === 0 ? " bg-bg-card" : " bg-bg-row-alt") + pulse}>
                    <span className={r.isSelf ? "text-accent" : "text-ink-primary"}>
                      {r.ip}{r.isSelf && <span className="ml-1">★</span>}
                    </span>
                    <span className="text-ink-muted truncate">{r.hostname || "—"}</span>
                    <span className="text-ink-primary text-[11px]">
                      {r.openRisky.length === 0
                        ? <span className="text-ink-dim">none</span>
                        : r.openRisky.map((p) =>
                            `${p.port}/${p.service}`).join(", ")}
                    </span>
                    <span>
                      {r.risk === "clean"
                        ? <span className="text-phos text-[11px] font-bold uppercase tracking-wider">● Clean</span>
                        : <SeverityBadge severity={sev} />}
                    </span>
                    <span className="flex justify-end">
                      <CopyButton text={copyText} />
                    </span>
                  </div>
                );
              })}
            </div>
            <StatsBar
              total={rows.length}
              critical={rows.filter((r) => r.risk === "critical").length}
              high={rows.filter((r) => r.risk === "high").length}
              medium={rows.filter((r) => r.risk === "medium").length}
              low={rows.filter((r) => r.risk === "low").length}
              elapsed={elapsed ?? undefined}
              startedAt={startedAt}
              running={running}
              extra={stopped ? "stopped" : undefined}
            />
          </section>
        )}
      </div>
    </div>
  );
}
