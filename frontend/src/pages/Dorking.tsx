import { useEffect, useState } from "react";
import { api, authFetch, parseError } from "../api";
import EmptyState from "../components/EmptyState";
import StatsBar from "../components/StatsBar";
import CopyButton from "../components/CopyButton";
import { SafeAnchor } from "../components/SafeAnchor";

type Category = {
  id: string;
  count: number;
};

type DorkResultItem = { title: string; link: string; snippet: string };
type Dork = {
  category: string;
  query: string;
  url: string;
  items?: DorkResultItem[];
  error?: string;
};

const CAT_DESCRIPTIONS: Record<string, string> = {
  files:      "PDFs, docs, sql dumps, backups, logs, configs",
  admin:      "Admin / login / dashboard endpoints",
  leaks:      "Exposed passwords, keys, indices; cross-site mentions",
  errors:     "Stack traces, DB errors, framework error pages",
  configs:    ".env / .yml / .git / DB_PASSWORD literals",
  discovery:  "site: + subdomain wildcards + dev/staging/beta",
  archives:   "Wayback Machine, archive.org, cachedview",
};

export default function Dorking() {
  const [target, setTarget] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(["files", "leaks", "admin", "discovery"]));
  const [execute, setExecute] = useState(false);
  const [cseConfigured, setCseConfigured] = useState(false);

  const [dorks, setDorks] = useState<Dork[]>([]);
  const [executed, setExecuted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ categories: Category[] }>("/dorking/categories")
      .then((r) => setCategories(r.categories)).catch(() => {});
    api<{ cse_configured: boolean }>("/dorking/status")
      .then((r) => setCseConfigured(r.cse_configured)).catch(() => {});
  }, []);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function go() {
    if (!target.trim()) return;
    setLoading(true); setError(""); setDorks([]); setExecuted(false);
    try {
      const r = await authFetch(`/dorking/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: target.trim(),
          categories: [...selected],
          execute,
        }),
      });
      if (!r.ok) throw new Error(await parseError(r));
      const data = await r.json();
      setDorks(data.dorks);
      setExecuted(data.executed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">GOOGLE DORKING</h2>
        <p className="text-[11px] text-ink-dim">
          Generate Google dorks for a target across {categories.length || "several"} categories.
          By default we just produce queries + clickable links you open in your browser. Tick
          "Execute" to also run them via Google's Custom Search API.
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
            {loading ? "Generating…" : "Generate"}
          </button>
        </div>

        <div>
          <div className="text-[11px] text-ink-muted tracking-wider mb-1">CATEGORIES</div>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            {categories.map((c) => (
              <label key={c.id} className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={selected.has(c.id)}
                       onChange={() => toggle(c.id)}
                       className="mt-1" />
                <div>
                  <div className="text-ink-primary uppercase tracking-wider text-[11px]">
                    {c.id} <span className="text-ink-dim normal-case">({c.count})</span>
                  </div>
                  <div className="text-ink-dim text-[10px]">
                    {CAT_DESCRIPTIONS[c.id] ?? ""}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-[12px] cursor-pointer">
          <input type="checkbox" checked={execute}
                 onChange={(e) => setExecute(e.target.checked)}
                 disabled={!cseConfigured} />
          <span className={cseConfigured ? "text-ink-primary" : "text-ink-dim"}>
            Also execute via Google Custom Search API
          </span>
          {!cseConfigured && (
            <span className="text-[10px] text-amber">
              (Configure <code>google_cse_api_key</code> + <code>google_cse_id</code> first)
            </span>
          )}
        </label>

        {!cseConfigured && (
          <details className="text-[11px] text-ink-dim">
            <summary className="cursor-pointer text-ink-muted">How to set up Custom Search</summary>
            <ol className="list-decimal pl-5 mt-1 space-y-1 text-[11px]">
              <li>Get an API key at console.cloud.google.com → APIs & Services → Credentials.</li>
              <li>Create a Custom Search Engine at programmablesearchengine.google.com — set it to "search the entire web".</li>
              <li>Copy the search engine's <b>cx</b> ID.</li>
              <li>Then run:
              <pre className="bg-bg-base border border-divider rounded p-2 mt-1 text-[11px]
                              text-phos">
{`curl -X POST http://127.0.0.1:8765/settings/keys/google_cse_api_key \\
  -H 'Content-Type: application/json' -d '{"value":"<API-KEY>"}'
curl -X POST http://127.0.0.1:8765/settings/keys/google_cse_id \\
  -H 'Content-Type: application/json' -d '{"value":"<CX-ID>"}'`}
              </pre>
              </li>
              <li>Free tier: 100 queries/day.</li>
            </ol>
          </details>
        )}

        {error && <div className="text-[12px] text-danger">⚠ {error}</div>}
      </div>

      {dorks.length === 0 && !loading && !error && (
        <EmptyState
          icon="🕵️"
          title="Google dorking"
          description="Generate (and optionally execute via CSE) targeted dorks for files, admin paths, leaks, errors, configs."
          exampleTarget="example.com"
          onExample={setTarget}
        />
      )}

      {dorks.length > 0 && (
        <div className="space-y-2">
          <StatsBar
            total={dorks.length}
            critical={dorks.reduce((s, d) => s + (d.items?.length ?? 0), 0)}
            extra={`${dorks.length} dorks${executed ? " · executed via CSE" : ""}`}
          />
          {dorks.map((d, i) => {
            const copyText = d.query;
            return (
              <div
                key={i}
                style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                className="mhp-result-in group border border-divider rounded p-2"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] uppercase text-accent border border-accent/40 rounded px-1.5">
                    {d.category}
                  </span>
                  <SafeAnchor href={d.url}
                     className="text-[12px] font-mono text-ink-primary hover:text-accent truncate flex-1">
                    {d.query}
                  </SafeAnchor>
                  <SafeAnchor href={d.url}
                     className="text-[10px] text-ink-muted hover:text-accent">↗</SafeAnchor>
                  <CopyButton text={copyText} />
                </div>
                {d.error && <div className="text-[11px] text-amber">{d.error}</div>}
                {d.items && d.items.length > 0 && (
                  <div className="pl-3 border-l-2 border-divider mt-2 space-y-2">
                    {d.items.map((it, j) => (
                      <div key={j} className="group/inner flex items-start gap-2">
                        <div className="flex-1">
                          <SafeAnchor href={it.link}
                             className="text-[12px] text-accent hover:underline">{it.title}</SafeAnchor>
                          <div className="text-[10px] text-ink-dim font-mono truncate">{it.link}</div>
                          {it.snippet && <div className="text-[11px] text-ink-muted">{it.snippet}</div>}
                        </div>
                        <CopyButton text={it.link} />
                      </div>
                    ))}
                  </div>
                )}
                {executed && d.items && d.items.length === 0 && !d.error && (
                  <div className="text-[11px] text-ink-dim italic pl-3">No results</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
