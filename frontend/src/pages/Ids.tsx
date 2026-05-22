import { useMemo, useRef, useState } from "react";
import { openWs, type IdsEvent, type IdsRecord, type IdsSeverity, type IdsSource } from "../api";

const SEV_TEXT: Record<IdsSeverity, string> = {
  info: "text-ink-muted",
  warn: "text-amber",
  high: "text-danger",
};

const SRC_TAG: Record<IdsSource, string> = {
  ports: "text-accent",
  auth:  "text-amber",
};

type Filter = "all" | IdsSource;

export default function IdsPage() {
  const [running,  setRunning]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [events,   setEvents]   = useState<IdsRecord[]>([]);
  const [filter,   setFilter]   = useState<Filter>("all");
  const [baseline, setBaseline] = useState<{ total: number; unknown: number } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const counts = useMemo(() => {
    let info = 0, warn = 0, high = 0;
    for (const ev of events) {
      if (ev.severity === "info") info++;
      else if (ev.severity === "warn") warn++;
      else if (ev.severity === "high") high++;
    }
    return { info, warn, high };
  }, [events]);

  const visible = useMemo(
    () => filter === "all" ? events : events.filter((e) => e.source === filter),
    [events, filter],
  );

  function start() {
    if (running) return;
    setRunning(true); setError(null); setEvents([]); setBaseline(null);

    const ws = openWs("/ws/ids");
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({}));

    ws.onmessage = (e) => {
      const ev = JSON.parse(e.data) as IdsEvent;
      switch (ev.type) {
        case "started":
          setBaseline({ total: ev.baseline, unknown: ev.unknown });
          break;
        case "event":
          setEvents((prev) => [...prev, {
            ts: ev.ts, iso: ev.iso, source: ev.source,
            severity: ev.severity, title: ev.title, detail: ev.detail,
          }]);
          break;
        case "stopped":
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
              Monitoring
            </div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              IDS
            </h2>
          </div>

          {/* Severity counters */}
          <div className="flex items-end gap-5">
            <Counter label="INFO" count={counts.info} tone="text-ink-muted" />
            <Counter label="WARN" count={counts.warn} tone="text-amber" />
            <Counter label="HIGH" count={counts.high} tone="text-danger" />
          </div>

          <div className="flex-1" />

          {/* Filter chips */}
          <div className="flex gap-1 items-end pb-0.5">
            <FilterChip active={filter === "all"}   onClick={() => setFilter("all")}>All</FilterChip>
            <FilterChip active={filter === "ports"} onClick={() => setFilter("ports")}>Ports</FilterChip>
            <FilterChip active={filter === "auth"}  onClick={() => setFilter("auth")}>Auth</FilterChip>
          </div>

          {!running ? (
            <button onClick={start}
                    className="bg-accent hover:bg-accentDim active:translate-y-px
                               text-white text-xs font-bold tracking-wide
                               px-3.5 py-1.5 rounded transition border border-accent/60">
              ▶ Start IDS
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

        <div className="mt-2 text-[10px] tracking-widest text-ink-dim">
          {baseline
            ? `Baseline ${baseline.total} listeners · ${baseline.unknown} not on allowlist · monitoring active`
            : running ? "Capturing baseline…" : "Idle — click Start to begin monitoring"}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono mb-4">
            Error — {error}
          </div>
        )}

        {visible.length === 0 && !running && !error && <EmptyState />}

        {visible.length === 0 && running && (
          <div className="text-ink-dim text-xs font-mono">
            Watching…
          </div>
        )}

        {visible.length > 0 && (
          <section className="border border-divider rounded-md overflow-hidden bg-bg-card">
            <div className="font-mono text-[11px] leading-relaxed">
              {visible.map((ev, i) => (
                <div key={i}
                     className={"grid grid-cols-[72px_64px_64px_1fr] gap-3 px-3 py-1 " +
                                (i % 2 === 0 ? "bg-bg-card" : "bg-bg-row-alt")}>
                  <span className="text-ink-dim">{ev.ts}</span>
                  <span className={SRC_TAG[ev.source]}>[{ev.source.toUpperCase()}]</span>
                  <span className={SEV_TEXT[ev.severity]}>[{ev.severity.toUpperCase()}]</span>
                  <span className="text-ink-primary">
                    <span className="text-ink-primary font-bold">{ev.title}</span>
                    <span className="text-ink-muted"> — {ev.detail}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Counter({ label, count, tone }: { label: string; count: number; tone: string }) {
  return (
    <div>
      <div className="text-[10px] tracking-widest text-ink-dim">{label}</div>
      <div className={"text-base font-bold tabular-nums " + tone}>{count}</div>
    </div>
  );
}

function FilterChip({ active, onClick, children }:
  { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
            className={
              "text-[11px] uppercase tracking-widest px-2.5 py-1 rounded-md border " +
              (active
                ? "bg-accent text-white border-accent"
                : "bg-transparent text-ink-muted border-divider hover:text-ink-primary hover:border-ink-dim")
            }>
      {children}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="h-full min-h-[260px] flex items-center justify-center">
      <div className="text-center">
        <pre className="text-ink-dim text-[11px] leading-tight select-none">
{`        ┌──────────────┐
        │   ●  ●  ●    │
        │   IDS WATCH  │
        └──────────────┘`}
        </pre>
        <div className="mt-4 text-xs text-ink-muted">
          Press <kbd className="px-1.5 py-0.5 rounded bg-bg-card border border-divider
            text-[10px] text-ink-primary">▶ Start IDS</kbd> to monitor listening ports + auth failures
        </div>
        <div className="mt-2 text-[10px] text-ink-dim">
          Port baseline · live diff every 5s · auth-event tail · 10s debounce
        </div>
      </div>
    </div>
  );
}
