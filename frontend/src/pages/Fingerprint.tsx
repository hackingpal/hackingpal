import { useState } from "react";
import { fetchFingerprintBulk, type FingerprintResult } from "../api";

const COMMON = "22, 80, 443, 21, 25, 53, 110, 143, 3306, 5432, 5900, 6379, 8080, 8443";

export default function Fingerprint() {
  const [host, setHost] = useState("127.0.0.1");
  const [portsText, setPortsText] = useState(COMMON);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<FingerprintResult[] | null>(null);
  const [policy, setPolicy] = useState<{ verdict: string; reason: string } | null>(null);

  function parsePorts(s: string): number[] {
    const out = new Set<number>();
    for (const tok of s.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean)) {
      if (tok.includes("-")) {
        const [a, b] = tok.split("-").map((n) => parseInt(n));
        if (Number.isInteger(a) && Number.isInteger(b) && a <= b) {
          for (let p = a; p <= Math.min(b, a + 200); p++) out.add(p);
        }
      } else {
        const n = parseInt(tok);
        if (Number.isInteger(n) && n >= 1 && n <= 65535) out.add(n);
      }
    }
    return [...out].slice(0, 100);
  }

  async function run() {
    const h = host.trim();
    const ports = parsePorts(portsText);
    if (!h || ports.length === 0) return;
    setBusy(true); setError(null); setResults(null); setPolicy(null);
    try {
      const r = await fetchFingerprintBulk(h, ports);
      setResults(r.results);
      setPolicy(r.policy);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3 flex flex-col gap-2">
        <div className="flex items-end gap-6">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">Recon</div>
            <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
              Service Fingerprint
            </h2>
          </div>

          <div className="flex-1 flex gap-2 items-center max-w-3xl">
            <span className="text-ink-dim text-sm select-none">›</span>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="host"
              className="w-48 bg-bg-card border border-divider rounded
                         px-3 py-1.5 text-sm font-mono text-ink-primary
                         placeholder:text-ink-dim
                         focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
                         transition"
              autoCorrect="off"
              spellCheck={false}
            />
            <input
              type="text"
              value={portsText}
              onChange={(e) => setPortsText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") run(); }}
              placeholder="ports — e.g. 22,80,443 or 1000-1010"
              className="flex-1 bg-bg-card border border-divider rounded
                         px-3 py-1.5 text-sm font-mono text-ink-primary
                         placeholder:text-ink-dim
                         focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
                         transition"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              onClick={run}
              disabled={busy}
              className="bg-accent hover:bg-accentDim active:translate-y-px
                         text-white text-xs font-bold tracking-wide
                         px-3.5 py-1.5 rounded transition
                         disabled:opacity-50 disabled:cursor-not-allowed
                         border border-accent/60"
            >
              {busy ? "Probing…" : "▶ Fingerprint"}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {policy?.verdict === "warn" && (
          <div className="rounded-md border-l-4 border-amber/40 border-y border-r border-divider
                          bg-amber/5 px-4 py-2 text-[11px] text-ink-muted font-mono">
            <span className="text-amber">⚠ external target</span> — {policy.reason}
          </div>
        )}

        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-sm font-mono">
            Error — {error}
          </div>
        )}

        {!results && !error && !busy && <EmptyState />}

        {results && <ResultsTable results={results} />}
      </div>
    </div>
  );
}

function ResultsTable({ results }: { results: FingerprintResult[] }) {
  const open = results.filter((r) => r.open);
  const closed = results.filter((r) => !r.open);

  return (
    <>
      <div className="text-[11px] text-ink-muted font-mono">
        <span className="text-phos">{open.length}</span> open · {closed.length} closed
      </div>

      {open.length > 0 && (
        <section className="rounded-md overflow-hidden border border-divider">
          <header className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]
                             text-ink-dim border-b border-divider bg-bg-panel">
            Open ports
          </header>
          <div className="bg-bg-card text-xs font-mono">
            <div className="grid grid-cols-[60px_120px_1fr_60px] gap-x-3 px-3 py-2
                            border-b border-divider text-ink-dim text-[10px] uppercase tracking-wider">
              <span>Port</span>
              <span>Service</span>
              <span>Version / banner</span>
              <span className="text-right">ms</span>
            </div>
            {open.map((r, i) => (
              <ResultRow key={i} r={r} />
            ))}
          </div>
        </section>
      )}

      {closed.length > 0 && (
        <details className="text-xs font-mono">
          <summary className="cursor-pointer text-ink-dim
                              hover:text-ink-primary py-1 select-none">
            Closed / unreachable ({closed.length})
          </summary>
          <div className="grid grid-cols-[60px_1fr_60px] gap-x-3 mt-1 pl-3">
            {closed.map((r, i) => (
              <div key={i} className="contents">
                <span className="text-ink-dim">{r.port}</span>
                <span className="text-ink-muted">{r.error ?? "—"}</span>
                <span className="text-right text-ink-dim">{r.elapsed_ms}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

function ResultRow({ r }: { r: FingerprintResult }) {
  const ex = r.extras as Record<string, unknown>;
  const headers = (ex.headers as Record<string, string>) ?? null;
  const caps = (ex.capabilities as string[]) ?? null;
  const isHttp = r.service_guess === "http" || r.service_guess === "https";
  const tlsErr = typeof ex.tls_error === "string" ? (ex.tls_error as string) : null;

  return (
    <div className="px-3 py-2 border-b border-divider/50">
      <div className="grid grid-cols-[60px_120px_1fr_60px] gap-x-3 items-start">
        <span className="text-accent">{r.port}</span>
        <span className="text-ink-primary">{r.service_guess}</span>
        <div className="flex flex-col gap-0.5">
          {r.version && <span className="text-ink-primary">{r.version}</span>}
          {!r.version && r.banner_lines.length > 0 && (
            <span className="text-ink-muted">{r.banner_lines[0]}</span>
          )}
          {tlsErr && <span className="text-danger">TLS: {tlsErr}</span>}
        </div>
        <span className="text-right text-ink-dim">{r.elapsed_ms}</span>
      </div>

      {(isHttp && headers && Object.keys(headers).length > 0) && (
        <div className="grid grid-cols-[60px_120px_1fr_60px] gap-x-3 mt-1">
          <span />
          <span />
          <div className="text-ink-muted">
            {Object.entries(headers).map(([k, v]) => (
              <div key={k}><span className="text-ink-dim">{k}:</span> {v}</div>
            ))}
          </div>
          <span />
        </div>
      )}

      {caps && caps.length > 0 && (
        <div className="grid grid-cols-[60px_120px_1fr_60px] gap-x-3 mt-1">
          <span /><span />
          <div className="text-ink-muted text-[11px]">
            EHLO: {caps.slice(0, 8).join(", ")}{caps.length > 8 ? "…" : ""}
          </div>
          <span />
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full min-h-[260px] flex items-center justify-center">
      <div className="text-center max-w-md">
        <pre className="text-ink-dim text-[11px] leading-tight select-none">
{`        ┌──────────────┐
        │ FINGERPRINT  │
        │  banner+ver  │
        └──────────────┘`}
        </pre>
        <div className="mt-4 text-xs text-ink-muted">
          Probes SSH · HTTP(S) · SMTP · FTP · POP3 · IMAP · MySQL · Postgres · Redis · VNC<br />
          Falls back to a generic banner grab on unknown ports.
        </div>
      </div>
    </div>
  );
}
