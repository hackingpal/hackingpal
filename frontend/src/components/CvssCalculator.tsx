// CVSS v3.1 base-metric calculator. Pure client-side math — no backend round-trip
// per click. Server verification happens when the score is persisted to a finding
// elsewhere in the app.
//
// Spec reference: https://www.first.org/cvss/v3.1/specification-document
// Canonical vector: "CVSS:3.1/AV:.../AC:.../PR:.../UI:.../S:.../C:.../I:.../A:..."
//
// Drop-in usage:
//   <CvssCalculator onChange={r => setScore(r.baseScore)} />
//   <CvssCalculator
//     initialVector="CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
//     applyLabel="Apply to Finding"
//     onApply={r => save(r)}
//     compact
//   />

import { useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CvssMetrics = {
  AV: "N" | "A" | "L" | "P";
  AC: "L" | "H";
  PR: "N" | "L" | "H";
  UI: "N" | "R";
  S:  "U" | "C";
  C:  "N" | "L" | "H";
  I:  "N" | "L" | "H";
  A:  "N" | "L" | "H";
};

export type CvssSeverity = "None" | "Low" | "Medium" | "High" | "Critical";

export type CvssResult = {
  baseScore: number;
  severity: CvssSeverity;
  vector: string;
};

type Props = {
  /** Optional initial vector to pre-fill (e.g. when editing). */
  initialVector?: string;
  /** Called every time metrics change (and once on mount). */
  onChange?: (result: CvssResult) => void;
  /** Optional bottom-right action label — required to render the Apply button. */
  applyLabel?: string;
  onApply?: (result: CvssResult) => void;
  /** Compact mode — used inside the promote modal expander. */
  compact?: boolean;
};

// ---------------------------------------------------------------------------
// Spec data — weights, severity bands, metric layout
// ---------------------------------------------------------------------------

const AV_W: Record<CvssMetrics["AV"], number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.20 };
const AC_W: Record<CvssMetrics["AC"], number> = { L: 0.77, H: 0.44 };
const PR_W_U: Record<CvssMetrics["PR"], number> = { N: 0.85, L: 0.62, H: 0.27 };
const PR_W_C: Record<CvssMetrics["PR"], number> = { N: 0.85, L: 0.68, H: 0.50 };
const UI_W: Record<CvssMetrics["UI"], number> = { N: 0.85, R: 0.62 };
const CIA_W: Record<"N" | "L" | "H", number> = { N: 0.00, L: 0.22, H: 0.56 };

const DEFAULTS: CvssMetrics = {
  AV: "N", AC: "L", PR: "N", UI: "N", S: "U", C: "N", I: "N", A: "N",
};

type MetricKey = keyof CvssMetrics;

type MetricDef = {
  id: MetricKey;
  label: string;
  options: { value: string; label: string }[];
};

// Order here is the canonical vector emit order — keep it stable.
const METRIC_DEFS: MetricDef[] = [
  {
    id: "AV", label: "Attack Vector",
    options: [
      { value: "N", label: "Network" },
      { value: "A", label: "Adjacent" },
      { value: "L", label: "Local" },
      { value: "P", label: "Physical" },
    ],
  },
  {
    id: "AC", label: "Attack Complexity",
    options: [{ value: "L", label: "Low" }, { value: "H", label: "High" }],
  },
  {
    id: "PR", label: "Privileges Required",
    options: [
      { value: "N", label: "None" },
      { value: "L", label: "Low" },
      { value: "H", label: "High" },
    ],
  },
  {
    id: "UI", label: "User Interaction",
    options: [{ value: "N", label: "None" }, { value: "R", label: "Required" }],
  },
  {
    id: "S", label: "Scope",
    options: [{ value: "U", label: "Unchanged" }, { value: "C", label: "Changed" }],
  },
  {
    id: "C", label: "Confidentiality",
    options: [
      { value: "N", label: "None" },
      { value: "L", label: "Low" },
      { value: "H", label: "High" },
    ],
  },
  {
    id: "I", label: "Integrity",
    options: [
      { value: "N", label: "None" },
      { value: "L", label: "Low" },
      { value: "H", label: "High" },
    ],
  },
  {
    id: "A", label: "Availability",
    options: [
      { value: "N", label: "None" },
      { value: "L", label: "Low" },
      { value: "H", label: "High" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

// CVSS v3.1 spec roundup — NOT banker's rounding, NOT Math.ceil. Lifted from
// Appendix A of the spec verbatim so the output matches first.org's calculator
// to the decimal.
function roundup(x: number): number {
  const intInput = Math.round(x * 100000);
  if (intInput % 10000 === 0) return intInput / 100000;
  return (Math.floor(intInput / 10000) + 1) / 10;
}

function computeBaseScore(m: CvssMetrics): number {
  const av = AV_W[m.AV];
  const ac = AC_W[m.AC];
  const pr = m.S === "C" ? PR_W_C[m.PR] : PR_W_U[m.PR];
  const ui = UI_W[m.UI];
  const c = CIA_W[m.C];
  const i = CIA_W[m.I];
  const a = CIA_W[m.A];

  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = m.S === "C"
    ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
    : 6.42 * iss;

  if (impact <= 0) return 0;

  const exploitability = 8.22 * av * ac * pr * ui;
  const raw = m.S === "C"
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);

  return roundup(raw);
}

function severityBand(score: number): CvssSeverity {
  if (score >= 9.0) return "Critical";
  if (score >= 7.0) return "High";
  if (score >= 4.0) return "Medium";
  if (score > 0)    return "Low";
  return "None";
}

function vectorString(m: CvssMetrics): string {
  return `CVSS:3.1/AV:${m.AV}/AC:${m.AC}/PR:${m.PR}/UI:${m.UI}/S:${m.S}/C:${m.C}/I:${m.I}/A:${m.A}`;
}

// Tolerant parser — accepts CVSS:3.0 or 3.1 prefix, ignores Temporal/
// Environmental modifiers, case-insensitive on the metric values. Returns null
// if any of the eight required base metrics is missing or has an unknown value.
function parseVector(s: string): CvssMetrics | null {
  if (!s) return null;
  const trimmed = s.trim().replace(/^CVSS:3\.[01]\//i, "");
  const parts: Partial<Record<MetricKey, string>> = {};
  for (const seg of trimmed.split("/")) {
    const [k, v] = seg.split(":");
    if (!k || !v) continue;
    const key = k.toUpperCase() as MetricKey;
    if (key in DEFAULTS) parts[key] = v.toUpperCase();
  }
  // Validate each metric is a legal value before casting.
  const valid: Record<MetricKey, string[]> = {
    AV: ["N", "A", "L", "P"],
    AC: ["L", "H"],
    PR: ["N", "L", "H"],
    UI: ["N", "R"],
    S:  ["U", "C"],
    C:  ["N", "L", "H"],
    I:  ["N", "L", "H"],
    A:  ["N", "L", "H"],
  };
  for (const key of Object.keys(valid) as MetricKey[]) {
    const v = parts[key];
    if (!v || !valid[key].includes(v)) return null;
  }
  return parts as CvssMetrics;
}

// ---------------------------------------------------------------------------
// Severity → theme colour tokens
// ---------------------------------------------------------------------------

// Matches the existing severity palette: critical=danger, high=amber,
// medium=amber/80, low=accent, None=ink-muted. Tailwind tokens swap between
// dark/light automatically via the CSS variables in index.css.
type Pill = { bg: string; border: string; text: string };

const SEVERITY_PILL: Record<CvssSeverity, Pill> = {
  Critical: { bg: "bg-danger/15",  border: "border-danger/50",  text: "text-danger"   },
  High:     { bg: "bg-amber/15",   border: "border-amber/50",   text: "text-amber"    },
  Medium:   { bg: "bg-amber/10",   border: "border-amber/30",   text: "text-amber/80" },
  Low:      { bg: "bg-accent/10",  border: "border-accent/40",  text: "text-accent"   },
  None:     { bg: "bg-bg-card",    border: "border-divider",    text: "text-ink-muted"},
};

// ---------------------------------------------------------------------------
// Tiny inline copy button — kept local so the calculator is single-file.
// ---------------------------------------------------------------------------

function CopyVectorButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      type="button"
      onClick={onCopy}
      title={copied ? "Copied" : "Copy vector"}
      aria-label={copied ? "Copied" : "Copy vector"}
      className="inline-flex items-center gap-1 rounded border border-divider
                 bg-bg-card hover:bg-bg-row-alt text-ink-muted hover:text-ink-primary
                 px-1.5 py-0.5 text-[10px] font-mono transition shrink-0"
    >
      <span aria-hidden>{copied ? "✓" : "⧉"}</span>
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CvssCalculator(props: Props) {
  const { initialVector, onChange, applyLabel, onApply, compact = false } = props;

  // Parse the initial vector exactly once. Track whether parsing failed so we
  // can show a hint instead of silently snapping to defaults.
  const initial = useMemo(() => {
    if (!initialVector) return { metrics: { ...DEFAULTS }, parseFailed: false };
    const parsed = parseVector(initialVector);
    if (parsed) return { metrics: parsed, parseFailed: false };
    return { metrics: { ...DEFAULTS }, parseFailed: true };
  }, [initialVector]);

  const [metrics, setMetrics] = useState<CvssMetrics>(initial.metrics);
  const [parseFailed, setParseFailed] = useState<boolean>(initial.parseFailed);

  // If the parent swaps initialVector at runtime, re-seed.
  useEffect(() => {
    setMetrics(initial.metrics);
    setParseFailed(initial.parseFailed);
  }, [initial]);

  const result: CvssResult = useMemo(() => {
    const baseScore = computeBaseScore(metrics);
    return {
      baseScore,
      severity: severityBand(baseScore),
      vector: vectorString(metrics),
    };
  }, [metrics]);

  // Emit on mount and on every metrics change so the parent stays in sync.
  useEffect(() => {
    onChange?.(result);
    // We deliberately re-fire whenever `result` changes; parents are expected to
    // memoize handlers if they care about identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.vector]);

  const pill = SEVERITY_PILL[result.severity];

  // Spacing knobs — single source of truth so compact mode is one branch.
  const pad = compact ? "p-3" : "p-4";
  const rowGap = compact ? "gap-1.5" : "gap-2";
  const sectionGap = compact ? "space-y-2" : "space-y-3";
  const scoreFont = compact ? "text-2xl" : "text-4xl";
  const labelCol = compact ? "w-32" : "w-40";

  function setMetric<K extends MetricKey>(key: K, value: CvssMetrics[K]) {
    // Once the user touches anything, the parse hint is no longer useful.
    setParseFailed(false);
    setMetrics(prev => ({ ...prev, [key]: value }));
  }

  return (
    <div
      className={
        "rounded border border-divider bg-bg-card text-ink-primary " +
        sectionGap + " " + pad + " " + "flex flex-col"
      }
    >
      {/* Score readout */}
      <div className="flex items-stretch gap-3">
        <div
          className={
            "flex flex-col items-center justify-center rounded border " +
            pill.bg + " " + pill.border + " " + pill.text + " " +
            (compact ? "px-3 py-2 min-w-[88px]" : "px-4 py-3 min-w-[112px]")
          }
        >
          <div className={scoreFont + " font-bold leading-none tabular-nums"}>
            {result.baseScore.toFixed(1)}
          </div>
          <div className={(compact ? "text-[9px] " : "text-[10px] ") +
                          "uppercase tracking-widest mt-1 font-mono"}>
            {result.severity}
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
          <div className="text-[10px] uppercase tracking-widest text-ink-dim font-mono">
            CVSS v3.1 Base
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <code
              className="font-mono text-[11px] text-ink-muted truncate"
              title={result.vector}
            >
              {result.vector}
            </code>
            <CopyVectorButton text={result.vector} />
          </div>
          {parseFailed && (
            <div className="text-[10px] text-amber font-mono">
              couldn't parse vector — using defaults
            </div>
          )}
        </div>
      </div>

      {/* Metric rows */}
      <div className={sectionGap + " " + "flex flex-col"}>
        {METRIC_DEFS.map(def => {
          const current = metrics[def.id];
          return (
            <div
              key={def.id}
              className="flex items-center gap-3 flex-wrap"
            >
              <div
                className={
                  labelCol + " " +
                  "text-[11px] uppercase tracking-widest text-ink-muted font-mono shrink-0"
                }
              >
                <span className="text-ink-dim mr-1">{def.id}</span>
                {def.label}
              </div>
              <div className={"flex flex-wrap " + rowGap}>
                {def.options.map(opt => {
                  const active = current === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setMetric(def.id, opt.value as never)}
                      aria-pressed={active}
                      className={
                        (compact
                          ? "px-2 py-0.5 text-[10px] "
                          : "px-2.5 py-1 text-[11px] ") +
                        "rounded-full border font-mono uppercase tracking-widest " +
                        "transition " +
                        (active
                          ? "border-accent text-accent bg-accent/10"
                          : "border-divider text-ink-muted hover:border-ink-muted hover:text-ink-primary")
                      }
                    >
                      <span className="text-ink-dim mr-1">{opt.value}</span>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Apply action */}
      {applyLabel && onApply && (
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={() => onApply(result)}
            className={
              (compact
                ? "px-2.5 py-1 text-[10px] "
                : "px-3 py-1.5 text-[11px] ") +
              "rounded border border-accent/40 bg-accent/10 text-accent " +
              "hover:bg-accent/20 transition uppercase tracking-widest font-mono"
            }
          >
            {applyLabel}
          </button>
        </div>
      )}
    </div>
  );
}
