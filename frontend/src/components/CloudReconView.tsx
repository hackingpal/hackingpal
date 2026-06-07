// Shared "cloud recon" view used by AWS, Azure, GCP. The backend routers all
// follow the same shape: GET /<cloud>/status (auth probe + identity) and
// GET /<cloud>/recon?services=... (findings + per-service breakdowns).

import { useEffect, useState } from "react";
import { api, authFetch, parseError } from "../api";
import SeverityBadge, { normalizeSeverity, type Severity } from "./SeverityBadge";
import ResultGroup from "./ResultGroup";
import CopyButton from "./CopyButton";
import StatsBar from "./StatsBar";
import EmptyState from "./EmptyState";

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

function topSeverity(findings: CloudFinding[]): Severity {
  const order: Severity[] = ["critical", "high", "medium", "low", "info"];
  for (const sev of order) {
    if (findings.some((f) => normalizeSeverity(f.severity) === sev)) return sev;
  }
  return "info";
}

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

      {result && <ReconResults result={result} cloud={cloud} />}

      {ok && !result && !loading && !error && (
        <EmptyState
          icon={cloud === "AWS" ? "☁︎" : cloud === "Azure" ? "△" : "✦"}
          title={`${cloud} read-only audit`}
          description="Pick services above, then Run Recon to surface misconfigurations grouped by service."
          hint="Findings are scored critical → info and grouped per-service."
        />
      )}
    </div>
  );
}

function ReconResults({ result, cloud }: { result: ReconResponse; cloud: string }) {
  const sevCounts: Record<Severity, number> = {
    critical: 0, high: 0, medium: 0, low: 0, info: 0,
  };
  for (const f of result.findings) sevCounts[normalizeSeverity(f.severity)] += 1;

  // Group findings by service for display
  const byService: Record<string, CloudFinding[]> = {};
  for (const f of result.findings) {
    (byService[f.service] = byService[f.service] || []).push(f);
  }
  const serviceEntries = Object.entries(byService);

  return (
    <div className="space-y-3">
      {/* Summary banner */}
      <div className="bg-bg-card border border-divider rounded">
        <div className="px-3 pt-3 pb-2">
          {result.findings.length === 0 ? (
            <span className="text-[12px] text-phos">✓ No issues flagged across audited services.</span>
          ) : (
            <div className="text-[11px] text-ink-dim space-x-3">
              {Object.entries(result.services).map(([name, svc]) => (
                <span key={name}>
                  <span className="text-ink-muted">{name}:</span>{" "}
                  {svc.error ? (
                    <span className="text-amber">error</span>
                  ) : (
                    <span className="text-ink-primary">
                      {svc.summary
                        ? Object.entries(svc.summary).map(([k, v]) => `${k}=${v}`).join(", ")
                        : "ok"}
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
        <StatsBar
          total={result.findings.length}
          critical={sevCounts.critical}
          high={sevCounts.high}
          medium={sevCounts.medium}
          low={sevCounts.low}
          extra={`${cloud.toLowerCase()} audit`}
        />
      </div>

      {/* Per-service errors */}
      {Object.entries(result.services).filter(([, s]) => s.error).map(([name, svc]) => (
        <div key={name} className="bg-amber/10 border border-amber/30 rounded p-2 text-[11px]">
          <span className="text-amber font-bold">{name}:</span>{" "}
          <span className="text-ink-muted">{svc.error}</span>
        </div>
      ))}

      {/* Findings grouped per-service */}
      {serviceEntries.map(([service, findings]) => {
        const sev = topSeverity(findings);
        return (
          <ResultGroup
            key={service}
            title={service.toUpperCase()}
            count={findings.length}
            severity={sev}
          >
            <div className="divide-y divide-divider/60">
              {findings.map((f, i) => {
                const fSev = normalizeSeverity(f.severity);
                const copyText = `[${fSev.toUpperCase()}] ${service}: ${f.title} — ${f.detail}`;
                return (
                  <div
                    key={i}
                    style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                    className="mhp-result-in group px-3 py-2 hover:bg-bg-row-alt transition"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <SeverityBadge severity={fSev} />
                      <span className="text-ink-primary font-bold text-[12px]">{f.title}</span>
                      <CopyButton text={copyText} className="ml-auto" />
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
                );
              })}
            </div>
          </ResultGroup>
        );
      })}
    </div>
  );
}
