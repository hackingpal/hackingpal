import { useEffect, useState } from "react";
import { api, BACKEND_URL, parseError } from "../api";

type Service = "shodan" | "censys";

type Row = {
  ip: string;
  port: number | null;
  service: string;
  banner: string;
  country: string;
  org: string;
  hostnames: string[];
  timestamp?: string;
  transport?: string;
};

type QueryResponse = {
  service: Service;
  query: string;
  total: number;
  rows: Row[];
};

const SHODAN_HINTS = [
  'product:nginx country:US',
  'org:"Acme Corp" port:22',
  'http.html:"phpMyAdmin"',
  'hostname:example.com',
  'ssl.cert.subject.cn:*.example.com',
];

const CENSYS_HINTS = [
  'services.service_name: HTTP and services.port: 8080',
  'autonomous_system.name: "ACME"',
  'services.tls.certificates.leaf_data.subject.common_name: *.example.com',
  'ip: 1.1.1.1',
];

export default function ShodanCensys() {
  const [service, setService] = useState<Service>("shodan");
  const [query, setQuery] = useState("");
  const [shodanReady, setShodanReady] = useState(false);
  const [censysReady, setCensysReady] = useState(false);
  const [results, setResults] = useState<QueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ shodan_configured: boolean; censys_configured: boolean }>("/shodan-censys/status")
      .then((r) => { setShodanReady(r.shodan_configured); setCensysReady(r.censys_configured); })
      .catch(() => {});
  }, []);

  async function go() {
    if (!query.trim()) return;
    setLoading(true); setError(""); setResults(null);
    try {
      const r = await fetch(`${BACKEND_URL}/shodan-censys/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, query: query.trim() }),
      });
      if (!r.ok) throw new Error(await parseError(r));
      setResults(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const ready = service === "shodan" ? shodanReady : censysReady;
  const hints = service === "shodan" ? SHODAN_HINTS : CENSYS_HINTS;

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">SHODAN · CENSYS</h2>
        <p className="text-[11px] text-ink-dim">
          Query both internet-scanning services with their native syntax.
          Results normalized to a single table.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 space-y-3 mb-4">
        <div className="flex gap-2">
          {(["shodan", "censys"] as Service[]).map((s) => (
            <button key={s} onClick={() => setService(s)}
                    className={
                      "px-3 py-1.5 rounded text-[12px] tracking-wider uppercase " +
                      (service === s
                        ? "bg-accent text-white font-bold"
                        : "bg-bg-base border border-divider text-ink-primary hover:bg-bg-nav-hover")
                    }>
              {s}{s === "shodan" && shodanReady ? " ✓" : ""}
                {s === "censys" && censysReady ? " ✓" : ""}
            </button>
          ))}
        </div>

        <input value={query} onChange={(e) => setQuery(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") void go(); }}
               placeholder={service === "shodan"
                 ? 'product:nginx country:US'
                 : 'services.service_name: HTTP and services.port: 8080'}
               disabled={!ready}
               className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                          text-[13px] font-mono focus:outline-none focus:border-accent
                          disabled:opacity-50" />

        <div className="flex items-center gap-2">
          <button onClick={go} disabled={loading || !query.trim() || !ready}
                  className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                             disabled:opacity-40 disabled:cursor-not-allowed">
            {loading ? "Querying…" : "Query"}
          </button>
          {!ready && (
            <span className="text-[11px] text-amber">
              {service === "shodan"
                ? "Add shodan_api_key to use Shodan"
                : "Add censys_api_id + censys_api_secret to use Censys"}
            </span>
          )}
          {error && <span className="text-[11px] text-danger">⚠ {error}</span>}
        </div>

        <div>
          <div className="text-[10px] text-ink-muted tracking-wider mb-1">
            QUERY EXAMPLES ({service})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {hints.map((h) => (
              <button key={h} onClick={() => setQuery(h)}
                      className="text-[10px] font-mono px-2 py-0.5 rounded
                                 bg-bg-base border border-divider
                                 text-ink-muted hover:text-ink-primary hover:border-accent">
                {h}
              </button>
            ))}
          </div>
        </div>

        {!ready && (
          <details className="text-[11px] text-ink-dim">
            <summary className="cursor-pointer text-ink-muted">
              How to set up {service === "shodan" ? "Shodan" : "Censys"}
            </summary>
            {service === "shodan" ? (
              <pre className="bg-bg-base border border-divider rounded p-2 mt-1 text-[11px] text-phos">
{`# Get key from account.shodan.io
curl -X POST http://127.0.0.1:8765/settings/keys/shodan_api_key \\
  -H 'Content-Type: application/json' -d '{"value":"<key>"}'`}
              </pre>
            ) : (
              <pre className="bg-bg-base border border-divider rounded p-2 mt-1 text-[11px] text-phos">
{`# Get id + secret from accounts.censys.io
curl -X POST http://127.0.0.1:8765/settings/keys/censys_api_id \\
  -H 'Content-Type: application/json' -d '{"value":"<api-id>"}'
curl -X POST http://127.0.0.1:8765/settings/keys/censys_api_secret \\
  -H 'Content-Type: application/json' -d '{"value":"<secret>"}'`}
              </pre>
            )}
          </details>
        )}
      </div>

      {results && (
        <div>
          <div className="text-[11px] text-ink-muted tracking-wider mb-2">
            {results.rows.length} rows · total matches: {results.total.toLocaleString()}
          </div>
          <div className="bg-bg-card border border-divider rounded overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-bg-panel border-b border-divider">
                <tr className="text-ink-muted text-[10px] tracking-wider">
                  <th className="text-left px-3 py-1.5">IP</th>
                  <th className="text-left px-3 py-1.5 w-16">PORT</th>
                  <th className="text-left px-3 py-1.5">SERVICE</th>
                  <th className="text-left px-3 py-1.5 w-12">CC</th>
                  <th className="text-left px-3 py-1.5">ORG</th>
                  <th className="text-left px-3 py-1.5">HOSTNAMES</th>
                </tr>
              </thead>
              <tbody>
                {results.rows.map((r, i) => (
                  <tr key={i} className="border-b border-divider hover:bg-bg-nav-hover align-top">
                    <td className="px-3 py-1.5 font-mono text-accent">{r.ip}</td>
                    <td className="px-3 py-1.5 font-mono text-amber tabular-nums">{r.port ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-ink-primary">{r.service}</td>
                    <td className="px-3 py-1.5 text-ink-dim uppercase">{r.country}</td>
                    <td className="px-3 py-1.5 text-ink-muted truncate max-w-[160px]" title={r.org}>{r.org}</td>
                    <td className="px-3 py-1.5 text-ink-muted truncate max-w-[200px]">
                      {r.hostnames.slice(0, 3).join(", ")}{r.hostnames.length > 3 ? "…" : ""}
                    </td>
                  </tr>
                ))}
                {results.rows.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-dim italic">
                    No matches.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Expandable banner details below */}
          {results.rows.some((r) => r.banner) && (
            <details className="mt-3">
              <summary className="text-[11px] text-ink-muted cursor-pointer">
                Show banners
              </summary>
              <div className="space-y-2 mt-2">
                {results.rows.filter((r) => r.banner).map((r, i) => (
                  <div key={i} className="border border-divider rounded p-2">
                    <div className="text-[11px] font-mono text-accent mb-1">
                      {r.ip}:{r.port} · {r.service}
                    </div>
                    <pre className="text-[10px] font-mono text-phos whitespace-pre-wrap
                                    bg-bg-panel border border-divider rounded p-1.5
                                    max-h-40 overflow-y-auto">
                      {r.banner}
                    </pre>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
