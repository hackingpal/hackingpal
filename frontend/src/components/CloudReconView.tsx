// Shared "cloud recon" view used by AWS, Azure, GCP. The backend routers all
// follow the same shape: GET /<cloud>/status (auth probe + identity) and
// GET /<cloud>/recon?services=... (findings + per-service breakdowns).

import { useEffect, useState } from "react";
import { api, authFetch, parseError } from "../api";

export type CloudFinding = {
  severity: "critical" | "high" | "medium" | "low" | "info";
  service: string;
  title: string;
  detail: string;
  evidence?: unknown;
};

type ReconResponse = {
  services: Record<string, { findings?: CloudFinding[]; summary?: Record<string, number>; error?: string }>;
  findings: CloudFinding[];
  [k: string]: unknown;
};

const SEV: Record<string, { text: string; bg: string }> = {
  critical: { text: "text-danger", bg: "bg-danger/20 border-danger/40" },
  high:     { text: "text-amber",  bg: "bg-amber/20 border-amber/40" },
  medium:   { text: "text-amber",  bg: "bg-amber/10 border-amber/30" },
  low:      { text: "text-accent", bg: "bg-accent/10 border-accent/30" },
  info:     { text: "text-ink-muted", bg: "bg-ink-dim/10 border-divider" },
};

type Props = {
  cloud: "AWS" | "Azure" | "GCP";
  statusPath: string;       // e.g. "/aws/status"
  reconPath: string;        // e.g. "/aws/recon"
  services: { id: string; label: string }[];
  setupHint: string;        // shown when status is not OK
  identityRender: (status: any) => React.ReactNode;
};

export default function CloudReconView({
  cloud, statusPath, reconPath, services, setupHint, identityRender,
}: Props) {
  const [status, setStatus] = useState<any>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set(services.map((s) => s.id)));
  const [result, setResult] = useState<ReconResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function refreshStatus() {
    setStatusLoading(true);
    try {
      setStatus(await api(statusPath));
    } catch (e) {
      setStatus({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => { void refreshStatus(); }, [statusPath]);

  function toggle(id: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function go() {
    setLoading(true); setError(""); setResult(null);
    try {
      const qs = `services=${[...picked].join(",")}`;
      const r = await authFetch(`${reconPath}?${qs}`);
      if (!r.ok) throw new Error(await parseError(r));
      setResult(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const ok = status?.ok === true;

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">{cloud.toUpperCase()} RECON</h2>
        <p className="text-[11px] text-ink-dim">
          Read-only audit using {cloud === "AWS" ? "the boto3 credential chain"
                              : cloud === "Azure" ? "DefaultAzureCredential"
                              : "Application Default Credentials"}.
          Surfaces misconfigurations grouped by service.
        </p>
      </header>

      <div className="bg-bg-card border border-divider rounded p-3 mb-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] text-ink-muted tracking-wider">IDENTITY</span>
          <button onClick={refreshStatus}
                  className="text-[10px] text-accent hover:underline">refresh</button>
        </div>
        {statusLoading
          ? <div className="text-[11px] text-ink-dim">checking…</div>
          : ok
            ? <div className="text-[12px]">{identityRender(status)}</div>
            : <div>
                <div className="text-[12px] text-amber mb-2">
                  {status?.error ?? "credentials not available"}
                </div>
                <pre className="text-[11px] bg-bg-base border border-divider rounded p-2
                                text-ink-muted whitespace-pre-wrap">
                  {setupHint}
                </pre>
              </div>}
      </div>

      {ok && (
        <div className="bg-bg-card border border-divider rounded p-3 mb-4 space-y-3">
          <div>
            <div className="text-[11px] text-ink-muted tracking-wider mb-1">SERVICES TO AUDIT</div>
            <div className="flex flex-wrap gap-3 text-[12px]">
              {services.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={picked.has(s.id)}
                         onChange={() => toggle(s.id)} />
                  <span className="text-ink-primary">{s.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={go} disabled={loading || picked.size === 0}
                    className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                               disabled:opacity-40 disabled:cursor-not-allowed">
              {loading ? "Enumerating…" : "Run Recon"}
            </button>
            {error && <span className="text-[11px] text-danger">⚠ {error}</span>}
          </div>
        </div>
      )}

      {result && <ReconResults result={result} />}
    </div>
  );
}

function ReconResults({ result }: { result: ReconResponse }) {
  const sevCounts: Record<string, number> = {};
  for (const f of result.findings) sevCounts[f.severity] = (sevCounts[f.severity] || 0) + 1;

  // Group findings by service for display
  const byService: Record<string, CloudFinding[]> = {};
  for (const f of result.findings) {
    (byService[f.service] = byService[f.service] || []).push(f);
  }

  return (
    <div className="space-y-3">
      {/* Summary banner */}
      <div className="bg-bg-card border border-divider rounded p-3">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-[11px] text-ink-muted tracking-wider">FINDINGS:</span>
          {(["critical", "high", "medium", "low", "info"] as const).map((sev) => (
            sevCounts[sev] ? (
              <span key={sev} className={
                "px-2 py-0.5 rounded border text-[11px] uppercase tracking-wider " + SEV[sev].bg
              }>
                <span className={SEV[sev].text + " font-bold"}>{sevCounts[sev]} {sev}</span>
              </span>
            ) : null
          ))}
          {result.findings.length === 0 && (
            <span className="text-[12px] text-phos">✓ No issues flagged</span>
          )}
        </div>
        <div className="text-[10px] text-ink-dim space-x-3">
          {Object.entries(result.services).map(([name, svc]) => (
            <span key={name}>
              <span className="text-ink-muted">{name}:</span>{" "}
              {svc.error ? (
                <span className="text-amber">error</span>
              ) : (
                <span className="text-ink-primary">
                  {svc.summary ? Object.entries(svc.summary).map(([k, v]) => `${k}=${v}`).join(", ") : "ok"}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Per-service errors */}
      {Object.entries(result.services).filter(([, s]) => s.error).map(([name, svc]) => (
        <div key={name} className="bg-amber/10 border border-amber/30 rounded p-2 text-[11px]">
          <span className="text-amber font-bold">{name}:</span>{" "}
          <span className="text-ink-muted">{svc.error}</span>
        </div>
      ))}

      {/* Findings list */}
      {Object.entries(byService).map(([service, findings]) => (
        <div key={service}>
          <h3 className="text-[12px] font-bold text-ink-primary tracking-wider mb-1">
            {service.toUpperCase()} <span className="text-ink-dim font-normal">({findings.length})</span>
          </h3>
          <div className="space-y-2">
            {findings.map((f, i) => (
              <div key={i} className={"rounded border p-2 " + SEV[f.severity].bg}>
                <div className="flex items-center gap-2 text-[11px] mb-1">
                  <span className={"font-bold tracking-wider uppercase " + SEV[f.severity].text}>
                    {f.severity}
                  </span>
                  <span className="text-ink-primary font-bold text-[12px]">{f.title}</span>
                </div>
                <div className="text-[12px] text-ink-muted">{f.detail}</div>
                {f.evidence !== undefined && f.evidence !== null && (
                  <details className="mt-1">
                    <summary className="text-[10px] text-ink-dim cursor-pointer">
                      Evidence
                    </summary>
                    <pre className="text-[10px] font-mono text-phos
                                    bg-bg-panel border border-divider rounded p-1.5 mt-1
                                    whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                      {JSON.stringify(f.evidence, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
