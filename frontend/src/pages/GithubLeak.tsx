import { useEffect, useState } from "react";
import { api, authFetch, parseError } from "../api";

type Pattern = { label: string; template: string };

type LeakItem = {
  name: string;
  path: string;
  html_url: string;
  repository: { full_name: string; html_url: string; stars: number };
  snippets: string[];
};

type LeakResult = {
  label: string;
  query: string;
  items: LeakItem[];
  total_count?: number;
  error?: string;
};

export default function GithubLeak() {
  const [target, setTarget] = useState("");
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState("");
  const [authed, setAuthed] = useState(false);
  const [results, setResults] = useState<LeakResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ patterns: Pattern[] }>("/github-leak/patterns")
      .then((r) => {
        setPatterns(r.patterns);
        // Default-on: the highest-signal ones
        setSelected(new Set(["password", "api-key", "private-key", "aws-key", "env"]));
      }).catch(() => {});
    api<{ authenticated: boolean }>("/github-leak/status")
      .then((r) => setAuthed(r.authenticated)).catch(() => {});
  }, []);

  function toggle(label: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  }

  async function go() {
    if (!target.trim()) return;
    setLoading(true); setError(""); setResults([]);
    try {
      const custom_queries = custom.split("\n").map((s) => s.trim()).filter(Boolean);
      const r = await authFetch(`/github-leak/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: target.trim(),
          patterns: selected.size === patterns.length ? null : [...selected],
          custom_queries,
        }),
      });
      if (!r.ok) throw new Error(await parseError(r));
      const data = await r.json();
      setResults(data.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const totalHits = results.reduce((sum, r) => sum + r.items.length, 0);

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">GITHUB LEAK SCANNER</h2>
        <p className="text-[11px] text-ink-dim">
          Search public GitHub code for credentials and config files referencing
          a target. Strongly recommend a personal access token —
          {authed ? <span className="text-phos"> token configured ✓</span>
                  : <span className="text-amber"> no token; rate-limited to 10 req/min</span>}.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-3 mb-4">
        <div className="flex gap-2">
          <input value={target} onChange={(e) => setTarget(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") void go(); }}
                 placeholder="target.com or company keyword"
                 className="flex-1 bg-bg-base border border-divider rounded px-2 py-1.5
                            text-[13px] font-mono focus:outline-none focus:border-accent" />
          <button onClick={go} disabled={loading || !target.trim() || selected.size === 0}
                  className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                             disabled:opacity-40 disabled:cursor-not-allowed">
            {loading ? "Scanning…" : "Scan"}
          </button>
        </div>

        <div>
          <div className="text-[11px] text-ink-muted tracking-wider mb-1">PATTERNS</div>
          <div className="grid grid-cols-3 gap-1 text-[11px]">
            {patterns.map((p) => (
              <label key={p.label} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={selected.has(p.label)}
                       onChange={() => toggle(p.label)} />
                <span className="text-ink-primary">{p.label}</span>
              </label>
            ))}
          </div>
        </div>

        <details>
          <summary className="text-[11px] text-ink-muted cursor-pointer">Custom queries (one per line)</summary>
          <textarea value={custom} onChange={(e) => setCustom(e.target.value)}
                    rows={3} placeholder='"target.com" "production"'
                    className="w-full mt-1 bg-bg-base border border-divider rounded px-2 py-1
                               text-[12px] font-mono focus:outline-none focus:border-accent" />
        </details>

        {!authed && (
          <details className="text-[11px] text-ink-dim">
            <summary className="cursor-pointer text-ink-muted">How to add a GitHub token</summary>
            <p className="mt-1">
              Create a personal access token at github.com/settings/tokens (no scopes needed for public-code search). Then:
            </p>
            <pre className="bg-bg-base border border-divider rounded p-2 mt-1 text-[11px] text-phos">
{`curl -X POST http://127.0.0.1:8765/settings/keys/github_token \\
  -H 'Content-Type: application/json' -d '{"value":"ghp_..."}'`}
            </pre>
          </details>
        )}

        {error && <div className="text-[12px] text-danger">⚠ {error}</div>}
      </div>

      {results.length > 0 && (
        <div className="space-y-3">
          <div className="text-[11px] text-ink-muted tracking-wider">
            {totalHits} matches across {results.length} queries
          </div>
          {results.map((r, i) => (
            <div key={i} className="border border-divider rounded">
              <div className="flex items-center gap-2 px-3 py-2 bg-bg-panel border-b border-divider">
                <span className="text-[10px] uppercase text-accent border border-accent/40 rounded px-1.5">
                  {r.label}
                </span>
                <span className="text-[11px] font-mono text-ink-muted truncate flex-1">
                  {r.query}
                </span>
                {r.total_count != null && (
                  <span className="text-[10px] text-ink-dim">
                    {r.items.length} shown of {r.total_count.toLocaleString()}
                  </span>
                )}
              </div>
              {r.error && (
                <div className="px-3 py-2 text-[11px] text-amber">{r.error}</div>
              )}
              {r.items.length === 0 && !r.error && (
                <div className="px-3 py-2 text-[11px] text-ink-dim italic">No matches.</div>
              )}
              <div className="divide-y divide-divider">
                {r.items.map((it, j) => (
                  <div key={j} className="px-3 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      <a href={it.html_url} target="_blank" rel="noreferrer"
                         className="text-[12px] text-accent hover:underline truncate flex-1 font-mono">
                        {it.path}
                      </a>
                      <a href={it.repository.html_url} target="_blank" rel="noreferrer"
                         className="text-[10px] text-ink-muted hover:text-ink-primary">
                        {it.repository.full_name}
                      </a>
                      {it.repository.stars > 0 && (
                        <span className="text-[10px] text-ink-dim">★{it.repository.stars}</span>
                      )}
                    </div>
                    {it.snippets.map((s, k) => (
                      <pre key={k}
                           className="bg-bg-panel border border-divider rounded p-1.5 mt-1
                                      text-[11px] font-mono text-phos
                                      whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                        {s}
                      </pre>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
