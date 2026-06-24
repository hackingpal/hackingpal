import { useState } from "react";
import { api } from "../api";
import EmptyState from "../components/EmptyState";
import StatsBar from "../components/StatsBar";
import CopyButton from "../components/CopyButton";
import { SafeAnchor } from "../components/SafeAnchor";

type Buckets = {
  domain: string;
  total: number;
  interesting: string[];
  js_files: string[];
  api_endpoints: string[];
  all: string[];
};

type Diff = {
  domain: string;
  cutoff: string;
  historical_count: number;
  recent_count: number;
  gone: string[];
  new: string[];
};

type Tab = "interesting" | "js" | "api" | "all" | "diff";

export default function Wayback() {
  const [domain, setDomain] = useState("");
  const [tab, setTab] = useState<Tab>("interesting");
  const [buckets, setBuckets] = useState<Buckets | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (!domain.trim()) return;
    setLoading(true); setError(""); setBuckets(null); setDiff(null);
    try {
      const [b, d] = await Promise.all([
        api<Buckets>(`/wayback/urls/${encodeURIComponent(domain.trim())}`),
        api<Diff>(`/wayback/diff/${encodeURIComponent(domain.trim())}`).catch(() => null as any),
      ]);
      setBuckets(b);
      setDiff(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const lists: Record<Exclude<Tab, "diff">, string[]> = {
    interesting: buckets?.interesting ?? [],
    js: buckets?.js_files ?? [],
    api: buckets?.api_endpoints ?? [],
    all: buckets?.all ?? [],
  };

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">WAYBACK MACHINE</h2>
        <p className="text-[11px] text-ink-dim">
          Pull historical URLs for a domain from the Internet Archive's CDX index.
          Surfaces forgotten endpoints, backup files, exposed configs.
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
                             disabled:opacity-40">{loading ? "Loading…" : "Fetch"}</button>
        </div>
        {error && <div className="text-[11px] text-danger">⚠ {error}</div>}
      </div>

      {!buckets && !loading && !error && (
        <EmptyState
          icon="📜"
          title="Wayback Machine URLs"
          description="Pull historical URLs from Internet Archive's CDX index. Surfaces forgotten endpoints, backups, exposed configs."
          exampleTarget="example.com"
          onExample={setDomain}
          className="mt-4"
        />
      )}

      {buckets && (
        <div className="mt-4">
          <StatsBar
            total={buckets.total}
            critical={buckets.interesting.length}
            medium={buckets.api_endpoints.length}
            low={buckets.js_files.length}
            extra={`${buckets.domain}${diff ? ` · diff: gone ${diff.gone.length}, new ${diff.new.length}` : ""}`}
            className="mb-2"
          />
          <div className="flex gap-2 mb-2 flex-wrap">
            {([
              ["interesting", `Interesting (${buckets.interesting.length})`],
              ["js", `JS (${buckets.js_files.length})`],
              ["api", `API (${buckets.api_endpoints.length})`],
              ["all", `All (${buckets.total})`],
              ...(diff ? [["diff", `Diff (gone ${diff.gone.length}, new ${diff.new.length})`]] : []),
            ] as [Tab, string][]).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                      className={"px-3 py-1 rounded text-[11px] uppercase tracking-wider " +
                        (tab === id ? "bg-accent text-white font-bold"
                          : "bg-bg-base border border-divider text-ink-primary")}>
                {label}
              </button>
            ))}
          </div>

          {tab !== "diff" && (
            <UrlList urls={lists[tab]} />
          )}
          {tab === "diff" && diff && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] text-ink-muted mb-1 tracking-wider">
                  GONE BUT NOT FORGOTTEN ({diff.gone.length}) — historical only
                </div>
                <UrlList urls={diff.gone} accent="amber" />
              </div>
              <div>
                <div className="text-[11px] text-ink-muted mb-1 tracking-wider">
                  NEW ({diff.new.length}) — since {diff.cutoff}
                </div>
                <UrlList urls={diff.new} accent="phos" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UrlList({ urls, accent = "accent" }: { urls: string[]; accent?: string }) {
  if (urls.length === 0)
    return <div className="text-[11px] text-ink-dim italic">no entries</div>;
  return (
    <div className="bg-bg-card border border-divider rounded p-2 max-h-[60vh] overflow-y-auto">
      {urls.map((u, i) => (
        <div
          key={u}
          style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
          className="mhp-result-in group flex items-center gap-2 px-2 py-1"
        >
          <SafeAnchor href={u}
             className={`flex-1 text-[11px] font-mono text-ink-primary hover:text-${accent} truncate`}>
            {u}
          </SafeAnchor>
          <CopyButton text={u} />
        </div>
      ))}
    </div>
  );
}
