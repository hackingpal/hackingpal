/**
 * Shared results display: attempts table + findings list.
 *
 * Pages emit attempts (one per request) and findings (confirmed/likely
 * detections). Findings get the prominent UI, attempts collapse to a scroll
 * table for transparency.
 */
import { useState } from "react";

export type Attempt = {
  payload: string;
  status: number | null;
  length: number;
  elapsed_ms: number;
  extra?: Record<string, unknown>;  // tool-specific (context, method, hit, ...)
};

export type Finding = {
  severity: "info" | "warn" | "high";
  payload: string;
  evidence: string;
  confirmed?: boolean;
  extra?: Record<string, unknown>;  // tool-specific
};

const SEV: Record<string, { text: string; bg: string; label: string }> = {
  info: { text: "text-ink-muted", bg: "bg-ink-dim/10",   label: "INFO" },
  warn: { text: "text-amber",     bg: "bg-amber/10",     label: "WARN" },
  high: { text: "text-danger",    bg: "bg-danger/10",    label: "HIGH" },
};

function statusColor(s: number | null): string {
  if (s === null) return "text-ink-dim";
  if (s >= 500) return "text-amber";
  if (s >= 400) return "text-ink-muted";
  if (s >= 300) return "text-accent";
  if (s >= 200) return "text-phos";
  return "text-ink-dim";
}

type Props = {
  attempts: Attempt[];
  findings: Finding[];
  extraColumns?: { key: string; label: string }[];  // attempts table extra columns
  doneText?: string;
};

export default function AttackResults({ attempts, findings, extraColumns = [], doneText }: Props) {
  const [showAttempts, setShowAttempts] = useState(true);

  return (
    <div className="flex-1 overflow-hidden flex flex-col gap-3">
      {/* Findings — always visible */}
      <div>
        <div className="text-[11px] text-ink-muted tracking-wider mb-1">
          FINDINGS ({findings.length})
        </div>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {findings.length === 0 && (
            <div className="text-[12px] text-ink-dim italic">
              No findings yet — run the scan to see detected issues.
            </div>
          )}
          {findings.map((f, i) => {
            const sev = SEV[f.severity] ?? SEV.info;
            return (
              <div key={i} className={"rounded border border-divider p-2 " + sev.bg}>
                <div className="flex items-center gap-2 text-[11px] mb-1">
                  <span className={"font-bold tracking-wider " + sev.text}>{sev.label}</span>
                  {f.confirmed && <span className="text-phos text-[10px]">✓ confirmed</span>}
                  {f.extra && Object.entries(f.extra).map(([k, v]) =>
                    v ? <span key={k} className="text-ink-dim">{k}={String(v)}</span> : null
                  )}
                </div>
                <div className="text-[12px] font-mono text-ink-primary mb-1 break-all">
                  payload: <span className="text-amber">{f.payload}</span>
                </div>
                <pre className="text-[11px] font-mono text-ink-muted whitespace-pre-wrap bg-bg-base/50
                                p-2 rounded overflow-x-auto max-h-40">
                  {f.evidence || "(no evidence captured)"}
                </pre>
              </div>
            );
          })}
        </div>
      </div>

      {/* Attempts — collapsible */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <button onClick={() => setShowAttempts((v) => !v)}
                className="text-[11px] text-ink-muted tracking-wider mb-1 text-left
                           hover:text-ink-primary">
          {showAttempts ? "▾" : "▸"} ATTEMPTS ({attempts.length})
        </button>
        {showAttempts && (
          <div className="flex-1 overflow-y-auto bg-bg-card border border-divider rounded">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-bg-sidebar border-b border-divider">
                <tr className="text-ink-muted text-[10px] tracking-wider">
                  <th className="text-left px-2 py-1.5">PAYLOAD</th>
                  <th className="text-left px-2 py-1.5 w-16">STATUS</th>
                  <th className="text-right px-2 py-1.5 w-16">LEN</th>
                  <th className="text-right px-2 py-1.5 w-16">MS</th>
                  {extraColumns.map((c) => (
                    <th key={c.key} className="text-left px-2 py-1.5">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attempts.slice(-200).map((a, i) => (
                  <tr key={i} className="border-b border-divider hover:bg-bg-base">
                    <td className="px-2 py-1 font-mono truncate max-w-md" title={a.payload}>
                      {a.payload}
                    </td>
                    <td className={"px-2 py-1 font-mono " + statusColor(a.status)}>
                      {a.status ?? "—"}
                    </td>
                    <td className="px-2 py-1 font-mono text-right tabular-nums">{a.length}</td>
                    <td className="px-2 py-1 font-mono text-right tabular-nums">{a.elapsed_ms}</td>
                    {extraColumns.map((c) => (
                      <td key={c.key} className="px-2 py-1 font-mono text-ink-muted">
                        {String(a.extra?.[c.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
                {attempts.length === 0 && (
                  <tr>
                    <td colSpan={4 + extraColumns.length} className="px-2 py-4 text-ink-dim text-center">
                      Waiting for first request…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {doneText && <div className="text-[11px] text-ink-dim">{doneText}</div>}
    </div>
  );
}
