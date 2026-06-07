import { useState } from "react";
import { authFetch, parseError } from "../api";
import EmptyState from "../components/EmptyState";
import StatsBar from "../components/StatsBar";
import CopyButton from "../components/CopyButton";

type Dork = {
  source: string; label: string; query: string; url: string;
  item_count?: number; error?: string;
};

type Profile = {
  name: string; title: string; url: string; source: string;
};

type EmailGuess = { name: string; email: string; pattern: string };

type FindResp = {
  dorks: Dork[];
  executed: boolean;
  profiles: Profile[];
  email_guesses: EmailGuess[];
  cse_configured: boolean;
};

const SOURCES = [
  { id: "linkedin",        label: "LinkedIn profiles" },
  { id: "linkedin-company", label: "LinkedIn company / jobs" },
  { id: "github",          label: "GitHub" },
  { id: "x",               label: "X (Twitter)" },
  { id: "company-team",    label: "Company team pages" },
];

export default function ProfileFinder() {
  const [company, setCompany] = useState("");
  const [domain, setDomain] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(SOURCES.map((s) => s.id)));
  const [execute, setExecute] = useState(false);
  const [result, setResult] = useState<FindResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function toggle(id: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function go() {
    if (!company.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await authFetch(`/profile-finder/find`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: company.trim(),
          domain: domain.trim(),
          sources: [...picked],
          execute,
        }),
      });
      if (!r.ok) throw new Error(await parseError(r));
      setResult(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">PROFILE FINDER</h2>
        <p className="text-[11px] text-ink-dim">
          Discover people associated with a target company via Google + heuristics.
          We never hit LinkedIn's API directly — only public Google results.
          Cross-references with the People Aggregator's pattern inference to
          guess emails per discovered name.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-3 mb-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-ink-muted tracking-wider mb-1">COMPANY</label>
            <input value={company} onChange={(e) => setCompany(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter") void go(); }}
                   placeholder="Acme Corp"
                   className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                              text-[13px] focus:outline-none focus:border-accent" />
          </div>
          <div>
            <label className="block text-[11px] text-ink-muted tracking-wider mb-1">DOMAIN (optional, helps email guess)</label>
            <input value={domain} onChange={(e) => setDomain(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter") void go(); }}
                   placeholder="acme.com"
                   className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                              text-[13px] font-mono focus:outline-none focus:border-accent" />
          </div>
        </div>

        <div>
          <div className="text-[11px] text-ink-muted tracking-wider mb-1">SOURCES</div>
          <div className="grid grid-cols-3 gap-1 text-[12px]">
            {SOURCES.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={picked.has(s.id)}
                       onChange={() => toggle(s.id)} />
                <span className="text-ink-primary">{s.label}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-[12px] cursor-pointer">
          <input type="checkbox" checked={execute}
                 onChange={(e) => setExecute(e.target.checked)}
                 disabled={!result?.cse_configured && !execute && !loading} />
          <span className={result?.cse_configured === false ? "text-ink-dim" : "text-ink-primary"}>
            Also execute via Google Custom Search (extracts profile snippets)
          </span>
          {result && !result.cse_configured && (
            <span className="text-[10px] text-amber">— configure google_cse_api_key + google_cse_id</span>
          )}
        </label>

        <div className="flex gap-2 items-center">
          <button onClick={go} disabled={loading || !company.trim() || picked.size === 0}
                  className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                             disabled:opacity-40 disabled:cursor-not-allowed">
            {loading ? "Searching…" : "Find Profiles"}
          </button>
          {error && <span className="text-[11px] text-danger">⚠ {error}</span>}
        </div>
      </div>

      {!result && !loading && !error && (
        <EmptyState
          icon="🧑‍💼"
          title="Profile finder"
          description="Discover LinkedIn / GitHub / X / team-page profiles tied to a company via Google dorks (no LinkedIn API)."
          exampleTarget="Acme Corp"
          onExample={setCompany}
        />
      )}

      {result && (
        <div className="space-y-4">
          <StatsBar
            total={result.profiles.length}
            medium={result.email_guesses.length}
            extra={`${result.dorks.length} dorks${result.executed ? " · executed" : ""}`}
          />
          {/* Profiles */}
          {result.executed && (
            <div>
              <div className="text-[11px] text-ink-muted tracking-wider mb-1">
                EXTRACTED PROFILES ({result.profiles.length})
              </div>
              {result.profiles.length === 0 ? (
                <div className="text-[12px] text-ink-dim italic">
                  No profiles parsed from CSE results.
                </div>
              ) : (
                <div className="bg-bg-card border border-divider rounded overflow-hidden">
                  <table className="w-full text-[12px]">
                    <thead className="bg-bg-panel border-b border-divider text-ink-muted text-[10px] tracking-wider">
                      <tr>
                        <th className="text-left px-3 py-1.5">NAME</th>
                        <th className="text-left px-3 py-1.5">TITLE / SNIPPET</th>
                        <th className="text-left px-3 py-1.5 w-24">SOURCE</th>
                        <th className="text-left px-3 py-1.5">LINK</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.profiles.map((p, i) => (
                        <tr
                          key={i}
                          style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                          className="mhp-result-in group border-b border-divider hover:bg-bg-nav-hover"
                        >
                          <td className="px-3 py-1 font-mono text-ink-primary">{p.name}</td>
                          <td className="px-3 py-1 text-ink-muted">{p.title}</td>
                          <td className="px-3 py-1 text-ink-dim uppercase text-[10px]">{p.source}</td>
                          <td className="px-3 py-1 flex items-center gap-2">
                            <a href={p.url} target="_blank" rel="noreferrer"
                               className="text-accent hover:underline text-[11px] truncate inline-block max-w-[200px]">
                              {p.url}
                            </a>
                            <CopyButton text={`${p.name} — ${p.title} (${p.source}): ${p.url}`} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Email guesses */}
          {result.email_guesses.length > 0 && (
            <div>
              <div className="text-[11px] text-ink-muted tracking-wider mb-1">
                EMAIL GUESSES — pattern: <code className="text-amber">{result.email_guesses[0].pattern}</code>
              </div>
              <div className="bg-bg-card border border-divider rounded overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead className="bg-bg-panel border-b border-divider text-ink-muted text-[10px]">
                    <tr>
                      <th className="text-left px-3 py-1.5">NAME</th>
                      <th className="text-left px-3 py-1.5">PREDICTED EMAIL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.email_guesses.map((g, i) => (
                      <tr
                        key={i}
                        style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                        className="mhp-result-in group border-b border-divider hover:bg-bg-nav-hover"
                      >
                        <td className="px-3 py-1 font-mono text-ink-primary">{g.name}</td>
                        <td className="px-3 py-1 font-mono text-phos flex items-center gap-2">
                          {g.email}
                          <CopyButton text={g.email} className="ml-auto" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Dork URLs (always shown — fallback if CSE not configured) */}
          <details open={!result.executed}>
            <summary className="text-[11px] text-ink-muted tracking-wider cursor-pointer hover:text-ink-primary">
              {result.executed ? "RAW DORK QUERIES" : "OPEN MANUALLY IN BROWSER"} ({result.dorks.length})
            </summary>
            <div className="mt-2 space-y-1">
              {result.dorks.map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span className="text-ink-dim uppercase text-[10px] w-32 shrink-0">{d.source}</span>
                  <a href={d.url} target="_blank" rel="noreferrer"
                     className="text-accent hover:underline font-mono truncate flex-1">
                    {d.query}
                  </a>
                  {d.item_count != null && <span className="text-ink-dim text-[10px]">{d.item_count} results</span>}
                  {d.error && <span className="text-danger text-[10px]">{d.error}</span>}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
