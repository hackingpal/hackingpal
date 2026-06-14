import { useEffect, useRef, useState } from "react";
import { openWs, watchWsLiveness, type HttpProbeEvent, type HttpProbeFinding } from "../api";
import { useLabIntent } from "../lib/labIntent";
import EmptyStateComponent from "../components/EmptyState";
import StatsBar from "../components/StatsBar";
import CopyButton from "../components/CopyButton";

type Hit = { path: string; status: number; length: number; location: string; spa_fallback?: boolean };

const SEV: Record<string, { text: string; dot: string }> = {
  info: { text: "text-ink-muted", dot: "bg-ink-dim" },
  warn: { text: "text-amber",     dot: "bg-amber"   },
  high: { text: "text-danger",    dot: "bg-danger"  },
};

function statusColor(s: number): string {
  if (s >= 500) return "text-amber";
  if (s === 401 || s === 403) return "text-amber";
  if (s >= 400) return "text-ink-muted";
  if (s >= 300) return "text-accent";
  if (s >= 200) return "text-phos";
  return "text-ink-dim";
}

export default function HttpProbe() {
  const intent = useLabIntent("http");
  const [url, setUrl] = useState(intent?.target ?? "https://example.com");
  const [wordlist, setWordlist] = useState<"small" | "medium">("small");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState<null | "connect" | "idle">(null);
  const [confirmReason, setConfirmReason] = useState<string | null>(null);

  const [started, setStarted] = useState<{
    base: string; methods_allowed: string[]; wordlist_size: number;
    headers: Record<string, string>;
    spa_fallback: { status: number; length: number } | null;
  } | null>(null);
  const [findings, setFindings] = useState<HttpProbeFinding[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [elapsed, setElapsed] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const watchRef = useRef<ReturnType<typeof watchWsLiveness> | null>(null);

  useEffect(() => () => {
    watchRef.current?.stop();
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  function start(confirm = false) {
    const u = url.trim();
    if (!u) return;
    setRunning(true);
    setError(null);
    setTimedOut(null);
    setConfirmReason(null);
    setStarted(null); setFindings([]); setHits([]);
    setProgress({ done: 0, total: 0 }); setElapsed(null);

    const ws = openWs("/ws/http-probe");
    wsRef.current = ws;
    watchRef.current = watchWsLiveness(ws, {
      connectMs: 5_000,
      idleMs:    45_000,
      onTimeout: (phase) => {
        setTimedOut(phase);
        setRunning(false);
        try { ws.close(); } catch { /* ignore */ }
      },
    });
    ws.onopen = () => ws.send(JSON.stringify({ url: u, wordlist, confirm }));
    ws.onmessage = (msg) => {
      watchRef.current?.touch();
      const ev = JSON.parse(msg.data) as HttpProbeEvent;
      if (ev.type === "started") {
        setStarted({
          base: ev.base,
          methods_allowed: ev.methods_allowed,
          wordlist_size: ev.wordlist_size,
          headers: ev.headers,
          spa_fallback: ev.spa_fallback,
        });
        setProgress({ done: 0, total: ev.wordlist_size });
      } else if (ev.type === "finding") {
        setFindings((f) => [...f, { severity: ev.severity, label: ev.label, detail: ev.detail }]);
      } else if (ev.type === "hit") {
        setHits((h) => [...h, {
          path: ev.path, status: ev.status, length: ev.length,
          location: ev.location, spa_fallback: ev.spa_fallback,
        }]);
      } else if (ev.type === "progress") {
        setProgress({ done: ev.done, total: ev.total });
      } else if (ev.type === "done") {
        setElapsed(ev.elapsed); setRunning(false); watchRef.current?.stop();
      } else if (ev.type === "error") {
        if (ev.need_confirm) setConfirmReason(ev.detail.replace("need_confirm: ", ""));
        else setError(ev.detail);
        setRunning(false); watchRef.current?.stop();
      }
    };
    ws.onerror = () => { setError("WebSocket error"); setRunning(false); watchRef.current?.stop(); };
    ws.onclose  = () => { setRunning(false); watchRef.current?.stop(); };
  }

  function stop() {
    wsRef.current?.send(JSON.stringify({ action: "stop" }));
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3 flex flex-col gap-2">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Recon</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              HTTP Probe
            </h2>
          </div>

          <div className="flex rounded overflow-hidden border border-divider shrink-0">
            {(["small", "medium"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setWordlist(k)}
                className={
                  "px-2 py-1 text-[10px] uppercase tracking-[0.2em] border transition " +
                  (wordlist === k
                    ? "bg-accent/20 text-accent border-accent/40"
                    : "bg-bg-card text-ink-dim hover:text-ink-primary border-transparent")
                }
              >
                {k}
              </button>
            ))}
          </div>

          <div className="flex-1 flex gap-2 items-center max-w-2xl">
            <span className="text-ink-dim text-sm select-none">›</span>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") start(); }}
              placeholder="https://target.example.com"
              className="flex-1 bg-bg-card border border-divider rounded
                         px-3 py-1.5 text-sm font-mono text-ink-primary
                         placeholder:text-ink-dim
                         focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
                         transition"
              autoCorrect="off"
              spellCheck={false}
            />
            {running ? (
              <button
                onClick={stop}
                className="bg-danger/80 hover:bg-danger active:translate-y-px
                           text-white text-xs font-bold tracking-wide
                           px-3.5 py-1.5 rounded transition
                           border border-danger/60"
              >
                ◼ Stop
              </button>
            ) : (
              <button
                onClick={() => start()}
                className="bg-accent hover:bg-accentDim active:translate-y-px
                           text-white text-xs font-bold tracking-wide
                           px-3.5 py-1.5 rounded transition
                           border border-accent/60"
              >
                ▶ Probe
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {confirmReason && (
          <ConfirmBanner
            reason={confirmReason}
            url={url}
            onCancel={() => setConfirmReason(null)}
            onConfirm={() => { setConfirmReason(null); start(true); }}
          />
        )}

        {timedOut && (
          <div className="border border-amber/40 bg-amber/10 text-amber
                          rounded px-3 py-2 text-sm font-mono flex items-center gap-3">
            <span>⏱</span>
            <div className="flex-1">
              <div className="font-bold">
                {timedOut === "connect" ? "Backend not responding" : "Probe stalled"}
              </div>
              <div className="text-[11px] text-ink-muted">
                {timedOut === "connect"
                  ? "WebSocket failed to open within 5 seconds."
                  : "No progress for 45 seconds. The probe was stopped."}
              </div>
            </div>
            <button
              onClick={() => start(false)}
              className="text-[10px] uppercase tracking-widest px-2 py-1 rounded border
                         border-amber/40 text-amber hover:bg-amber/10 transition"
            >
              Retry
            </button>
          </div>
        )}

        {error && !timedOut && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">
            Error — {error}
          </div>
        )}

        {!started && !error && !timedOut && !confirmReason && !running && (
          <EmptyStateComponent
            icon="🌐"
            title="HTTP Probe"
            description="Path fuzz · method enum · header audit · sensitive-file detection"
            exampleTarget="https://example.com"
            onExample={setUrl}
          />
        )}

        {started && (
          <>
            <Card title="Target">
              <Row k="Base"            v={started.base} />
              <Row k="Methods Allowed" v={
                started.methods_allowed.length === 0
                  ? <span className="text-ink-dim">(none reported)</span>
                  : started.methods_allowed.join(", ")
              }/>
            </Card>

            {Object.keys(started.headers).length > 0 && (
              <Card title="Security headers">
                {Object.entries(started.headers).map(([k, v]) => (
                  <Row key={k} k={k} v={v} />
                ))}
              </Card>
            )}

            <Card title="Progress">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 rounded bg-bg-base border border-divider overflow-hidden">
                  <div
                    className={"h-full transition-all " + (running ? "bg-accent" : "bg-phos")}
                    style={{ width: progress.total > 0
                      ? `${Math.round((progress.done / progress.total) * 100)}%`
                      : "0%" }}
                  />
                </div>
                <span className="text-ink-dim text-[11px] w-20 text-right">
                  {progress.done}/{progress.total}
                </span>
                <span className="text-phos text-[11px] w-14 text-right">
                  {hits.length} hits
                </span>
                {elapsed != null && (
                  <span className="text-ink-dim text-[11px] w-16 text-right">
                    {elapsed.toFixed(1)}s
                  </span>
                )}
              </div>
            </Card>

            {findings.length > 0 && (
              <Card title={`Findings · ${findings.length}`}>
                <ul className="space-y-1">
                  {findings.map((f, i) => {
                    const sev = SEV[f.severity] ?? SEV.info;
                    return (
                      <li
                        key={i}
                        style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                        className="group flex items-start gap-2 mhp-result-in"
                      >
                        <span className={"inline-block w-2 h-2 rounded-full mt-1.5 " + sev.dot} />
                        <span className={"text-[10px] uppercase tracking-widest " + sev.text}>
                          {f.severity}
                        </span>
                        <span className="text-ink-primary flex-1">{f.label}</span>
                        <span className="text-ink-muted">{f.detail}</span>
                        <CopyButton text={`[${f.severity}] ${f.label} — ${f.detail}`} />
                      </li>
                    );
                  })}
                </ul>
                <StatsBar
                  total={findings.length}
                  high={findings.filter((f) => f.severity === "high").length}
                  medium={findings.filter((f) => f.severity === "warn").length}
                  className="mt-2 -mx-3 -mb-3"
                />
              </Card>
            )}

            <Card title={`Hits · ${hits.length}`}>
              {hits.length === 0 ? (
                <div className="text-ink-dim">
                  {running ? "Probing…" : "No interesting responses."}
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className="grid grid-cols-[60px_1fr_60px_2fr_auto] gap-x-3">
                    <span className="text-ink-dim text-[10px] uppercase tracking-wider">Status</span>
                    <span className="text-ink-dim text-[10px] uppercase tracking-wider">Path</span>
                    <span className="text-ink-dim text-[10px] uppercase tracking-wider text-right">Len</span>
                    <span className="text-ink-dim text-[10px] uppercase tracking-wider">Location</span>
                    <span />
                  </div>
                  {hits.map((h, i) => (
                    <div
                      key={i}
                      style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                      className={
                        "group grid grid-cols-[60px_1fr_60px_2fr_auto] gap-x-3 items-center mhp-result-in " +
                        (h.spa_fallback ? "opacity-60" : "")
                      }
                      title={h.spa_fallback ? "SPA fallback — server returned the catch-all index page" : undefined}
                    >
                      <span className={statusColor(h.status)}>{h.status}</span>
                      <span className="text-ink-primary break-all">
                        {h.path}
                        {h.spa_fallback && (
                          <span className="ml-2 text-[9px] uppercase tracking-wider text-ink-dim border border-divider rounded px-1 py-0.5 align-middle">
                            spa
                          </span>
                        )}
                      </span>
                      <span className="text-ink-muted text-right">{h.length}</span>
                      <span className="text-ink-muted break-all">{h.location || "—"}</span>
                      <CopyButton text={`${h.status} ${h.path}${h.location ? ` → ${h.location}` : ""}`} />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function ConfirmBanner({
  reason, url, onCancel, onConfirm,
}: { reason: string; url: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="rounded-md border-l-4 border-amber/40 border-y border-r border-divider
                    bg-amber/5 px-4 py-3 flex items-start gap-3">
      <span className="text-amber text-lg leading-none">⚠</span>
      <div className="flex-1">
        <div className="text-[10px] uppercase tracking-[0.25em] text-amber">
          External target
        </div>
        <div className="mt-1 text-sm font-mono text-ink-primary">
          About to probe <span className="text-amber">{url}</span> — {reason}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="text-[11px] font-bold tracking-wide px-3 py-1.5 rounded
                     bg-bg-card border border-divider text-ink-dim
                     hover:text-ink-primary transition"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="text-[11px] font-bold tracking-wide px-3 py-1.5 rounded
                     bg-amber/20 border border-amber/40 text-amber
                     hover:bg-amber/30 transition"
        >
          ▶ Proceed
        </button>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md overflow-hidden border border-divider">
      <header className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]
                         text-ink-dim border-b border-divider bg-bg-panel">
        {title}
      </header>
      <div className="bg-bg-card p-3 text-xs font-mono">{children}</div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-0.5">
      <span className="w-36 shrink-0 text-ink-dim break-all">{k}</span>
      <span className="text-ink-primary break-all">{v}</span>
    </div>
  );
}
