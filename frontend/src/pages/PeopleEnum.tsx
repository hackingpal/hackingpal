import { useEffect, useState } from "react";
import { api, authFetch, parseError } from "../api";

type SourceStatus = {
  name: string;
  needs_key: boolean;
  configured: boolean;
};

type Email = { email: string; sources: string[] };

type EnumResult = {
  target: string;
  emails: Email[];
  by_source: Record<string, number>;
  errors: Record<string, string>;
  pattern_guess: {
    pattern: string;
    confidence: number;
    sample_size: number;
    all: Record<string, number>;
  } | null;
};

export default function PeopleEnum() {
  const [target, setTarget] = useState("");
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(["duckduckgo", "crtsh", "hackertarget"]),
  );
  const [result, setResult] = useState<EnumResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ sources: SourceStatus[] }>("/people/status")
      .then((r) => setSources(r.sources)).catch(() => {});
  }, []);

  function toggle(name: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  async function go() {
    if (!target.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await authFetch(`/people/enum`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: target.trim(), sources: [...selected] }),
      });
      if (!r.ok) throw new Error(await parseError(r));
      setResult(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">PEOPLE · EMAIL ENUM</h2>
        <p className="text-[11px] text-ink-dim">
          Aggregate emails referencing a target domain across passive sources.
          Infers the org's email-format pattern (first.last, flast, etc.) so
          you can predict additional valid addresses.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-3 mb-4">
        <div className="flex gap-2">
          <input value={target} onChange={(e) => setTarget(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") void go(); }}
                 placeholder="example.com"
                 className="flex-1 bg-bg-base border border-divider rounded px-2 py-1.5
                            text-[13px] font-mono focus:outline-none focus:border-accent" />
          <button onClick={go} disabled={loading || !target.trim() || selected.size === 0}
                  className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                             disabled:opacity-40 disabled:cursor-not-allowed">
            {loading ? "Aggregating…" : "Enumerate"}
          </button>
        </div>

        <div>
          <div className="text-[11px] text-ink-muted tracking-wider mb-1">SOURCES</div>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            {sources.map((s) => {
              const disabled = s.needs_key && !s.configured;
              return (
                <label key={s.name}
                       className={"flex items-center gap-2 " +
                         (disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer")}>
                  <input type="checkbox" checked={selected.has(s.name)}
                         disabled={disabled}
                         onChange={() => toggle(s.name)} />
                  <span className="text-ink-primary">{s.name}</span>
                  {s.needs_key && (
                    <span className={s.configured ? "text-phos text-[10px]" : "text-amber text-[10px]"}>
                      {s.configured ? "key ✓" : "needs key"}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        {!sources.find((s) => s.name === "hunter")?.configured && (
          <details className="text-[11px] text-ink-dim">
            <summary className="cursor-pointer text-ink-muted">Add Hunter.io key (optional)</summary>
            <pre className="bg-bg-base border border-divider rounded p-2 mt-1 text-[11px] text-phos">
{`# 25 free searches/mo from hunter.io
curl -X POST http://127.0.0.1:8765/settings/keys/hunter_api_key \\
  -H 'Content-Type: application/json' -d '{"value":"<key>"}'`}
            </pre>
          </details>
        )}

        {error && <div className="text-[12px] text-danger">⚠ {error}</div>}
      </div>

      {result && (
        <div className="space-y-3">
          {/* Summary + pattern */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-bg-card border border-divider rounded p-3">
              <div className="text-[11px] text-ink-muted tracking-wider mb-2">SUMMARY</div>
              <div className="text-[24px] font-bold text-accent">{result.emails.length}</div>
              <div className="text-[11px] text-ink-dim">unique emails</div>
              <div className="text-[10px] text-ink-muted mt-2 space-y-0.5">
                {Object.entries(result.by_source).map(([s, n]) => (
                  <div key={s}>{s}: <span className="text-ink-primary tabular-nums">{n}</span></div>
                ))}
              </div>
            </div>

            <div className="bg-bg-card border border-divider rounded p-3">
              <div className="text-[11px] text-ink-muted tracking-wider mb-2">PATTERN INFERENCE</div>
              {result.pattern_guess ? (
                <>
                  <div className="text-[18px] font-bold text-phos font-mono">
                    {result.pattern_guess.pattern}
                  </div>
                  <div className="text-[11px] text-ink-dim">
                    {(result.pattern_guess.confidence * 100).toFixed(0)}% confidence
                    · {result.pattern_guess.sample_size} samples
                  </div>
                  <div className="text-[10px] text-ink-muted mt-2 space-y-0.5">
                    {Object.entries(result.pattern_guess.all).map(([p, n]) => (
                      <div key={p}>{p}: <span className="text-ink-primary tabular-nums">{n}</span></div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-[12px] text-ink-dim italic">
                  Not enough samples to infer a pattern (need 2+).
                </div>
              )}
            </div>
          </div>

          {/* Errors */}
          {Object.keys(result.errors).length > 0 && (
            <div className="bg-amber/10 border border-amber/30 rounded p-2 text-[11px]">
              <div className="text-amber font-bold mb-1">Source warnings:</div>
              {Object.entries(result.errors).map(([s, e]) => (
                <div key={s} className="text-ink-muted">
                  <span className="text-amber">{s}:</span> {e}
                </div>
              ))}
            </div>
          )}

          {/* Email list */}
          <div className="bg-bg-card border border-divider rounded overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-bg-panel border-b border-divider">
                <tr className="text-ink-muted text-[10px] tracking-wider">
                  <th className="text-left px-3 py-1.5">EMAIL</th>
                  <th className="text-left px-3 py-1.5">SOURCES</th>
                </tr>
              </thead>
              <tbody>
                {result.emails.map((e, i) => (
                  <tr key={i} className="border-b border-divider hover:bg-bg-nav-hover">
                    <td className="px-3 py-1.5 font-mono text-ink-primary">{e.email}</td>
                    <td className="px-3 py-1.5 text-ink-dim text-[11px]">{e.sources.join(", ")}</td>
                  </tr>
                ))}
                {result.emails.length === 0 && (
                  <tr><td colSpan={2} className="px-3 py-6 text-center text-ink-dim italic">
                    No emails found. Try different sources or a more popular target.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
