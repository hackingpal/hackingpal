import { useEffect, useRef, useState } from "react";
import AuthorizationGate from "../components/AuthorizationGate";
import {
  fetchTakeoverCheck, openWs,
  type TakeoverEvent, type TakeoverResult, type TakeoverVerdict,
} from "../api";

type Mode = "single" | "bulk";

const VERDICT_COLOR: Record<TakeoverVerdict, string> = {
  vulnerable: "text-danger",
  dangling:   "text-amber",
  matched:    "text-amber",
  clean:      "text-phos",
  no_cname:   "text-ink-dim",
};

const VERDICT_DOT: Record<TakeoverVerdict, string> = {
  vulnerable: "bg-danger",
  dangling:   "bg-amber",
  matched:    "bg-amber",
  clean:      "bg-phos",
  no_cname:   "bg-ink-dim",
};

export default function Takeover() {
  const [mode, setMode] = useState<Mode>("single");
  const [fqdn, setFqdn] = useState("");
  const [bulkText, setBulkText] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReason, setConfirmReason] = useState<string | null>(null);

  const [single, setSingle] = useState<TakeoverResult | null>(null);
  const [authorized, setAuthorized] = useState(false);

  const [scanState, setScanState] = useState<{
    running: boolean;
    started: number | null;
    results: TakeoverResult[];
    done: number; total: number; elapsed?: number;
  }>({ running: false, started: null, results: [], done: 0, total: 0 });

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => () => {
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  async function runSingle(confirm = false) {
    const f = fqdn.trim();
    if (!f) return;
    setBusy(true); setError(null); setConfirmReason(null); setSingle(null);
    try {
      const r = await fetchTakeoverCheck(f, confirm);
      if ("needConfirm" in r) setConfirmReason(r.reason);
      else setSingle(r);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  function runBulk(confirm = false) {
    const subs = bulkText.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (subs.length === 0) return;
    setBusy(true); setError(null); setConfirmReason(null);
    setScanState({ running: true, started: subs.length, results: [], done: 0, total: subs.length });

    const ws = openWs("/ws/takeover-scan");
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({
      subdomains: subs, confirm, confirm_auth: true,
    }));
    ws.onmessage = (msg) => {
      const ev = JSON.parse(msg.data) as TakeoverEvent;
      if (ev.type === "started") {
        setScanState((s) => ({ ...s, total: ev.count }));
      } else if (ev.type === "result") {
        const r: TakeoverResult = {
          fqdn: ev.fqdn, cname_chain: ev.cname_chain, service: ev.service,
          signature_matched: ev.signature_matched, verdict: ev.verdict,
          evidence: ev.evidence,
        };
        setScanState((s) => ({ ...s, results: [...s.results, r] }));
      } else if (ev.type === "progress") {
        setScanState((s) => ({ ...s, done: ev.done, total: ev.total }));
      } else if (ev.type === "done") {
        setScanState((s) => ({ ...s, running: false, elapsed: ev.elapsed }));
        setBusy(false);
      } else if (ev.type === "error") {
        if (ev.need_confirm) setConfirmReason(ev.detail.replace("need_confirm: ", ""));
        else setError(ev.detail);
        setScanState((s) => ({ ...s, running: false }));
        setBusy(false);
      }
    };
    ws.onerror = () => { setError("WebSocket error"); setBusy(false); };
    ws.onclose = () => { setScanState((s) => ({ ...s, running: false })); setBusy(false); };
  }

  function stop() {
    wsRef.current?.send(JSON.stringify({ action: "stop" }));
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">OSINT</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              Subdomain Takeover
            </h2>
          </div>

          <div className="flex rounded overflow-hidden border border-divider shrink-0">
            {(["single", "bulk"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={
                  "px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] border transition " +
                  (mode === m
                    ? "bg-accent/20 text-accent border-accent/40"
                    : "bg-bg-card text-ink-dim hover:text-ink-primary border-transparent")
                }>
                {m}
              </button>
            ))}
          </div>

          {mode === "single" ? (
            <div className="flex-1 flex gap-2 items-center max-w-2xl">
              <span className="text-ink-dim text-sm select-none">›</span>
              <input
                type="text" value={fqdn} onChange={(e) => setFqdn(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runSingle(); }}
                placeholder="sub.example.com"
                className="flex-1 bg-bg-card border border-divider rounded
                           px-3 py-1.5 text-sm font-mono text-ink-primary
                           placeholder:text-ink-dim
                           focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
                autoCorrect="off" spellCheck={false}
              />
              <button onClick={() => runSingle()} disabled={busy}
                className="bg-accent hover:bg-accentDim active:translate-y-px
                           text-white text-xs font-bold tracking-wide px-3.5 py-1.5 rounded
                           disabled:opacity-50 disabled:cursor-not-allowed border border-accent/60">
                {busy ? "Checking…" : "▶ Check"}
              </button>
            </div>
          ) : (
            <div className="flex-1 flex gap-3 items-center max-w-3xl">
              <div className="flex-1">
                <AuthorizationGate authorized={authorized} setAuthorized={setAuthorized}
                                   toolName="bulk subdomain-takeover scan"
                                   disabled={scanState.running} />
              </div>
              {scanState.running ? (
                <button onClick={stop}
                  className="bg-danger/80 hover:bg-danger text-white text-xs font-bold
                             tracking-wide px-3.5 py-1.5 rounded border border-danger/60">
                  ◼ Stop
                </button>
              ) : (
                <button onClick={() => runBulk()} disabled={busy || !authorized}
                  className="bg-accent hover:bg-accentDim active:translate-y-px
                             text-white text-xs font-bold tracking-wide px-3.5 py-1.5 rounded
                             disabled:opacity-50 disabled:cursor-not-allowed border border-accent/60">
                  ▶ Scan all
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {confirmReason && (
          <div className="rounded-md border-l-4 border-amber/40 border-y border-r border-divider
                          bg-amber/5 px-4 py-3 flex items-start gap-3">
            <span className="text-amber text-lg leading-none">⚠</span>
            <div className="flex-1 text-sm font-mono text-ink-primary">{confirmReason}</div>
            <button onClick={() => setConfirmReason(null)}
              className="text-[11px] font-bold tracking-wide px-3 py-1.5 rounded
                         bg-bg-card border border-divider text-ink-dim hover:text-ink-primary transition">
              Cancel
            </button>
            <button
              onClick={() => { setConfirmReason(null); mode === "single" ? runSingle(true) : runBulk(true); }}
              className="text-[11px] font-bold tracking-wide px-3 py-1.5 rounded
                         bg-amber/20 border border-amber/40 text-amber hover:bg-amber/30 transition">
              ▶ Proceed
            </button>
          </div>
        )}
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">
            Error — {error}
          </div>
        )}

        {mode === "single" && single && <SingleResult r={single} />}
        {mode === "single" && !single && !busy && !error && !confirmReason && <EmptySingle />}

        {mode === "bulk" && (
          <>
            <Card title="Subdomain list — one per line or comma-separated">
              <textarea
                value={bulkText} onChange={(e) => setBulkText(e.target.value)}
                placeholder={"sub1.example.com\nsub2.example.com\n…"}
                rows={6} disabled={scanState.running}
                className="w-full bg-bg-base border border-divider rounded
                           px-2 py-1.5 text-[11px] font-mono text-ink-primary
                           placeholder:text-ink-dim focus:outline-none focus:border-accent resize-y"
              />
            </Card>

            {(scanState.results.length > 0 || scanState.running || scanState.elapsed != null) && (
              <Card title={`Scan · ${scanState.done}/${scanState.total} · ${scanState.results.filter(r => r.verdict === "vulnerable" || r.verdict === "dangling").length} hits`}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-2 rounded bg-bg-base border border-divider overflow-hidden">
                    <div className={"h-full transition-all " + (scanState.running ? "bg-accent" : "bg-phos")}
                      style={{ width: scanState.total > 0 ? `${Math.round((scanState.done / scanState.total) * 100)}%` : "0%" }} />
                  </div>
                  {scanState.elapsed != null && (
                    <span className="text-ink-dim text-[11px] w-16 text-right">
                      {scanState.elapsed.toFixed(1)}s
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-[100px_2fr_120px_2fr] gap-x-3 gap-y-0.5">
                  <span className="text-ink-dim text-[10px] uppercase tracking-wider">Verdict</span>
                  <span className="text-ink-dim text-[10px] uppercase tracking-wider">FQDN</span>
                  <span className="text-ink-dim text-[10px] uppercase tracking-wider">Service</span>
                  <span className="text-ink-dim text-[10px] uppercase tracking-wider">CNAME / Evidence</span>
                  {scanState.results.map((r, i) => (
                    <div key={i} className="contents">
                      <span className={"flex items-center gap-1.5 " + VERDICT_COLOR[r.verdict]}>
                        <span className={"inline-block w-2 h-2 rounded-full " + VERDICT_DOT[r.verdict]} />
                        {r.verdict}
                      </span>
                      <span className="text-ink-primary break-all">{r.fqdn}</span>
                      <span className="text-ink-muted">{r.service || "—"}</span>
                      <span className="text-ink-muted break-all">
                        {r.cname_chain.length > 0 ? r.cname_chain.join(" → ") : "—"}
                        {r.evidence && <div className="text-amber text-[10px]">{r.evidence}</div>}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SingleResult({ r }: { r: TakeoverResult }) {
  return (
    <>
      <div className={"rounded-md border-l-4 border-y border-r border-divider px-4 py-3 " +
        (r.verdict === "vulnerable" ? "border-l-danger bg-danger/5" :
         r.verdict === "dangling"   ? "border-l-amber bg-amber/5"  :
         r.verdict === "clean"      ? "border-l-phos bg-phos/5"    :
                                      "border-l-divider bg-bg-card")}>
        <div className="flex items-center gap-3">
          <span className={"inline-block w-2.5 h-2.5 rounded-full " + VERDICT_DOT[r.verdict]} />
          <div className="flex-1">
            <div className={"text-[10px] uppercase tracking-[0.25em] " + VERDICT_COLOR[r.verdict]}>
              {r.verdict}
            </div>
            <div className="text-sm font-mono font-bold text-ink-primary break-all">{r.fqdn}</div>
          </div>
          {r.service && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Service</div>
              <div className="text-sm font-mono text-amber">{r.service}</div>
            </div>
          )}
        </div>
      </div>

      <Card title="CNAME chain">
        {r.cname_chain.length === 0 ? (
          <div className="text-ink-dim">No CNAME records</div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {r.cname_chain.map((c, i) => (
              <div key={i}>
                <span className="text-ink-dim">{i + 1}.</span>
                <span className="ml-2 text-ink-primary">{c}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {r.evidence && (
        <Card title="Evidence">
          <pre className="text-[11px] text-amber whitespace-pre-wrap">{r.evidence}</pre>
        </Card>
      )}
    </>
  );
}

function EmptySingle() {
  return (
    <div className="h-full min-h-[260px] flex items-center justify-center">
      <div className="text-center max-w-md">
        <pre className="text-ink-dim text-[11px] leading-tight select-none">
{`        ┌──────────────┐
        │   T A K E    │
        │  ▶ O V E R   │
        └──────────────┘`}
        </pre>
        <div className="mt-4 text-xs text-ink-muted">
          Detects dangling CNAMEs pointing at S3/Heroku/GitHub Pages/Azure/Netlify/Vercel/etc.
        </div>
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
