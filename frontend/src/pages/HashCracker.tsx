import { useEffect, useRef, useState } from "react";
import {
  identifyHash, computeHash, fetchHashAlgorithms, openWs,
  type HashCrackEvent, type HashIdentifyResp, type HashComputeResp,
} from "../api";
import EmptyState from "../components/EmptyState";
import CopyButton from "../components/CopyButton";

type Mode = "identify" | "compute" | "crack";

export default function HashCracker() {
  const [mode, setMode] = useState<Mode>("identify");
  const [algs, setAlgs] = useState<{
    fast: string[]; slow: string[];
    rockyou: { available: boolean; path: string; size_bytes?: number; approx_lines?: number };
  } | null>(null);

  // Identify state
  const [idHash, setIdHash] = useState("");
  const [idResult, setIdResult] = useState<HashIdentifyResp | null>(null);

  // Compute state
  const [cmpAlg, setCmpAlg]   = useState("sha256");
  const [cmpInput, setCmpInput] = useState("");
  const [cmpResult, setCmpResult] = useState<HashComputeResp | null>(null);

  // Crack state
  const [crackHash, setCrackHash] = useState("");
  const [crackAlg, setCrackAlg]   = useState("auto");
  const [useBuiltin, setUseBuiltin] = useState(true);
  const [useRockyou, setUseRockyou] = useState(false);
  const [wordlist, setWordlist] = useState("");
  const [crackState, setCrackState] = useState<{
    running: boolean; started: { algorithm: string; total: number; builtin_used: boolean } | null;
    progress: { tried: number; total: number; elapsed: number } | null;
    done: { cracked: boolean; plaintext: string | null; tried: number; total: number;
            elapsed_seconds: number; stopped: boolean } | null;
    error: string | null;
  }>({ running: false, started: null, progress: null, done: null, error: null });
  const wsRef = useRef<WebSocket | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHashAlgorithms().then(setAlgs).catch(() => {});
  }, []);

  useEffect(() => () => {
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  // Identify on each keystroke for instant feedback (with debounce)
  useEffect(() => {
    if (mode !== "identify") return;
    const h = idHash.trim();
    if (!h) { setIdResult(null); return; }
    const id = setTimeout(async () => {
      try {
        setIdResult(await identifyHash(h));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 200);
    return () => clearTimeout(id);
  }, [idHash, mode]);

  async function runCompute() {
    const t = cmpInput;
    setBusy(true); setError(null); setCmpResult(null);
    try {
      setCmpResult(await computeHash(t, cmpAlg));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  function startCrack() {
    const h = crackHash.trim();
    if (!h) return;
    const list = wordlist.split("\n").map((s) => s.trimEnd()).filter((s) => s.length > 0);
    setCrackState({ running: true, started: null, progress: null, done: null, error: null });
    const ws = openWs("/ws/hash-crack");
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({
      hash: h, algorithm: crackAlg,
      use_builtin: useBuiltin, use_rockyou: useRockyou,
      wordlist: list,
    }));
    ws.onmessage = (m) => {
      const ev = JSON.parse(m.data) as HashCrackEvent;
      if (ev.type === "started") {
        setCrackState((s) => ({ ...s, started: { algorithm: ev.algorithm, total: ev.total, builtin_used: ev.builtin_used } }));
      } else if (ev.type === "progress") {
        setCrackState((s) => ({ ...s, progress: { tried: ev.tried, total: ev.total, elapsed: ev.elapsed } }));
      } else if (ev.type === "done") {
        setCrackState((s) => ({ ...s, done: ev, running: false }));
      } else if (ev.type === "error") {
        setCrackState((s) => ({ ...s, error: ev.detail, running: false }));
      }
    };
    ws.onerror = () => setCrackState((s) => ({ ...s, error: "WebSocket error", running: false }));
    ws.onclose = () => setCrackState((s) => ({ ...s, running: false }));
  }

  function stopCrack() {
    wsRef.current?.send(JSON.stringify({ action: "stop" }));
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Crypto</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              Hash Cracker
            </h2>
          </div>
          <ModeToggle mode={mode} setMode={setMode} />
          <div className="flex-1" />
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">Error — {error}</div>
        )}

        {mode === "identify" && (
          <>
            <Card title="Hash">
              <input type="text" value={idHash} onChange={(e) => setIdHash(e.target.value)}
                placeholder="paste a hash …"
                className="w-full bg-bg-base border border-divider rounded
                           px-3 py-2 text-[13px] font-mono text-ink-primary placeholder:text-ink-dim
                           focus:outline-none focus:border-accent break-all"
                spellCheck={false} autoCorrect="off" />
              {idHash && (
                <div className="mt-1 text-[10px] text-ink-dim">length: {idHash.length}</div>
              )}
            </Card>

            {!idResult && !idHash && (
              <EmptyState
                icon="🆔"
                title="Hash identifier"
                description="Length + character-class heuristic. Paste a hash above to see candidate algorithms."
                hint="Try `5f4dcc3b5aa765d61d8327deb882cf99` (md5 of 'password')."
              />
            )}
            {idResult && (
              <Card title={`Candidates · ${idResult.candidates.length}`}>
                {idResult.candidates.length === 0 ? (
                  <div className="text-ink-dim">No known signature matched.</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {idResult.candidates.map((c, i) => (
                      <span key={i}
                        style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                        className="mhp-result-in px-2.5 py-1 rounded border border-accent/40 bg-accent/10
                                   text-accent text-[11px] font-mono">{c}</span>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </>
        )}

        {mode === "compute" && (
          <>
            <Card title="Plaintext">
              <textarea value={cmpInput} onChange={(e) => setCmpInput(e.target.value)}
                rows={4} placeholder="enter text to hash …"
                className="w-full bg-bg-base border border-divider rounded
                           px-3 py-2 text-[13px] font-mono text-ink-primary placeholder:text-ink-dim
                           focus:outline-none focus:border-accent resize-y break-all"
                spellCheck={false} autoCorrect="off" />
              <div className="mt-1 text-[10px] text-ink-dim">length: {cmpInput.length}</div>
            </Card>

            <div className="flex gap-3 items-center">
              <label className="text-[10px] uppercase tracking-widest text-ink-dim">Algorithm</label>
              <select value={cmpAlg} onChange={(e) => setCmpAlg(e.target.value)}
                className="bg-bg-card border border-divider rounded px-3 py-1.5 text-sm font-mono text-ink-primary
                           focus:outline-none focus:border-accent">
                <optgroup label="Fast">
                  {algs?.fast.map((a) => <option key={a} value={a}>{a}</option>)}
                </optgroup>
                <optgroup label="Slow">
                  {algs?.slow.map((a) => <option key={a} value={a}>{a}</option>)}
                </optgroup>
              </select>
              <button onClick={runCompute} disabled={busy}
                className="bg-accent hover:bg-accentDim text-white text-xs font-bold tracking-wide
                           px-3.5 py-1.5 rounded disabled:opacity-50 border border-accent/60">
                {busy ? "Computing…" : "▶ Hash"}
              </button>
            </div>

            {cmpResult && (
              <Card title={`Result · ${cmpResult.algorithm}`}>
                <div className="flex items-start gap-2">
                  <div className="break-all text-ink-primary select-all flex-1">{cmpResult.hash}</div>
                  <CopyButton text={cmpResult.hash} alwaysVisible />
                </div>
                <div className="mt-1 text-[10px] text-ink-dim">length: {cmpResult.hash.length}</div>
              </Card>
            )}
          </>
        )}

        {mode === "crack" && (
          <>
            <Card title="Target hash">
              <input type="text" value={crackHash} onChange={(e) => setCrackHash(e.target.value)}
                placeholder="paste hash to crack …"
                className="w-full bg-bg-base border border-divider rounded
                           px-3 py-2 text-[13px] font-mono text-ink-primary placeholder:text-ink-dim
                           focus:outline-none focus:border-accent break-all"
                spellCheck={false} autoCorrect="off" />
            </Card>

            <div className="flex gap-3 items-center flex-wrap">
              <label className="text-[10px] uppercase tracking-widest text-ink-dim">Algorithm</label>
              <select value={crackAlg} onChange={(e) => setCrackAlg(e.target.value)}
                className="bg-bg-card border border-divider rounded px-3 py-1.5 text-sm font-mono text-ink-primary
                           focus:outline-none focus:border-accent">
                <option value="auto">auto-identify</option>
                <optgroup label="Fast">
                  {algs?.fast.map((a) => <option key={a} value={a}>{a}</option>)}
                </optgroup>
                <optgroup label="Slow (each attempt is slow on purpose)">
                  {algs?.slow.map((a) => <option key={a} value={a}>{a}</option>)}
                </optgroup>
              </select>

              <label className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-ink-muted">
                <input type="checkbox" checked={useBuiltin} onChange={(e) => setUseBuiltin(e.target.checked)} />
                Built-in (~480)
              </label>

              {algs?.rockyou.available && (
                <label className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-ink-muted">
                  <input type="checkbox" checked={useRockyou} onChange={(e) => setUseRockyou(e.target.checked)} />
                  <span className={useRockyou ? "text-amber" : ""}>
                    rockyou.txt ({(algs.rockyou.approx_lines ?? 0).toLocaleString()})
                  </span>
                </label>
              )}
              {algs && !algs.rockyou.available && (
                <span className="text-[11px] text-ink-dim italic">
                  rockyou.txt.gz not found
                </span>
              )}

              {crackState.running ? (
                <button onClick={stopCrack}
                  className="bg-danger/80 hover:bg-danger text-white text-xs font-bold tracking-wide
                             px-3.5 py-1.5 rounded border border-danger/60 ml-auto">
                  ◼ Stop
                </button>
              ) : (
                <button onClick={startCrack} disabled={!crackHash.trim()}
                  className="bg-accent hover:bg-accentDim text-white text-xs font-bold tracking-wide
                             px-3.5 py-1.5 rounded disabled:opacity-50 border border-accent/60 ml-auto">
                  ▶ Crack
                </button>
              )}
            </div>

            <Card title="Custom wordlist (one per line — optional)">
              <textarea value={wordlist} onChange={(e) => setWordlist(e.target.value)}
                rows={6} placeholder={"hunter2\nletmein\nfoobar123"}
                disabled={crackState.running}
                className="w-full bg-bg-base border border-divider rounded
                           px-3 py-2 text-[11px] font-mono text-ink-primary placeholder:text-ink-dim
                           focus:outline-none focus:border-accent resize-y break-all"
                spellCheck={false} autoCorrect="off" />
              <div className="mt-1 text-[10px] text-ink-dim">
                lines: {wordlist.split("\n").filter((s) => s.trim()).length}
              </div>
            </Card>

            {crackState.error && (
              <div className="border border-danger/40 bg-danger/10 text-danger
                              rounded px-3 py-2 text-sm font-mono">{crackState.error}</div>
            )}

            {crackState.started && (
              <Card title={`Cracking · ${crackState.started.algorithm}`}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 rounded bg-bg-base border border-divider overflow-hidden">
                    <div className={"h-full transition-all " + (crackState.running ? "bg-accent" : "bg-phos")}
                      style={{ width: `${crackState.progress
                        ? Math.round((crackState.progress.tried / crackState.progress.total) * 100)
                        : 0}%` }} />
                  </div>
                  <span className="text-ink-dim text-[11px] w-32 text-right">
                    {crackState.progress?.tried ?? 0} / {crackState.started.total}
                  </span>
                  {crackState.done?.elapsed_seconds != null && (
                    <span className="text-ink-dim text-[11px]">
                      {crackState.done.elapsed_seconds.toFixed(2)}s
                    </span>
                  )}
                </div>
              </Card>
            )}

            {crackState.done && (
              <div className={"mhp-result-in rounded-md border-l-4 border-y border-r border-divider px-4 py-3 " +
                (crackState.done.cracked
                  ? "border-l-phos bg-phos/10 mhp-critical-pulse"
                  : "border-l-amber bg-amber/5")}>
                <div className="flex items-center gap-2">
                  <div className={"text-[10px] uppercase tracking-[0.25em] " +
                    (crackState.done.cracked ? "text-phos" : "text-amber")}>
                    {crackState.done.cracked ? "Cracked" : "Not in wordlist"}
                  </div>
                  {crackState.done.cracked && crackState.done.plaintext != null && (
                    <CopyButton text={crackState.done.plaintext} alwaysVisible className="ml-auto" />
                  )}
                </div>
                {crackState.done.cracked && crackState.done.plaintext !== null && (
                  <div className="mt-1 text-base font-mono text-ink-primary break-all select-all">
                    {crackState.done.plaintext.length === 0
                      ? <span className="text-ink-dim italic">(empty string)</span>
                      : crackState.done.plaintext}
                  </div>
                )}
                <div className="mt-1 text-[11px] text-ink-muted">
                  Tried {crackState.done.tried} of {crackState.done.total} in {crackState.done.elapsed_seconds.toFixed(2)}s.
                  {crackState.done.stopped && " (stopped by user)"}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ModeToggle({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const opts: Mode[] = ["identify", "compute", "crack"];
  return (
    <div className="flex rounded overflow-hidden border border-divider shrink-0">
      {opts.map((m) => (
        <button key={m} onClick={() => setMode(m)}
          className={"px-3 py-1 text-[10px] uppercase tracking-[0.2em] border-r border-divider last:border-r-0 transition " +
            (mode === m
              ? "bg-accent/20 text-accent"
              : "bg-bg-card text-ink-dim hover:text-ink-primary")
          }>{m}</button>
      ))}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md overflow-hidden border border-divider">
      <header className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]
                         text-ink-dim border-b border-divider bg-bg-panel">{title}</header>
      <div className="bg-bg-card p-3 text-xs font-mono">{children}</div>
    </section>
  );
}
