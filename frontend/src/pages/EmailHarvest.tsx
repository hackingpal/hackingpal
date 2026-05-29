import { useState } from "react";
import { api } from "../api";

type EmailRow = { email: string; sources: string[] };
type Dork = { query: string; url: string };
type Resp = {
  domain: string; count: number;
  emails: EmailRow[];
  by_source: Record<string, number>;
  dorks: Dork[];
  hunter_configured: boolean;
};

export default function EmailHarvest() {
  const [domain, setDomain] = useState("");
  const [resp, setResp] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (!domain.trim()) return;
    setLoading(true); setError(""); setResp(null);
    try {
      const r = await api<Resp>(`/osint/emails/${encodeURIComponent(domain.trim())}`);
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
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">EMAIL HARVEST</h2>
        <p className="text-[11px] text-ink-dim">
          Aggregate email addresses for a target domain from crt.sh, live scraping, and
          Hunter.io (if configured).
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
                             disabled:opacity-40">{loading ? "Searching…" : "Harvest"}</button>
        </div>
        {error && <div className="text-[11px] text-danger">⚠ {error}</div>}
      </div>

      {resp && (
        <div className="mt-4 space-y-3">
          <div className="flex gap-2 flex-wrap text-[11px]">
            {Object.entries(resp.by_source).map(([k, v]) => (
              <span key={k} className="bg-bg-base border border-divider rounded px-2 py-0.5">
                {k}: <span className="text-accent">{v}</span>
              </span>
            ))}
            {!resp.hunter_configured && (
              <span className="text-amber">Hunter.io key not configured</span>
            )}
          </div>

          <div className="bg-bg-card border border-divider rounded">
            <div className="px-3 py-1.5 text-[11px] text-ink-muted tracking-wider border-b border-divider">
              {resp.count} EMAILS
            </div>
            {resp.emails.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-ink-dim italic">No emails found.</div>
            ) : (
              <table className="w-full text-[11px] font-mono">
                <tbody>
                  {resp.emails.map((e) => (
                    <tr key={e.email} className="border-b border-divider last:border-0">
                      <td className="px-3 py-1.5 text-ink-primary">{e.email}</td>
                      <td className="px-3 py-1.5 text-ink-dim">{e.sources.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {resp.dorks.length > 0 && (
            <div className="bg-bg-card border border-divider rounded p-3">
              <div className="text-[11px] text-ink-muted tracking-wider mb-2">
                MANUAL DORKS (open in browser)
              </div>
              <div className="space-y-1">
                {resp.dorks.map((d) => (
                  <a key={d.query} href={d.url} target="_blank" rel="noreferrer"
                     className="block text-[11px] font-mono text-accent hover:underline">
                    {d.query}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
