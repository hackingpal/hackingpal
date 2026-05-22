import { useMemo, useState } from "react";
import {
  applyChain, TRANSFORMS, type Transform, type TransformId,
} from "../lib/obfuscator";

export default function Obfuscator() {
  const [input, setInput] = useState("powershell -c \"Get-Process\"");
  const [chain, setChain] = useState<Transform[]>([{ id: "base64" }]);
  const [showStages, setShowStages] = useState(false);

  function add(id: TransformId) {
    setChain((c) => [...c, { id, key: id === "xor" ? "secret" : undefined }]);
  }

  function remove(i: number) {
    setChain((c) => c.filter((_, idx) => idx !== i));
  }

  function move(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= chain.length) return;
    const next = chain.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setChain(next);
  }

  function updateKey(i: number, key: string) {
    const next = chain.slice();
    next[i] = { ...next[i], key };
    setChain(next);
  }

  const output = useMemo(() => applyChain(input, chain), [input, chain]);

  // Per-stage outputs, so user can see intermediate results
  const stages = useMemo(() => {
    let cur = input;
    const out: { transform: Transform; result: string }[] = [];
    for (const t of chain) {
      cur = applyChain(cur, [t]);
      out.push({ transform: t, result: cur });
    }
    return out;
  }, [input, chain]);

  return (
    <div className="h-full flex flex-col p-4 gap-3 overflow-hidden">
      <header>
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">PAYLOAD OBFUSCATOR</h2>
        <p className="text-[11px] text-ink-dim">
          Chain transforms in order. Useful for bypassing naive regex / WAF / AV signatures.
          Pure-JS — nothing leaves your machine.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 flex-1 overflow-hidden">
        {/* Left: input + add-transform panel */}
        <div className="flex flex-col gap-2 overflow-hidden">
          <div>
            <label className="block text-[11px] text-ink-muted tracking-wider mb-1">INPUT</label>
            <textarea value={input} onChange={(e) => setInput(e.target.value)}
                      rows={5} spellCheck={false}
                      className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                 text-[12px] font-mono focus:outline-none focus:border-accent
                                 resize-y" />
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="text-[11px] text-ink-muted tracking-wider mb-1">ADD TRANSFORM</div>
            <div className="flex-1 overflow-y-auto border border-divider rounded">
              {TRANSFORMS.map((t) => (
                <button key={t.id} onClick={() => add(t.id)}
                        className="w-full text-left px-2 py-1.5 border-b border-divider
                                   hover:bg-bg-nav-hover transition">
                  <div className="text-[12px] text-ink-primary">{t.label}</div>
                  <div className="text-[10px] text-ink-dim">{t.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: chain + output */}
        <div className="flex flex-col gap-2 overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] text-ink-muted tracking-wider">CHAIN</span>
              <span className="text-[10px] text-ink-dim">{chain.length} steps</span>
              <span className="flex-1" />
              <label className="text-[10px] text-ink-dim flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={showStages}
                       onChange={(e) => setShowStages(e.target.checked)} />
                show intermediate
              </label>
            </div>
            <div className="flex-1 overflow-y-auto border border-divider rounded">
              {chain.length === 0 && (
                <div className="px-3 py-4 text-[12px] text-ink-dim italic text-center">
                  Empty chain. Click a transform on the left to add it.
                </div>
              )}
              {chain.map((t, i) => {
                const def = TRANSFORMS.find((x) => x.id === t.id);
                return (
                  <div key={i} className="border-b border-divider">
                    <div className="flex items-center gap-2 p-2">
                      <span className="text-ink-dim font-mono text-[10px] w-4 text-right">{i + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] text-ink-primary">{def?.label ?? t.id}</div>
                        {def?.needsKey && (
                          <input
                            value={t.key ?? ""}
                            onChange={(e) => updateKey(i, e.target.value)}
                            placeholder="key"
                            className="mt-1 w-full bg-bg-base border border-divider rounded
                                       px-1.5 py-0.5 text-[11px] font-mono
                                       focus:outline-none focus:border-accent" />
                        )}
                      </div>
                      <button onClick={() => move(i, -1)} disabled={i === 0}
                              className="text-ink-muted hover:text-ink-primary disabled:opacity-30 text-[12px]">↑</button>
                      <button onClick={() => move(i, 1)} disabled={i === chain.length - 1}
                              className="text-ink-muted hover:text-ink-primary disabled:opacity-30 text-[12px]">↓</button>
                      <button onClick={() => remove(i)}
                              className="text-ink-muted hover:text-danger">×</button>
                    </div>
                    {showStages && (
                      <pre className="text-[10px] text-phos bg-bg-panel border-t border-divider
                                      p-2 max-h-24 overflow-y-auto whitespace-pre-wrap break-all">
                        {stages[i]?.result.slice(0, 600)}{stages[i] && stages[i].result.length > 600 ? "…" : ""}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] text-ink-muted tracking-wider">OUTPUT</span>
              <span className="text-[10px] text-ink-dim">{output.length} chars</span>
              <span className="flex-1" />
              <button
                onClick={() => navigator.clipboard?.writeText(output)}
                className="text-[10px] text-accent hover:underline">
                Copy
              </button>
            </div>
            <textarea value={output} readOnly
                      rows={6} spellCheck={false}
                      className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                 text-[12px] font-mono text-phos focus:outline-none resize-y" />
          </div>
        </div>
      </div>
    </div>
  );
}
