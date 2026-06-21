// Report — engagement report exporter.
//
// Distinct from the legacy /reports rollup snapshot flow that EngagementWorkspace
// still owns. This page renders directly from findings + CVSS + evidence:
// preview JSON via `fetchReportPreview`, plus markdown / PDF file downloads
// via `reportExportUrl`. The executive summary is template-based so reports
// work without an Anthropic key.

import { useEffect, useMemo, useState } from "react";
import {
  fetchReportPreview,
  reportExportUrl,
  useActiveEngagementId,
  type EngagementReport,
  type EngagementReportFinding,
  type FindingSeverity,
} from "../lib/engagement";
import type { Evidence, EvidenceType } from "../lib/engagement";
import Glyph from "../components/Glyph";

type Props = { onJumpTo?: (id: string) => void };

// Severity palette — mirrors the one used in pages/Findings.tsx so the
// report preview reads visually consistent with the tracker.
const SEV_BG: Record<FindingSeverity, string> = {
  critical: "bg-danger/20 border-danger/40 text-danger",
  high:     "bg-amber/20 border-amber/40 text-amber",
  medium:   "bg-amber/10 border-amber/30 text-amber",
  low:      "bg-accent/10 border-accent/30 text-accent",
  info:     "bg-ink-dim/10 border-divider text-ink-muted",
};

const SEV_BAR: Record<FindingSeverity, string> = {
  critical: "bg-danger",
  high:     "bg-amber",
  medium:   "bg-amber/60",
  low:      "bg-accent",
  info:     "bg-ink-dim",
};

const SEV_RANK: Record<FindingSeverity, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
};

const SEV_ORDER: FindingSeverity[] = [
  "critical", "high", "medium", "low", "info",
];

function cvssBand(score: number): FindingSeverity {
  if (score >= 9.0) return "critical";
  if (score >= 7.0) return "high";
  if (score >= 4.0) return "medium";
  if (score >  0.0) return "low";
  return "info";
}

function cvssLabel(sev: FindingSeverity): string {
  return sev.charAt(0).toUpperCase() + sev.slice(1);
}

export default function Report({ onJumpTo }: Props) {
  const activeId = useActiveEngagementId();
  const [preview, setPreview] = useState<EngagementReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!activeId) { setPreview(null); return; }
    setLoading(true); setError("");
    fetchReportPreview(activeId)
      .then((r) => { if (!cancelled) setPreview(r); })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeId]);

  const sortedFindings = useMemo(() => {
    if (!preview) return [];
    const list = [...preview.findings];
    list.sort((a, b) => {
      const sd = SEV_RANK[a.severity] - SEV_RANK[b.severity];
      if (sd !== 0) return sd;
      return a.captured_at < b.captured_at ? 1
           : a.captured_at > b.captured_at ? -1
           : 0;
    });
    return list;
  }, [preview]);

  if (!activeId) {
    return (
      <div className="h-full flex flex-col">
        <header className="border-b border-divider px-6 pt-4 pb-3">
          <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">
            REPORT EXPORT
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <Glyph name="report" size={18} className="text-ink-primary" />
            <h2 className="text-base font-bold tracking-wide text-ink-primary">
              Report
            </h2>
          </div>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center text-ink-muted p-6 text-center">
          <p className="text-[13px] mb-2 text-ink-primary font-bold">
            No active engagement.
          </p>
          <p className="text-[12px] max-w-md">
            Report exports always belong to an engagement. Select or create one
            from the engagement pill in the top bar, then promote a few results
            from any tool page to fill it in.
          </p>
          {onJumpTo && (
            <button onClick={() => onJumpTo("engagements")}
                    className="mt-4 px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold">
              Open Engagements
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">
          REPORT EXPORT
        </div>
        <div className="mt-0.5 flex items-baseline gap-3 flex-wrap">
          <span className="self-center">
            <Glyph name="report" size={18} className="text-ink-primary" />
          </span>
          <h2 className="text-base font-bold tracking-wide text-ink-primary">
            {preview ? preview.header.engagement_name : "Report"}
          </h2>
          {preview && (
            <span className="text-[11px] text-ink-dim font-mono">
              {preview.exec_summary.total} findings
            </span>
          )}
          <span className="flex-1" />
          <div className="flex items-center gap-2">
            <a href={reportExportUrl(activeId, "markdown")}
               download
               className="px-3 py-1.5 rounded border border-accent text-accent
                          text-[12px] font-bold uppercase tracking-wider
                          hover:bg-accent/10 transition">
              Export Markdown
            </a>
            <a href={reportExportUrl(activeId, "pdf")}
               download
               className="px-3 py-1.5 rounded border border-accent text-accent
                          text-[12px] font-bold uppercase tracking-wider
                          hover:bg-accent/10 transition">
              Export PDF
            </a>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="px-6 py-3 text-[12px] text-danger">
            {"⚠ "}{error}
          </div>
        )}
        {loading && !preview && (
          <div className="px-6 py-6 text-[12px] text-ink-dim italic">
            Loading report preview...
          </div>
        )}
        {preview && (
          <div className="px-6 py-5 space-y-6 max-w-4xl">
            <HeaderBlock report={preview} />
            <ExecSummaryBlock report={preview} />
            {sortedFindings.length === 0 ? (
              <div className="border border-divider rounded p-4
                              text-[12px] text-ink-muted italic">
                No findings tracked on this engagement yet. Promote results
                from any tool page to build the report.
              </div>
            ) : (
              <FindingsList findings={sortedFindings} />
            )}
            <MethodologyBlock text={preview.methodology} />
            <DisclaimerBlock text={preview.disclaimer} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Header block ───────────────────────────────────────────────────────────

function HeaderBlock({ report }: { report: EngagementReport }) {
  const h = report.header;
  return (
    <section className="border border-divider rounded p-4 space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">
          ENGAGEMENT
        </div>
        <h3 className="text-lg font-bold text-ink-primary leading-tight">
          {h.engagement_name}
        </h3>
      </div>

      {h.scope.length > 0 && (
        <ChipRow label="SCOPE" items={h.scope} tone="accent" />
      )}
      {h.exclusions.length > 0 && (
        <ChipRow label="EXCLUSIONS" items={h.exclusions} tone="danger" />
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3
                      text-[11px] text-ink-dim font-mono">
        <Meta label="STATUS"       value={h.status} />
        <Meta label="OPERATOR"     value={h.operator || "—"} />
        <Meta label="DATE FROM"    value={h.date_from || "—"} />
        <Meta label="DATE TO"      value={h.date_to || "—"} />
        <Meta label="GENERATED"    value={
          h.generated_at
            ? new Date(h.generated_at).toLocaleString()
            : "—"
        } />
        <Meta label="ENGAGEMENT ID" value={h.engagement_id} mono />
      </div>

      {h.notes && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">
            NOTES
          </div>
          <div className="text-[12px] whitespace-pre-wrap text-ink-primary">
            {h.notes}
          </div>
        </div>
      )}
    </section>
  );
}

function Meta({ label, value, mono }: {
  label: string; value: string; mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-muted mb-0.5">
        {label}
      </div>
      <div className={
        "text-[11px] text-ink-primary " + (mono ? "font-mono truncate" : "")
      }>
        {value}
      </div>
    </div>
  );
}

function ChipRow({ label, items, tone }: {
  label: string;
  items: string[];
  tone: "accent" | "danger";
}) {
  const cls = tone === "danger"
    ? "border-danger/40 text-danger bg-danger/10"
    : "border-accent/30 text-accent bg-accent/5";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">
        {label}
      </div>
      <div className="flex flex-wrap gap-1">
        {items.map((it, i) => (
          <span key={i}
                className={
                  "text-[11px] font-mono px-1.5 py-0.5 rounded border " + cls
                }>
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Exec summary ───────────────────────────────────────────────────────────

function ExecSummaryBlock({ report }: { report: EngagementReport }) {
  const counts = report.exec_summary.counts;
  return (
    <section className="border border-divider rounded p-4 space-y-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-muted">
        EXECUTIVE SUMMARY
      </div>

      <div className="flex flex-wrap gap-2">
        {SEV_ORDER.map((sev) => {
          const n = counts[sev] ?? 0;
          return (
            <span key={sev}
                  className={
                    "text-[11px] font-mono uppercase tracking-wider border " +
                    "rounded px-2 py-1 flex items-center gap-1.5 " + SEV_BG[sev]
                  }>
              <span className="font-bold tabular-nums text-[12px]">{n}</span>
              <span>{sev}</span>
            </span>
          );
        })}
      </div>

      {report.exec_summary.summary && (
        <p className="text-[13px] text-ink-primary whitespace-pre-wrap leading-relaxed">
          {report.exec_summary.summary}
        </p>
      )}
    </section>
  );
}

// ── Findings list ──────────────────────────────────────────────────────────

function FindingsList({ findings }: { findings: EngagementReportFinding[] }) {
  return (
    <section>
      <div className="text-[10px] uppercase tracking-wider text-ink-muted mb-2">
        FINDINGS ({findings.length})
      </div>
      <ul className="space-y-2">
        {findings.map((f) => (
          <FindingCard key={f.id} finding={f} />
        ))}
      </ul>
    </section>
  );
}

function FindingCard({ finding }: { finding: EngagementReportFinding }) {
  const [expanded, setExpanded] = useState(false);
  const sevBand = finding.cvss != null
    ? cvssBand(finding.cvss)
    : finding.severity;
  return (
    <li className="border border-divider rounded overflow-hidden flex
                   bg-bg-card/40">
      <div className={"w-1 shrink-0 " + SEV_BAR[finding.severity]} />
      <div className="flex-1 min-w-0">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full text-left px-3 py-2 flex items-center gap-2
                     hover:bg-bg-nav-hover transition"
        >
          <span className={
            "text-[10px] uppercase tracking-wider border rounded px-1.5 " +
            SEV_BG[finding.severity]
          }>
            {finding.severity}
          </span>
          <span className="text-[13px] font-bold text-ink-primary truncate flex-1">
            {finding.title}
          </span>
          {finding.cvss != null && (
            <span className={
              "font-mono text-[11px] uppercase tracking-wider border rounded " +
              "px-1.5 py-0.5 " + SEV_BG[sevBand]
            }>
              {finding.cvss.toFixed(1)} {cvssLabel(sevBand)}
            </span>
          )}
          {finding.status && (
            <span className="text-[10px] uppercase tracking-wider text-ink-dim
                             border border-divider rounded px-1.5">
              {finding.status.replace(/_/g, " ")}
            </span>
          )}
          <span className="text-ink-dim text-[12px] shrink-0">
            {expanded ? "▾" : "▸"}
          </span>
        </button>
        <div className="px-3 pb-2 text-[10px] text-ink-dim font-mono flex
                        flex-wrap items-center gap-x-2 gap-y-1">
          {finding.tool && (
            <span className="text-accent">{finding.tool}</span>
          )}
          {finding.target && (
            <span className="border border-divider rounded px-1">
              {finding.target}
            </span>
          )}
          {finding.captured_at && (
            <span>{new Date(finding.captured_at).toLocaleString()}</span>
          )}
        </div>

        {expanded && (
          <div className="px-3 pb-3 pt-1 space-y-3 border-t border-divider">
            {finding.description && (
              <section>
                <div className="text-[10px] uppercase tracking-wider
                                text-ink-muted mb-1">
                  DESCRIPTION
                </div>
                <div className="text-[12px] whitespace-pre-wrap text-ink-primary">
                  {finding.description}
                </div>
              </section>
            )}

            {finding.ai_summary && (
              <section>
                <div className="text-[10px] uppercase tracking-wider
                                text-accent mb-1">
                  AI SUMMARY
                </div>
                <div className="text-[12px] whitespace-pre-wrap text-ink-primary
                                bg-accent/5 border border-accent/20 rounded p-2">
                  {finding.ai_summary}
                </div>
              </section>
            )}

            {finding.cvss_vector && (
              <section>
                <div className="text-[10px] uppercase tracking-wider
                                text-ink-muted mb-1">
                  CVSS VECTOR
                </div>
                <div className="text-[11px] font-mono text-ink-muted break-all">
                  {finding.cvss_vector}
                </div>
              </section>
            )}

            <EvidenceTimeline items={finding.evidence} />
          </div>
        )}
      </div>
    </li>
  );
}

// ── Evidence timeline (read-only mirror of pages/Findings.tsx) ─────────────

function evTypeLabel(t: EvidenceType): string {
  switch (t) {
    case "scan_output":      return "SCAN";
    case "request_response": return "REQ/RES";
    case "screenshot_ref":   return "IMG";
    case "note":             return "NOTE";
    case "command":          return "CMD";
  }
}

function EvidenceTimeline({ items }: { items: Evidence[] }) {
  return (
    <section>
      <div className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">
        EVIDENCE TIMELINE
      </div>
      {items.length === 0 ? (
        <div className="text-[11px] text-ink-muted italic">
          No evidence captured.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <EvidenceRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function EvidenceRow({ item }: { item: Evidence }) {
  return (
    <li className="border border-divider rounded bg-bg-base/60">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-divider">
        <span className="text-[10px] uppercase tracking-wider text-accent
                         border border-accent/30 rounded px-1.5 py-0.5
                         bg-accent/5 font-bold">
          {evTypeLabel(item.type)}
        </span>
        {item.source_tool && (
          <span className="text-[10px] font-mono text-accent bg-accent/5
                           border border-accent/20 rounded px-1.5 py-0.5 truncate">
            {item.source_tool}
          </span>
        )}
        <span className="text-ink-muted text-[11px] tabular-nums">
          {new Date(item.captured_at).toLocaleString()}
        </span>
      </div>
      <div className="p-2">
        {item.type === "note" ? (
          <div className="text-[12px] whitespace-pre-wrap text-ink-primary">
            {item.content}
          </div>
        ) : item.type === "screenshot_ref" ? (
          <a href={item.content}
             target="_blank"
             rel="noreferrer"
             className="text-[12px] font-mono text-accent hover:underline break-all">
            {item.content}
          </a>
        ) : (
          <pre className="text-[11px] font-mono whitespace-pre-wrap bg-bg-base
                          border border-divider rounded p-2 max-h-96 overflow-y-auto">
            {item.content}
          </pre>
        )}
      </div>
    </li>
  );
}

// ── Methodology + Disclaimer ───────────────────────────────────────────────

function MethodologyBlock({ text }: { text: string }) {
  if (!text) return null;
  return (
    <section>
      <div className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">
        METHODOLOGY
      </div>
      <div className="text-[12px] text-ink-muted whitespace-pre-wrap leading-relaxed">
        {text}
      </div>
    </section>
  );
}

function DisclaimerBlock({ text }: { text: string }) {
  if (!text) return null;
  return (
    <section className="border-t border-divider pt-4">
      <div className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">
        DISCLAIMER
      </div>
      <div className="text-[12px] text-ink-muted whitespace-pre-wrap leading-relaxed">
        {text}
      </div>
    </section>
  );
}
