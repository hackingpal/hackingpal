import { useEffect, useRef, useState } from "react";
import {
  fetchDnsRecon, isApiError, openWs, watchWsLiveness,
  type DnsReport, type DnsReconEvent,
} from "../api";

type Mode = "quick" | "enum";

type EnumHit = { subdomain: string; ip: string };

const SEV: Record<string, { text: string; dot: string; border: string; bg: string }> = {
  info: { text: "text-ink-muted", dot: "bg-ink-dim", border: "border-divider",     bg: "bg-bg-card" },
  warn: { text: "text-amber",     dot: "bg-amber",   border: "border-amber/40",    bg: "bg-amber/5" },
  high: { text: "text-danger",    dot: "bg-danger",  border: "border-danger/40",   bg: "bg-danger/5" },
};

export default function DnsRecon() {
  const [mode, setMode] = useState<Mode>("quick");
  const [domain, setDomain] = useState("example.com");
  const [wordlist, setWordlist] = useState<"small" | "medium">("small");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState<null | "connect" | "idle" | "http">(null);
  const [confirmReason, setConfirmReason] = useState<string | null>(null);

  const [report, setReport] = useState<DnsReport | null>(null);

  // Enum state
  const [enumState, setEnumState] = useState<{
    running: boolean;
    started: { ns: string[]; wordlist_size: number } | null;
    hits: EnumHit[];
    done: number; total: number; elapsed?: number;
  }>({ running: false, started: null, hits: [], done: 0, total: 0 });

  const wsRef = useRef<WebSocket | null>(null);
  const watchRef = useRef<ReturnType<typeof watchWsLiveness> | null>(null);

  useEffect(() => () => {
    watchRef.current?.stop();
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  async function runQuick(confirm = false) {
    const t = domain.trim();
    if (!t) return;
    setBusy(true);
    setError(null);
    setTimedOut(null);
    setConfirmReason(null);
    setReport(null);
    try {
      const r = await fetchDnsRecon(t, confirm);
      if ("needConfirm" in r) {
        setConfirmReason(r.reason);
      } else {
        setReport(r);
      }
    } catch (e) {
      if (isApiError(e, "TIMEOUT")) setTimedOut("http");
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function runEnum(confirm = false) {
    const t = domain.trim();
    if (!t) return;
    setBusy(true);
    setError(null);
    setTimedOut(null);
    setConfirmReason(null);
    setEnumState({ running: true, started: null, hits: [], done: 0, total: 0 });

    const ws = openWs("/ws/dns-recon");
    wsRef.current = ws;
    watchRef.current = watchWsLiveness(ws, {
      connectMs: 5_000,
      idleMs:    45_000,
      onTimeout: (phase) => {
        setTimedOut(phase);
        setBusy(false);
        setEnumState((s) => ({ ...s, running: false }));
        try { ws.close(); } catch { /* ignore */ }
      },
    });
    ws.onopen = () => {
      ws.send(JSON.stringify({ domain: t, wordlist, confirm }));
    };
    ws.onmessage = (msg) => {
      watchRef.current?.touch();
      const ev = JSON.parse(msg.data) as DnsReconEvent;
      if (ev.type === "started") {
        setEnumState((s) => ({
          ...s,
          started: { ns: ev.ns, wordlist_size: ev.wordlist_size },
          total: ev.wordlist_size,
        }));
      } else if (ev.type === "hit") {
        setEnumState((s) => ({ ...s, hits: [...s.hits, { subdomain: ev.subdomain, ip: ev.ip }] }));
      } else if (ev.type === "progress") {
        setEnumState((s) => ({ ...s, done: ev.done, total: ev.total }));
      } else if (ev.type === "done") {
        setEnumState((s) => ({ ...s, running: false, elapsed: ev.elapsed }));
        setBusy(false);
        watchRef.current?.stop();
      } else if (ev.type === "error") {
        if (ev.need_confirm) {
          // Server sends a clean reason now; the legacy "need_confirm: " prefix
          // is no longer present but the .replace is harmless on bare strings.
          setConfirmReason(ev.detail.replace("need_confirm: ", ""));
        } else {
          setError(ev.detail);
        }
        setEnumState((s) => ({ ...s, running: false }));
        setBusy(false);
        watchRef.current?.stop();
      }
    };
    ws.onerror = () => {
      setError("WebSocket error");
      setEnumState((s) => ({ ...s, running: false }));
      setBusy(false);
      watchRef.current?.stop();
    };
    ws.onclose = () => {
      setEnumState((s) => ({ ...s, running: false }));
      setBusy(false);
      watchRef.current?.stop();
    };
  }

  function stopEnum() {
    wsRef.current?.send(JSON.stringify({ action: "stop" }));
  }

  function onSearch() {
    if (mode === "quick") return runQuick(false);
    return runEnum(false);
  }

  function onConfirmYes() {
    setConfirmReason(null);
    if (mode === "quick") return runQuick(true);
    return runEnum(true);
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3 flex flex-col gap-2">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">
              Discovery
            </div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              DNS Recon
            </h2>
          </div>

          <ModeToggle mode={mode} setMode={setMode} />

          {mode === "enum" && (
            <WordlistToggle value={wordlist} onChange={setWordlist} />
          )}

          <div className="flex-1 flex gap-2 items-center max-w-2xl">
            <span className="text-ink-dim text-sm select-none">›</span>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onSearch(); }}
              placeholder="example.com"
              className="flex-1 bg-bg-card border border-divider rounded
                         px-3 py-1.5 text-sm font-mono text-ink-primary
                         placeholder:text-ink-dim
                         focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
                         transition"
              autoCorrect="off"
              spellCheck={false}
            />
            {enumState.running ? (
              <button
                onClick={stopEnum}
                className="bg-danger/80 hover:bg-danger active:translate-y-px
                           text-white text-xs font-bold tracking-wide
                           px-3.5 py-1.5 rounded transition
                           border border-danger/60"
              >
                ◼ Stop
              </button>
            ) : (
              <button
                onClick={onSearch}
                disabled={busy}
                className="bg-accent hover:bg-accentDim active:translate-y-px
                           text-white text-xs font-bold tracking-wide
                           px-3.5 py-1.5 rounded transition
                           disabled:opacity-50 disabled:cursor-not-allowed
                           border border-accent/60"
              >
                {busy ? "Working…" : mode === "quick" ? "▶ Look up" : "▶ Enumerate"}
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {confirmReason && (
          <ConfirmBanner
            reason={confirmReason}
            target={domain}
            onCancel={() => setConfirmReason(null)}
            onConfirm={onConfirmYes}
          />
        )}

        {timedOut && (
          <div className="border border-amber/40 bg-amber/10 text-amber
                          rounded px-3 py-2 text-sm font-mono flex items-center gap-3">
            <span>⏱</span>
            <div className="flex-1">
              <div className="font-bold">
                {timedOut === "connect" ? "Backend not responding" :
                 timedOut === "idle"    ? "Enumeration stalled" :
                                          "Request timed out"}
              </div>
              <div className="text-[11px] text-ink-muted">
                {timedOut === "connect" ? "WebSocket failed to open within 5 seconds." :
                 timedOut === "idle"    ? "No progress for 45 seconds. The run was stopped." :
                                          "The DNS lookup didn't complete in time."}
              </div>
            </div>
            <button
              onClick={onSearch}
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

        {mode === "quick" && report && <QuickReport report={report} />}

        {mode === "enum" && (enumState.started || enumState.running || enumState.hits.length > 0) && (
          <EnumPanel state={enumState} />
        )}

        {!confirmReason && !error && !timedOut && !report && !enumState.started && !busy && <EmptyState />}
      </div>
    </div>
  );
}

function ModeToggle({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const base = "px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] border transition";
  return (
    <div className="flex rounded overflow-hidden border border-divider shrink-0">
      <button
        onClick={() => setMode("quick")}
        className={base + " " + (mode === "quick"
          ? "bg-accent/20 text-accent border-accent/40"
          : "bg-bg-card text-ink-dim hover:text-ink-primary border-transparent")}
      >
        Quick
      </button>
      <button
        onClick={() => setMode("enum")}
        className={base + " " + (mode === "enum"
          ? "bg-accent/20 text-accent border-accent/40"
          : "bg-bg-card text-ink-dim hover:text-ink-primary border-transparent")}
      >
        Subdomain
      </button>
    </div>
  );
}

function WordlistToggle({
  value, onChange,
}: { value: "small" | "medium"; onChange: (v: "small" | "medium") => void }) {
  const base = "px-2 py-1 text-[10px] uppercase tracking-[0.2em] border transition";
  return (
    <div className="flex rounded overflow-hidden border border-divider shrink-0">
      <button
        onClick={() => onChange("small")}
        className={base + " " + (value === "small"
          ? "bg-accent/20 text-accent border-accent/40"
          : "bg-bg-card text-ink-dim hover:text-ink-primary border-transparent")}
      >
        Small
      </button>
      <button
        onClick={() => onChange("medium")}
        className={base + " " + (value === "medium"
          ? "bg-accent/20 text-accent border-accent/40"
          : "bg-bg-card text-ink-dim hover:text-ink-primary border-transparent")}
      >
        Medium
      </button>
    </div>
  );
}

function ConfirmBanner({
  reason, target, onCancel, onConfirm,
}: { reason: string; target: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="rounded-md border-l-4 border-amber/40 border-y border-r border-divider
                    bg-amber/5 px-4 py-3 flex items-start gap-3">
      <span className="text-amber text-lg leading-none">⚠</span>
      <div className="flex-1">
        <div className="text-[10px] uppercase tracking-[0.25em] text-amber">
          External target
        </div>
        <div className="mt-1 text-sm font-mono text-ink-primary">
          About to query <span className="text-amber">{target}</span> — {reason}
        </div>
        <div className="mt-2 text-[11px] text-ink-muted">
          Edit <span className="text-ink-primary">~/network_tools/backend/config.json</span> →
          <span className="text-ink-primary"> target_policy.allow_external</span> to silence this for trusted domains.
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

function EmptyState() {
  return (
    <div className="h-full min-h-[260px] flex items-center justify-center">
      <div className="text-center max-w-md">
        <pre className="text-ink-dim text-[11px] leading-tight select-none">
{`        ┌──────────────┐
        │  DNS  RECON  │
        │  ▶ ▶ AXFR ▶  │
        └──────────────┘`}
        </pre>
        <div className="mt-4 text-xs text-ink-muted">
          Quick = record dump + zone transfer probe.<br />
          Subdomain = bruteforce common prefixes against the domain.
        </div>
      </div>
    </div>
  );
}

function QuickReport({ report }: { report: DnsReport }) {
  const axfrSucceeded = report.zone_transfer.some((z) => z.succeeded);
  return (
    <>
      {/* Findings banner first */}
      {report.findings.length > 0 && (
        <Card title={`Findings · ${report.findings.length}`}>
          <ul className="space-y-1">
            {report.findings.map((f, i) => {
              const sev = SEV[f.severity] ?? SEV.info;
              return (
                <li key={i} className="flex items-start gap-2">
                  <span className={"inline-block w-2 h-2 rounded-full mt-1.5 " + sev.dot} />
                  <span className={"text-[10px] uppercase tracking-widest " + sev.text}>
                    {f.severity}
                  </span>
                  <span className="text-ink-primary flex-1">{f.label}</span>
                  <span className="text-ink-muted">{f.detail}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card title="Records">
        {(Object.entries(report.records) as [keyof typeof report.records, string[]][]).map(([type, values]) => (
          <div key={type} className="grid grid-cols-[60px_1fr] gap-x-3 py-0.5">
            <span className="text-ink-dim">{type}</span>
            <span className="text-ink-primary break-all">
              {values.length === 0
                ? <span className="text-ink-dim">—</span>
                : values.map((v, i) => <div key={i}>{v}</div>)}
            </span>
          </div>
        ))}
      </Card>

      <Card title="DNSSEC">
        <Row k="Signed" v={
          report.dnssec.signed
            ? <span className="text-phos">✓ yes</span>
            : <span className="text-amber">✗ no</span>
        }/>
        <Row k="DNSKEY" v={String(report.dnssec.dnskey_count)} />
        <Row k="DS"     v={String(report.dnssec.ds_count)} />
      </Card>

      {report.reverse_dns.length > 0 && (
        <Card title="Reverse DNS">
          {report.reverse_dns.map((r, i) => (
            <Row key={i} k={r.ip} v={r.ptr || <span className="text-ink-dim">(no PTR)</span>} />
          ))}
        </Card>
      )}

      {report.zone_transfer.length > 0 && (
        <Card
          title={"Zone Transfer · " + (axfrSucceeded ? "succeeded ✗" : "all refused ✓")}
          accent={axfrSucceeded ? "border-danger/60" : undefined}
        >
          {report.zone_transfer.map((z, i) => (
            <div key={i} className="flex gap-3 py-0.5">
              <span className={z.succeeded ? "text-danger w-4" : "text-phos w-4"}>
                {z.succeeded ? "✗" : "✓"}
              </span>
              <span className="text-ink-muted flex-1">{z.ns}</span>
              <span className={z.succeeded ? "text-danger" : "text-ink-dim"}>
                {z.succeeded ? `${z.record_count} records` : "refused"}
              </span>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

function EnumPanel({ state }: {
  state: {
    running: boolean;
    started: { ns: string[]; wordlist_size: number } | null;
    hits: EnumHit[];
    done: number; total: number; elapsed?: number;
  }
}) {
  const pct = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0;
  return (
    <>
      <Card title="Subdomain Enumeration">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 rounded bg-bg-base border border-divider overflow-hidden">
            <div
              className={"h-full transition-all " + (state.running ? "bg-accent" : "bg-phos")}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-ink-dim text-[11px] w-20 text-right">
            {state.done}/{state.total}
          </span>
          <span className="text-phos text-[11px] w-14 text-right">
            {state.hits.length} hits
          </span>
          {state.elapsed != null && (
            <span className="text-ink-dim text-[11px] w-16 text-right">
              {state.elapsed.toFixed(1)}s
            </span>
          )}
        </div>
        {state.started && (
          <div className="mt-2 text-[11px] text-ink-dim">
            NS: {state.started.ns.length === 0 ? "—" : state.started.ns.join(", ")}
          </div>
        )}
      </Card>

      <Card title={`Hits · ${state.hits.length}`}>
        {state.hits.length === 0 ? (
          <div className="text-ink-dim">
            {state.running ? "Probing…" : "No hits."}
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_1fr] gap-x-3 gap-y-0.5">
            {state.hits.map((h, i) => (
              <div key={i} className="contents">
                <span className="text-ink-primary break-all">{h.subdomain}</span>
                <span className="text-ink-muted">{h.ip}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function Card({
  title, accent, children,
}: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <section className={"rounded-md overflow-hidden border " + (accent ?? "border-divider")}>
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
      <span className="w-24 shrink-0 text-ink-dim">{k}</span>
      <span className="text-ink-primary break-all">{v}</span>
    </div>
  );
}
