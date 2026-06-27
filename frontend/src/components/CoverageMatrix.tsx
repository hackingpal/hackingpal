// Engagement coverage matrix — "what's been checked for this engagement".
//
// A compact grid of the six coverage areas (DNS / TLS / headers / services /
// findings / report) with a covered/not dot, a status line, and a roll-up
// bar. The backend derives coverage from the audit log + results timeline +
// findings (backend/lib/coverage.py); this only renders it. Uncovered recon
// areas are clickable and jump to the relevant tool so the matrix doubles as
// a "what's left to do" launcher.

import { useEffect, useState } from "react";
import {
  fetchCoverage,
  type CoverageArea,
  type EngagementCoverage,
} from "../lib/engagement";
import {
  areaStatusLine,
  areaTone,
  coverageHeadline,
  coveragePercent,
} from "../lib/coverageView";

type Props = {
  engagementId: string;
  onNavigate?: (navId: string) => void;
};

// Where an uncovered recon area sends you to do the check. findings/report
// aren't "run a tool" actions, so they stay non-navigating.
const AREA_NAV: Record<string, string> = {
  dns: "dns",
  tls: "tls",
  headers: "http",
  services: "nmap",
};

export default function CoverageMatrix({ engagementId, onNavigate }: Props) {
  const [cov, setCov] = useState<EngagementCoverage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    fetchCoverage(engagementId)
      .then((c) => { if (!cancelled) setCov(c); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [engagementId]);

  if (error) {
    return (
      <section className="border border-divider rounded-lg p-4 mb-4 bg-bg-card">
        <div className="text-[11px] text-danger">⚠ Coverage unavailable — {error}</div>
      </section>
    );
  }
  if (!cov) {
    return (
      <section className="border border-divider rounded-lg p-4 mb-4 bg-bg-card">
        <div className="text-[11px] text-ink-dim">Loading coverage…</div>
      </section>
    );
  }

  const pct = coveragePercent(cov);

  return (
    <section className="border border-divider rounded-lg p-4 mb-4 bg-bg-card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-ink-muted">Coverage</h2>
        <span className="text-[11px] text-ink-dim">{coverageHeadline(cov)}</span>
      </div>

      {/* Roll-up bar */}
      <div className="h-1.5 rounded-full bg-bg-base overflow-hidden mb-4">
        <div
          className="h-full bg-success transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {cov.areas.map((a) => (
          <CoverageCell
            key={a.key}
            area={a}
            navId={AREA_NAV[a.key]}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </section>
  );
}

function CoverageCell({
  area, navId, onNavigate,
}: {
  area: CoverageArea;
  navId?: string;
  onNavigate?: (navId: string) => void;
}) {
  const tone = areaTone(area);
  // Clickable only when it would do something useful: a recon area that
  // hasn't been covered yet and we know where to send the user.
  const jump = !area.covered && navId && onNavigate
    ? () => onNavigate(navId)
    : undefined;

  const inner = (
    <>
      <div className="flex items-center gap-2 mb-1">
        <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`} />
        <span className="text-[11px] text-ink-primary truncate">{area.label}</span>
      </div>
      <div className={`text-[10px] ${tone.text} truncate`} title={area.description}>
        {areaStatusLine(area)}
        {jump && <span className="text-accent"> · run →</span>}
      </div>
    </>
  );

  const cls =
    `text-left rounded border ${tone.border} bg-bg-base/40 px-2.5 py-2 ` +
    (jump ? "hover:border-accent/60 transition cursor-pointer" : "");

  return jump
    ? <button type="button" onClick={jump} className={cls}>{inner}</button>
    : <div className={cls}>{inner}</div>;
}
