// Engagement Dashboard — the engagement-first landing page.
//
// When an engagement is active, this page replaces the old "land on a tool"
// flow (see ROADMAP.md #4). Shows the engagement at a glance: scope, status,
// findings summary, and a curated checklist of recon stages.
//
// When no engagement is active, the page is the soft onboarding for the
// engagement-first model — explains the concept and points at the list.

import { useEffect, useMemo, useState } from "react";
import { AsciiHero, EyebrowPill, Goldeneye } from "performative-ui";
import {
  listEngagements,
  listFindings,
  listResults,
  reportUrl,
  useActiveEngagementId,
  type Engagement,
  type Finding,
  type ScanResult,
} from "../lib/engagement";

type Severity = Finding["severity"];

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

const SEV_STYLE: Record<Severity, string> = {
  critical: "border-danger/40 text-danger",
  high:     "border-amber/40 text-amber",
  medium:   "border-amber/30 text-amber",
  low:      "border-accent/30 text-accent",
  info:     "border-divider text-ink-muted",
};

// Curated recon stages used by the "next steps" checklist. Each stage maps
// to a target nav id and a list of tool-path prefixes — a stage counts as
// "done" if any auto-recorded result's `tool` field begins with one of them.
type Stage = {
  id: string;
  label: string;
  blurb: string;
  navId: string;
  matches: string[];
};

const STAGES: Stage[] = [
  { id: "scope",   label: "Confirm scope",       blurb: "Edit the engagement and make sure in-scope / out-of-scope targets are listed.",
    navId: "engagements", matches: [] },
  { id: "dns",     label: "DNS recon",           blurb: "Resolve targets, walk subdomains via DNS records.",
    navId: "dns",         matches: ["/dns/"] },
  { id: "whois",   label: "WHOIS · ASN",         blurb: "Identify the owning org and ASN — useful for scope expansion checks.",
    navId: "whois",       matches: ["/whois/"] },
  { id: "ct",      label: "CT log search",       blurb: "Pull issued certs for the target domain — surfaces hostnames you didn't know about.",
    navId: "ct",          matches: ["/ct/"] },
  { id: "subdom",  label: "Subdomain enum",      blurb: "Brute / passive subdomain enumeration.",
    navId: "subdom",      matches: ["/subdomain/", "/subdom/"] },
  { id: "ports",   label: "Port scan",           blurb: "Enumerate open ports + services on each in-scope host.",
    navId: "nmap",        matches: ["/nmap/", "/port_scanner/", "/portscan/"] },
  { id: "tls",     label: "TLS audit",           blurb: "Cert chain, protocol versions, weak ciphers, hostname mismatches.",
    navId: "tls",         matches: ["/tls/"] },
  { id: "http",    label: "HTTP probe",          blurb: "Status, headers, redirects, security headers per origin.",
    navId: "http",        matches: ["/http/"] },
  { id: "fingerprint", label: "Stack fingerprint", blurb: "Identify web stack / framework / CMS to narrow follow-up checks.",
    navId: "fingerprint", matches: ["/fingerprint/"] },
];

type Props = {
  onNavigate: (id: string) => void;
};

export default function EngagementDashboard({ onNavigate }: Props) {
  const activeId = useActiveEngagementId();
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!activeId) {
      setEngagement(null);
      setFindings([]);
      setResults([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true); setError("");
      try {
        const [engs, fs, rs] = await Promise.all([
          listEngagements(true),
          listFindings(activeId),
          listResults(activeId, 500),
        ]);
        if (cancelled) return;
        setEngagement(engs.find((e) => e.id === activeId) ?? null);
        setFindings(fs);
        setResults(rs);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeId]);

  const sevCounts = useMemo(() => {
    const c: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of findings) c[f.severity]++;
    return c;
  }, [findings]);

  const completedStages = useMemo(() => {
    const done = new Set<string>();
    for (const s of STAGES) {
      if (s.matches.length === 0) continue;
      if (results.some((r) => s.matches.some((p) => r.tool.startsWith(p)))) {
        done.add(s.id);
      }
    }
    return done;
  }, [results]);

  // ── Empty state: no active engagement ─────────────────────────────────────

  if (!activeId) {
    return (
      <div className="h-full p-6 overflow-y-auto relative">
        <AsciiHero
          variant="bare"
          palette={["#22c55e"]}
          baseOpacity={0.14}
          spotlightOpacity={0.55}
          spotlightRadius={9}
          fontSize={11}
          aria-hidden
          style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0 }}
        />
        <div className="relative" style={{ zIndex: 1 }}>
          <header className="mb-4">
            <EyebrowPill icon={false} className="mhp-eyebrow">DASHBOARD</EyebrowPill>
          </header>
          <div className="mb-6 max-w-2xl rounded-lg overflow-hidden border border-divider bg-bg-card/70 backdrop-blur-sm">
            <Goldeneye
              text_default=">;) HACKINGPAL"
              text_reveal="READY WHEN YOU ARE."
              pattern=">;) "
              fontSize="clamp(28px, 5vw, 56px)"
              pattern_size_default={11}
              pattern_size_reveal={18}
              scopeSize={180}
              style={{ height: 140 }}
            />
          </div>
          <div className="max-w-2xl border border-divider rounded-lg p-6 bg-bg-card/90 backdrop-blur-sm">
            <h3 className="text-[14px] font-bold text-ink-primary mb-2">
              No active engagement
            </h3>
            <p className="text-[12px] text-ink-muted leading-relaxed mb-4">
              HackingPal is an <b>engagement-first</b> workspace: scope, scans,
              findings, and the final report all live inside a single engagement.
              Activate one to see its dashboard here.
            </p>
            <ol className="text-[12px] text-ink-muted list-decimal pl-5 space-y-1 mb-5">
              <li>Open <b>Engagements</b> and create one (scope = the targets you have authorization to test).</li>
              <li>Pick it as active from the engagement pill in the top-right.</li>
              <li>Every scan from that point auto-attaches to the engagement.</li>
            </ol>
            <button
              onClick={() => onNavigate("engagements")}
              className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold"
            >
              Go to Engagements →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Active engagement: dashboard ─────────────────────────────────────────

  return (
    <div className="h-full p-6 overflow-y-auto">
      <div className="flex items-center mb-4 gap-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">DASHBOARD</h2>
        <span className="flex-1" />
        <button
          onClick={() => onNavigate("engagements")}
          className="text-[11px] text-ink-muted hover:text-ink-primary"
        >
          View all engagements →
        </button>
      </div>

      {error && <div className="text-[12px] text-danger mb-3">⚠ {error}</div>}
      {loading && !engagement && <div className="text-[12px] text-ink-dim">Loading…</div>}

      {engagement && (
        <>
          {/* Header card */}
          <section className="border border-accent/40 bg-accent/[0.04] rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-[16px] font-bold text-ink-primary truncate">
                    {engagement.name}
                  </h3>
                  <span className="text-[10px] uppercase tracking-wider text-accent
                                   border border-accent/40 rounded px-1.5">
                    active
                  </span>
                  <span className="text-[9px] uppercase tracking-wider text-ink-dim
                                   border border-divider rounded px-1.5">
                    {engagement.status}
                  </span>
                </div>
                <div className="text-[11px] text-ink-dim mb-2">
                  {engagement.scope.length} in-scope · {engagement.exclusions.length} excluded ·
                  updated {new Date(engagement.updated_at).toLocaleString()}
                </div>
                {engagement.scope.length > 0 ? (
                  <div className="text-[11px] text-ink-muted font-mono break-words">
                    {engagement.scope.slice(0, 6).join(", ")}
                    {engagement.scope.length > 6 ? ` … (+${engagement.scope.length - 6})` : ""}
                  </div>
                ) : (
                  <div className="text-[11px] text-amber italic">
                    No scope set — add targets so scope enforcement can protect you.
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1 shrink-0 text-[11px]">
                <button onClick={() => onNavigate("engagements")}
                        className="px-2 py-0.5 rounded border border-divider text-ink-primary">
                  Edit
                </button>
                <a href={reportUrl(engagement.id, "html")} target="_blank" rel="noreferrer"
                   className="px-2 py-0.5 rounded border border-divider text-ink-primary text-center">
                  Report (HTML)
                </a>
                <a href={reportUrl(engagement.id, "md")}
                   className="px-2 py-0.5 rounded border border-divider text-ink-muted text-center">
                  Report (MD)
                </a>
              </div>
            </div>
          </section>

          {/* Findings summary */}
          <section className="border border-divider rounded-lg p-4 mb-4 bg-bg-card">
            <div className="flex items-center mb-3">
              <h3 className="text-[12px] font-bold text-ink-primary tracking-widest">
                FINDINGS
              </h3>
              <span className="text-[11px] text-ink-dim ml-2">
                {findings.length} total
              </span>
              <span className="flex-1" />
              <button onClick={() => onNavigate("findings")}
                      className="text-[11px] text-accent hover:underline">
                Open Findings →
              </button>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {SEVERITIES.map((s) => (
                <div key={s}
                     className={"border rounded px-2 py-2 text-center " + SEV_STYLE[s]}>
                  <div className="text-[18px] font-bold leading-none">{sevCounts[s]}</div>
                  <div className="text-[10px] uppercase tracking-wider mt-1">{s}</div>
                </div>
              ))}
            </div>
            {findings.length === 0 && (
              <p className="text-[11px] text-ink-dim italic mt-3">
                No findings logged yet. Create one from Findings, or attach a
                finding to a scan result.
              </p>
            )}
          </section>

          {/* Suggested next steps */}
          <section className="border border-divider rounded-lg p-4 bg-bg-card">
            <div className="flex items-center mb-3">
              <h3 className="text-[12px] font-bold text-ink-primary tracking-widest">
                SUGGESTED NEXT STEPS
              </h3>
              <span className="text-[11px] text-ink-dim ml-2">
                {completedStages.size} of {STAGES.filter((s) => s.matches.length > 0).length} recon stages run
              </span>
            </div>
            <p className="text-[11px] text-ink-dim mb-3">
              A typical authorized-recon order. Stages tick off as scan results
              auto-attach to this engagement.
            </p>
            <ul className="space-y-1.5">
              {STAGES.map((s) => {
                const done = completedStages.has(s.id);
                return (
                  <li key={s.id}
                      className={"flex items-start gap-3 px-2 py-2 rounded border " +
                        (done
                          ? "border-accent/30 bg-accent/[0.04]"
                          : "border-divider hover:bg-bg-nav-hover")}>
                    <span className={"text-[14px] leading-none mt-0.5 " +
                      (done ? "text-accent" : "text-ink-dim")}>
                      {done ? "✓" : "○"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-bold text-ink-primary">
                        {s.label}
                      </div>
                      <div className="text-[11px] text-ink-muted">{s.blurb}</div>
                    </div>
                    <button onClick={() => onNavigate(s.navId)}
                            className="px-2 py-0.5 rounded border border-divider text-ink-primary
                                       text-[11px] shrink-0">
                      Open
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
