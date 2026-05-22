import { useEffect, useState } from "react";
import { api } from "../api";

type Finding = {
  severity: "critical" | "high" | "medium" | "low" | "info";
  source: string;
  title: string;
  detail: string;
  evidence?: unknown;
};

type ScanResp = {
  home: string;
  findings: Finding[];
  sources: Record<string, any>;
};

const SEV: Record<string, string> = {
  critical: "border-danger/40 bg-danger/10 text-danger",
  high:     "border-danger/40 bg-danger/10 text-danger",
  medium:   "border-amber/40 bg-amber/10 text-amber",
  low:      "border-accent/30 bg-accent/5 text-accent",
  info:     "border-divider text-ink-muted",
};

export default function CredHarvest() {
  const [result, setResult] = useState<ScanResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function scan() {
    setLoading(true); setError("");
    try {
      setResult(await api<ScanResp>("/cred-harvest/scan"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void scan(); }, []);

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="flex items-center mb-3 gap-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">CREDENTIAL HARVESTER</h2>
        <span className="text-[11px] text-ink-dim">
          {result ? `${result.findings.length} findings · scanning ${result.home}` : ""}
        </span>
        <span className="flex-1" />
        <button onClick={scan} disabled={loading}
                className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold disabled:opacity-40">
          {loading ? "Scanning…" : "Rescan"}
        </button>
      </header>

      <p className="text-[11px] text-ink-dim mb-4">
        Read-only audit of credential stores on this machine. Everything stays
        local; secrets are redacted in the response payload (only last 4 chars
        of any detected token are shown).
      </p>

      {error && <div className="text-[12px] text-danger mb-2">⚠ {error}</div>}

      {result && (
        <>
          {/* Findings */}
          <div className="mb-4">
            <div className="text-[11px] text-ink-muted tracking-wider mb-2">
              FINDINGS ({result.findings.length})
            </div>
            {result.findings.length === 0 ? (
              <div className="text-[12px] text-phos">✓ No issues flagged.</div>
            ) : (
              <div className="space-y-2">
                {result.findings.map((f, i) => (
                  <div key={i} className={"border rounded p-3 " + SEV[f.severity]}>
                    <div className="flex items-center gap-2 mb-1 text-[11px]">
                      <span className="font-bold uppercase tracking-wider">{f.severity}</span>
                      <span className="text-ink-dim text-[10px] uppercase border border-divider rounded px-1">
                        {f.source}
                      </span>
                      <span className="text-ink-primary font-bold text-[12px] ml-1">{f.title}</span>
                    </div>
                    <div className="text-[12px] text-ink-muted">{f.detail}</div>
                    {f.evidence !== undefined && (
                      <details className="mt-1">
                        <summary className="text-[10px] text-ink-dim cursor-pointer">Evidence</summary>
                        <pre className="text-[10px] font-mono text-phos bg-bg-panel border border-divider
                                        rounded p-1.5 mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap">
                          {JSON.stringify(f.evidence, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Per-source details */}
          <div className="mb-4">
            <div className="text-[11px] text-ink-muted tracking-wider mb-2">SOURCES</div>
            <div className="space-y-1">
              {Object.entries(result.sources).map(([name, data]) => (
                <details key={name}>
                  <summary className="text-[12px] text-ink-primary cursor-pointer hover:text-accent">
                    <span className="font-mono uppercase text-[10px] text-ink-muted mr-2">{name}</span>
                    {summarize(name, data)}
                  </summary>
                  <pre className="bg-bg-panel border border-divider rounded p-2 mt-1
                                  text-[11px] font-mono text-phos max-h-64 overflow-y-auto
                                  whitespace-pre-wrap">
                    {JSON.stringify(data, null, 2)}
                  </pre>
                </details>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function summarize(_name: string, data: any): string {
  if (Array.isArray(data)) return `${data.length} entries`;
  if (typeof data !== "object" || data === null) return String(data);
  const keys = Object.entries(data).map(([k, v]) => {
    if (typeof v === "boolean") return v ? k : null;
    if (Array.isArray(v)) return `${k}=${v.length}`;
    return `${k}=${v}`;
  }).filter(Boolean);
  return keys.slice(0, 5).join(", ") || "(empty)";
}
