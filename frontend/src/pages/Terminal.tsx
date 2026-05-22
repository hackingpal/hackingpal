import { useEffect, useRef, useState } from "react";
import { execCommand, fetchDefaultCwd } from "../api";

type Line = { kind: "prompt" | "stdout" | "stderr" | "info"; text: string };

export default function Terminal() {
  const [cwd,     setCwd]     = useState<string>("");
  const [history, setHistory] = useState<Line[]>([]);
  const [input,   setInput]   = useState("");
  const [busy,    setBusy]    = useState(false);
  const [recall,  setRecall]  = useState<string[]>([]);
  const [recallI, setRecallI] = useState(-1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchDefaultCwd().then((r) => setCwd(r.cwd)).catch(() => setCwd("~"));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  async function run(cmd: string) {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    setBusy(true);
    setRecall((r) => (r[r.length - 1] === trimmed ? r : [...r, trimmed]).slice(-200));
    setRecallI(-1);
    setHistory((h) => [...h, { kind: "prompt", text: `${shortCwd(cwd)} $ ${trimmed}` }]);
    try {
      const r = await execCommand(trimmed, cwd);
      setCwd(r.cwd);
      if (r.stdout) setHistory((h) => [...h, { kind: "stdout", text: r.stdout.replace(/\n$/, "") }]);
      if (r.stderr) setHistory((h) => [...h, { kind: "stderr", text: r.stderr.replace(/\n$/, "") }]);
      if (r.truncated) setHistory((h) => [...h, { kind: "info", text: "(output truncated)" }]);
      if (r.returncode !== 0 && !r.stderr && !r.stdout) {
        setHistory((h) => [...h, { kind: "stderr", text: `exit ${r.returncode}` }]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setHistory((h) => [...h, { kind: "stderr", text: msg }]);
    } finally {
      setBusy(false);
      setInput("");
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      void run(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!recall.length) return;
      const next = recallI === -1 ? recall.length - 1 : Math.max(0, recallI - 1);
      setRecallI(next); setInput(recall[next]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (recallI === -1) return;
      const next = recallI + 1;
      if (next >= recall.length) { setRecallI(-1); setInput(""); }
      else { setRecallI(next); setInput(recall[next]); }
    } else if (e.key === "l" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); setHistory([]);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3 flex items-end gap-6">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Utilities</div>
          <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">Terminal</h2>
        </div>
        <div className="text-xs text-ink-muted flex-1">
          Single-command executor — runs one command per ↵. No interactive prompts;
          use a real terminal for those.
        </div>
        <button onClick={() => setHistory([])}
                className="text-xs text-ink-muted hover:text-ink-primary
                           border border-divider rounded px-2 py-1">
          Clear (⌘L)
        </button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="bg-bg-card border border-divider rounded p-3 font-mono text-[12px]
                        leading-snug min-h-full">
          {history.map((ln, i) => (
            <div key={i} className={
              ln.kind === "prompt" ? "text-accent" :
              ln.kind === "stderr" ? "text-danger" :
              ln.kind === "info"   ? "text-ink-dim italic" :
                                      "text-ink-primary whitespace-pre-wrap"
            }>
              {ln.text}
            </div>
          ))}
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-accent shrink-0">{shortCwd(cwd)} $</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              disabled={busy}
              autoFocus
              className="flex-1 bg-transparent outline-none text-ink-primary
                         placeholder:text-ink-dim disabled:opacity-50"
              placeholder={busy ? "running…" : "type a command and press Enter"}
            />
          </div>
          <div ref={endRef} />
        </div>
      </div>
    </div>
  );
}

function shortCwd(cwd: string): string {
  const home = "/Users/" + (cwd.split("/")[2] ?? "");
  if (cwd.startsWith(home)) return "~" + cwd.slice(home.length);
  return cwd;
}
