import { useState } from "react";
import { api } from "../api";
import EmptyState from "../components/EmptyState";
import StatsBar from "../components/StatsBar";
import CopyButton from "../components/CopyButton";
import SeverityBadge from "../components/SeverityBadge";

type Result = {
  id: string; url: string; domain: string; ip: string; country: string;
  server: string; screenshot: string; result_url: string; submitted: string;
  malicious: boolean; score: number; tags: string[];
};

type Resp = {
  domain: string; count: number; total: number; malicious: number;
  results: Result[];
};

export default function UrlScan() {
  const [domain, setDomain] = useState("");
  const [resp, setResp] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (!domain.trim()) return;
    setLoading(true); setError(""); setResp(null);
    try {
      const r = await api<Resp>(`/osint/urlscan/${encodeURIComponent(domain.trim())}`);
      setResp(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">URLSCAN</h2>
        <p className="text-[11px] text-ink-dim">
          Search public urlscan.io history for a domain. Shows past scans, screenshots,
          detected tech, and any malicious verdicts. We don't submit new scans (those are
          publicly visible).
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
                             disabled:opacity-40">{loading ? "Loading…" : "Search"}</button>
        </div>
        {error && <div className="text-[11px] text-danger">⚠ {error}</div>}
      </div>

      {!resp && !loading && !error && (
        <EmptyState
          icon="🔭"
          title="urlscan.io history"
          description="Search public urlscan history for a domain. Past scans, screenshots, verdicts, detected tech."
          exampleTarget="example.com"
          onExample={setDomain}
          className="mt-4"
        />
      )}

      {resp && (
        <div className="mt-4 space-y-2">
          <StatsBar
            total={resp.count}
            critical={resp.malicious}
            extra={`${resp.count} of ${resp.total} scans · ${resp.domain}`}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {resp.results.map((r, i) => {
              const copyText = `${r.url} ${r.malicious ? "[MALICIOUS] " : ""}— ${r.domain} · ${r.ip || "—"} · ${r.country || "—"} · ${r.submitted?.slice(0, 10)}`;
              return (
                <div
                  key={r.id}
                  style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                  className={"mhp-result-in group bg-bg-card border rounded p-3 " +
                    (r.malicious ? "border-danger/60 mhp-critical-pulse" : "border-divider")}
                >
                  <div className="flex justify-between items-start gap-2 mb-1">
                    <a href={r.result_url} target="_blank" rel="noreferrer"
                       className="text-[12px] font-mono text-accent hover:underline truncate flex-1">
                      {r.url}
                    </a>
                    {r.malicious && <SeverityBadge severity="critical" label="MALICIOUS" />}
                    <CopyButton text={copyText} />
                  </div>
                  <div className="text-[10px] text-ink-dim mb-2">
                    {r.domain} · {r.ip || "—"} · {r.country || "—"} · {r.submitted?.slice(0, 10)}
                  </div>
                  {r.screenshot && (
                    <img src={r.screenshot} alt="screenshot"
                         className="w-full h-32 object-cover rounded border border-divider" />
                  )}
                  {r.tags?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {r.tags.map((t) => (
                        <span key={t} className="text-[10px] bg-bg-base border border-divider rounded px-1">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
