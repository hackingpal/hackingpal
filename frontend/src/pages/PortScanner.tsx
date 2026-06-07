import { useEffect, useRef, useState } from "react";
import { openWs, watchWsLiveness, type ScanEvent, type ScanInit } from "../api";
import ScopeBanner from "../components/ScopeBanner";
import { useActiveEngagementId } from "../lib/engagement";
import EmptyStateComponent from "../components/EmptyState";
import StatsBar from "../components/StatsBar";
import CopyButton from "../components/CopyButton";

type OpenRow = { port: number; service: string; banner: string };

const PRESETS: { label: string; spec: string; hint: string }[] = [
  { label: "Top 100",  hint: "Most-scanned 100 TCP ports",
    spec: "7,9,13,21-23,25-26,37,53,79-81,88,106,110-111,113,119,135,139,143-144,179,199,389,427,443-445,465,513-515,543-544,548,554,587,631,646,873,990,993,995,1025-1029,1110,1433,1720,1723,1755,1900,2000-2001,2049,2121,2717,3000,3128,3306,3389,3986,4899,5000,5009,5051,5060,5101,5190,5357,5432,5631,5666,5800,5900,6000-6001,6646,7070,8000,8008-8009,8080-8081,8443,8888,9100,9999-10000,32768,49152-49157" },
  { label: "1-1024",   hint: "All well-known ports",            spec: "1-1024" },
  { label: "Web",      hint: "HTTP/HTTPS + alternates",         spec: "80,443,3000,8000,8008,8080,8081,8443,8888" },
  { label: "DB",       hint: "Common database ports",           spec: "1433,1521,3306,5432,6379,9042,9200,11211,27017" },
  { label: "SMB/Win",  hint: "Windows / SMB services",          spec: "135,137,139,445,3389,5985,5986" },
  { label: "All",      hint: "Every TCP port (slow)",           spec: "1-65535" },
];

export default function PortScanner() {
  const engagementId = useActiveEngagementId();
  const [target,  setTarget]  = useState("127.0.0.1");
  const [ports,   setPorts]   = useState("1-1024");
  const [threads, setThreads] = useState(100);
  const [timeout, setTimeout] = useState(1.0);
  // Sticky bit so a user who accepted a warn-level scope verdict and clicked
  // Scan again doesn't have to re-confirm every retry of the same target.
  const [scopeConfirmed, setScopeConfirmed] = useState(false);
  // Surfaced when the backend rejected the handshake with NEED_CONFIRM —
  // shows a "Confirm & rescan" button that retries with confirm=true.
  const [needConfirm, setNeedConfirm] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [stopped,  setStopped]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState<null | "connect" | "idle">(null);
  const [meta,     setMeta]     = useState<{ target: string; ip: string; total: number } | null>(null);
  const [done,     setDone]     = useState(0);
  const [total,    setTotal]    = useState(0);
  const [elapsed,  setElapsed]  = useState<number | null>(null);
  const [rows,     setRows]     = useState<OpenRow[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const watchRef = useRef<ReturnType<typeof watchWsLiveness> | null>(null);

  // If the user navigates away mid-scan, close the socket so the backend
  // stops pumping packets at a phantom listener.
  useEffect(() => () => {
    watchRef.current?.stop();
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  function start() {
    if (scanning) return;
    setScanning(true); setStopped(false); setError(null); setTimedOut(null);
    setNeedConfirm(false);
    setMeta(null); setDone(0); setTotal(0); setElapsed(null); setRows([]);

    const ws = openWs("/ws/port-scan");
    wsRef.current = ws;

    // Liveness watch: surface a distinct "timed out" state if the WS never
    // opens (connect) or stops sending frames (idle). 60s idle is generous
    // for a long port scan; the page already throttles progress to ~30/s.
    watchRef.current = watchWsLiveness(ws, {
      connectMs: 5_000,
      idleMs:    60_000,
      onTimeout: (phase) => {
        setTimedOut(phase);
        setScanning(false);
        try { ws.close(); } catch { /* ignore */ }
      },
    });

    ws.onopen = () => {
      // engagement_id (when set) drives the backend scope check; `confirm`
      // is set after the user acknowledges a warn-level verdict.
      const init: ScanInit & { engagement_id?: string; confirm?: boolean } = {
        target, ports, timeout, threads,
        engagement_id: engagementId ?? undefined,
        confirm: scopeConfirmed,
      };
      ws.send(JSON.stringify(init));
    };

    ws.onmessage = (e) => {
      watchRef.current?.touch();
      const ev = JSON.parse(e.data) as ScanEvent;
      switch (ev.type) {
        case "started":
          setMeta({ target: ev.target, ip: ev.ip, total: ev.total });
          setTotal(ev.total);
          break;
        case "open":
          setRows((r) => [...r, { port: ev.port, service: ev.service, banner: ev.banner }]
            .sort((a, b) => a.port - b.port));
          break;
        case "progress":
          setDone(ev.done); setTotal(ev.total);
          break;
        case "done":
          setElapsed(ev.elapsed);
          setStopped(ev.stopped);
          setScanning(false);
          watchRef.current?.stop();
          ws.close();
          break;
        case "scope":
          // Informational — ScopeBanner already shows the verdict from
          // the preview endpoint. We just clear stale state.
          break;
        case "error":
          setError(ev.detail);
          if (ev.code === "NEED_CONFIRM") setNeedConfirm(true);
          setScanning(false);
          watchRef.current?.stop();
          ws.close();
          break;
      }
    };

    ws.onerror = () => {
      setError("WebSocket error — is the backend running?");
      setScanning(false);
      watchRef.current?.stop();
    };
    ws.onclose = () => {
      watchRef.current?.stop();
      if (scanning) setScanning(false);
    };
  }

  function stop() {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: "stop" }));
    }
  }

  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <div className="h-full flex flex-col">
      {/* Page header — controls */}
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">
              Recon
            </div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              Port Scanner
            </h2>
          </div>

          <div className="flex-1 grid grid-cols-[1fr_140px_72px_72px_auto] gap-2 items-center">
            <Field label="Target">
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") start(); }}
                disabled={scanning}
                placeholder="IP or hostname"
                className="w-full bg-bg-card border border-divider rounded
                           px-3 py-1.5 text-sm font-mono text-ink-primary
                           placeholder:text-ink-dim
                           focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
                           disabled:opacity-60"
              />
            </Field>
            <Field label="Ports">
              <input
                value={ports}
                onChange={(e) => setPorts(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") start(); }}
                disabled={scanning}
                placeholder="1-1024"
                className="w-full bg-bg-card border border-divider rounded
                           px-3 py-1.5 text-sm font-mono text-ink-primary
                           placeholder:text-ink-dim
                           focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
                           disabled:opacity-60"
              />
            </Field>
            <Field label="Threads">
              <input
                type="number" min={1} max={1024}
                value={threads}
                onChange={(e) => setThreads(parseInt(e.target.value, 10) || 1)}
                disabled={scanning}
                className="w-full bg-bg-card border border-divider rounded
                           px-2 py-1.5 text-sm font-mono text-ink-primary
                           focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
                           disabled:opacity-60"
              />
            </Field>
            <Field label="Timeout">
              <input
                type="number" step="0.1" min={0.1} max={30}
                value={timeout}
                onChange={(e) => setTimeout(parseFloat(e.target.value) || 1.0)}
                disabled={scanning}
                className="w-full bg-bg-card border border-divider rounded
                           px-2 py-1.5 text-sm font-mono text-ink-primary
                           focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
                           disabled:opacity-60"
              />
            </Field>
            <div className="flex gap-2 pt-4">
              {!scanning ? (
                <button
                  onClick={start}
                  className="bg-accent hover:bg-accentDim active:translate-y-px
                             text-white text-xs font-bold tracking-wide
                             px-3.5 py-1.5 rounded transition border border-accent/60"
                >
                  ▶ Scan
                </button>
              ) : (
                <button
                  onClick={stop}
                  className="bg-danger/10 hover:bg-danger/20 active:translate-y-px
                             text-danger text-xs font-bold tracking-wide
                             px-3.5 py-1.5 rounded transition border border-danger/60"
                >
                  ■ Stop
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Scope verdict — informs the user before scan whether the target
            is in their engagement scope (or external in Lab mode). */}
        <div className="mt-2">
          <ScopeBanner target={target} />
        </div>

        {/* Presets */}
        <div className="mt-2 flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] uppercase tracking-widest text-ink-dim mr-1">
            Presets
          </span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => { if (!scanning) setPorts(p.spec); }}
              disabled={scanning}
              title={p.hint + " — " + (p.spec.length > 60 ? p.spec.slice(0, 60) + "…" : p.spec)}
              className={
                "text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border transition " +
                "disabled:opacity-50 disabled:cursor-not-allowed " +
                (ports === p.spec
                  ? "bg-accent/20 text-accent border-accent/40"
                  : "bg-bg-card text-ink-dim hover:text-ink-primary border-divider hover:border-accent/40")
              }
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Progress bar + status line */}
        {(scanning || elapsed !== null) && (
          <div className="mt-3 space-y-1">
            <div className="h-1 rounded bg-bg-card overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-100"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] tracking-widest text-ink-dim font-mono">
              <span>
                {meta ? `${meta.target} · ${meta.ip}` : "—"}
              </span>
              <span>
                {done}/{total} · {pct}% · {rows.length} open
                {elapsed !== null && ` · ${elapsed}s`}
                {stopped && " · STOPPED"}
              </span>
            </div>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-auto p-6">
        {timedOut && (
          <div className="border border-amber/40 bg-amber/10 text-amber
                          rounded px-3 py-2 text-sm font-mono mb-4 flex items-center gap-3">
            <span>⏱</span>
            <div className="flex-1">
              <div className="font-bold">
                {timedOut === "connect" ? "Backend not responding" : "Scan stalled"}
              </div>
              <div className="text-[11px] text-ink-muted">
                {timedOut === "connect"
                  ? "WebSocket failed to open within 5 seconds — is the sidecar running?"
                  : "No progress for 60 seconds. The scan was stopped."}
              </div>
            </div>
            <button
              onClick={start}
              className="text-[10px] uppercase tracking-widest px-2 py-1 rounded border
                         border-amber/40 text-amber hover:bg-amber/10 transition"
            >
              Retry
            </button>
          </div>
        )}

        {error && !timedOut && (
          <div className={"rounded px-3 py-2 text-sm font-mono mb-4 border " +
            (needConfirm
              ? "border-amber/40 bg-amber/10 text-amber"
              : "border-danger/40 bg-danger/10 text-danger")}>
            <div>{needConfirm ? "Confirm required" : "Error"} — {error}</div>
            {needConfirm && (
              <button
                onClick={() => {
                  setScopeConfirmed(true);
                  setNeedConfirm(false);
                  setError(null);
                  start();
                }}
                className="mt-2 text-[10px] uppercase tracking-widest px-2 py-0.5 rounded
                           border border-amber/60 bg-amber/20 hover:bg-amber/30">
                Confirm &amp; rescan
              </button>
            )}
          </div>
        )}

        {!error && !timedOut && rows.length === 0 && !scanning && elapsed === null && (
          <EmptyStateComponent
            icon="🔌"
            title="Port Scanner"
            description="Threaded TCP connect scan with service detection and banner grab."
            exampleTarget="scanme.nmap.org"
            onExample={setTarget}
            hint="Set port range above and press ▶ Scan."
          />
        )}

        {(rows.length > 0 || scanning) && (
          <>
            {rows.length > 0 && <ExportBar rows={rows} target={meta?.target ?? target} />}
            <ResultsTable
              rows={rows}
              scanning={scanning}
              elapsed={elapsed}
              stopped={stopped}
              done={done}
              total={total}
            />
          </>
        )}

        {!scanning && elapsed !== null && rows.length === 0 && !error && (
          <div className="text-ink-dim text-xs font-mono">
            No open ports — scanned {total} ports in {elapsed}s.
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest text-ink-dim block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function ResultsTable({
  rows, scanning, elapsed, stopped, done, total,
}: {
  rows: OpenRow[];
  scanning: boolean;
  elapsed: number | null;
  stopped: boolean;
  done: number;
  total: number;
}) {
  return (
    <section className="border border-divider rounded-md overflow-hidden bg-bg-card">
      <div className="grid grid-cols-[70px_60px_140px_1fr_60px] gap-3 px-3 py-1.5
                      bg-bg-panel border-b border-divider text-[10px]
                      uppercase tracking-[0.2em] text-ink-dim">
        <span>Port</span>
        <span>State</span>
        <span>Service</span>
        <span>Banner</span>
        <span></span>
      </div>
      <div className="font-mono text-xs">
        {rows.map((r, i) => (
          <div
            key={r.port}
            style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
            className={
              "group grid grid-cols-[70px_60px_140px_1fr_60px] gap-3 px-3 py-1 mhp-result-in " +
              (i % 2 === 0 ? "bg-bg-card" : "bg-bg-row-alt")
            }
          >
            <span className="text-ink-primary tabular-nums">{r.port}</span>
            <span className="text-phos">open</span>
            <span className="text-ink-muted">{r.service || "—"}</span>
            <span className="text-ink-primary truncate">{r.banner || "—"}</span>
            <span className="flex justify-end">
              <CopyButton text={`${r.port}/${r.service}\t${r.banner}`} />
            </span>
          </div>
        ))}
      </div>
      <StatsBar
        total={rows.length}
        elapsed={elapsed ?? undefined}
        running={scanning}
        extra={
          stopped
            ? "stopped"
            : total > 0
              ? `${done}/${total} probed`
              : undefined
        }
      />
    </section>
  );
}

function csvEscape(v: string): string {
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function downloadFile(name: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40) || "scan";
}

function ExportBar({ rows, target }: { rows: OpenRow[]; target: string }) {
  const [copied, setCopied] = useState<string | null>(null);

  function flash(label: string) {
    setCopied(label);
    window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1200);
  }

  async function copyPortList() {
    const text = rows.map((r) => r.port).join(",");
    try { await navigator.clipboard.writeText(text); flash("ports"); } catch { /* ignore */ }
  }

  async function copyJson() {
    const text = JSON.stringify(rows, null, 2);
    try { await navigator.clipboard.writeText(text); flash("json"); } catch { /* ignore */ }
  }

  function downloadCsv() {
    const lines = ["port,service,banner"];
    for (const r of rows) {
      lines.push([r.port, csvEscape(r.service), csvEscape(r.banner)].join(","));
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadFile(`portscan_${safeName(target)}_${stamp}.csv`, "text/csv", lines.join("\n") + "\n");
  }

  function downloadJson() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const payload = { target, scanned_at: new Date().toISOString(), open_ports: rows };
    downloadFile(`portscan_${safeName(target)}_${stamp}.json`, "application/json",
      JSON.stringify(payload, null, 2));
  }

  const btn =
    "text-[10px] uppercase tracking-widest px-2 py-1 rounded border " +
    "bg-bg-card text-ink-dim hover:text-ink-primary border-divider hover:border-accent/40 " +
    "transition";

  return (
    <div className="mb-3 flex flex-wrap gap-1.5 items-center">
      <span className="text-[10px] uppercase tracking-widest text-ink-dim mr-1">
        Export
      </span>
      <button onClick={copyPortList} className={btn}>
        {copied === "ports" ? "✓ Copied" : "Copy ports"}
      </button>
      <button onClick={copyJson} className={btn}>
        {copied === "json" ? "✓ Copied" : "Copy JSON"}
      </button>
      <button onClick={downloadCsv} className={btn}>↓ CSV</button>
      <button onClick={downloadJson} className={btn}>↓ JSON</button>
    </div>
  );
}

