import { useMemo, useState } from "react";
import { api } from "../api";

type Dork = { category: string; dork: string; description: string };
type Resp = {
  domain: string; count: number;
  dorks: Dork[];
  engines: Record<string, string>;
};

export default function DorksGen() {
  const [domain, setDomain] = useState("");
  const [resp, setResp] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<string>("all");

  async function run() {
    if (!domain.trim()) return;
    setLoading(true); setError(""); setResp(null);
    try {
      const r = await api<Resp>(`/osint/dorks/${encodeURIComponent(domain.trim())}`);
      setResp(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const cats = useMemo(() => {
    if (!resp) return [];
    const seen = new Set<string>();
    return resp.dorks.map((d) => d.category).filter((c) => {
      if (seen.has(c)) return false;
      seen.add(c); return true;
    });
  }, [resp]);

  const visible = (resp?.dorks ?? []).filter((d) =>
    filter === "all" || d.category === filter,
  );

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">DORK GENERATOR</h2>
        <p className="text-[11px] text-ink-dim">
          Build Google / Bing / DuckDuckGo dork strings for a target domain. Open each in
          your own browser — we don't scrape search engines directly.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-2 max-w-2xl">
        <label className="block text-[11px] text-ink-muted tracking-wider">DOMAIN</label>
        <div className="flex gap-2">
          <input value={domain} onChange={(e) => setDomain(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") run(); }}
                 placeholder="example.com"
                 className="flex-1 bg-bg-base border border-divider rounded px-2 py-1.5
                            text-[13px] font-mono focus:outline-none focus:border-accent" />
          <button onClick={run} disabled={loading || !domain.trim()}
                  className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                             disabled:opacity-40">{loading ? "Building…" : "Generate"}</button>
        </div>
        {error && <div className="text-[11px] text-danger">⚠ {error}</div>}
      </div>

      {resp && (
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap gap-1">
            <button onClick={() => setFilter("all")}
                    className={"px-2 py-1 rounded text-[11px] uppercase tracking-wider " +
                      (filter === "all" ? "bg-accent text-white font-bold"
                        : "bg-bg-base border border-divider text-ink-primary")}>
              all ({resp.count})
            </button>
            {cats.map((c) => (
              <button key={c} onClick={() => setFilter(c)}
                      className={"px-2 py-1 rounded text-[11px] uppercase tracking-wider " +
                        (filter === c ? "bg-accent text-white font-bold"
                          : "bg-bg-base border border-divider text-ink-primary")}>
                {c}
              </button>
            ))}
          </div>

          <div className="space-y-1">
            {visible.map((d, i) => (
              <div key={`${d.category}-${i}`}
                   className="bg-bg-card border border-divider rounded p-2 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-mono text-ink-primary truncate">{d.dork}</div>
                  <div className="text-[10px] text-ink-dim">{d.category} · {d.description}</div>
                </div>
                <div className="flex gap-1">
                  {Object.entries(resp.engines).map(([name, base]) => (
                    <a key={name} href={`${base}${encodeURIComponent(d.dork)}`}
                       target="_blank" rel="noreferrer"
                       className="text-[10px] uppercase tracking-wider px-2 py-1 rounded
                                  border border-divider text-ink-muted hover:text-accent">
                      {name.slice(0, 3)}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
