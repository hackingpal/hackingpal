// Summary card used for scan totals (e.g. "12 OPEN PORTS", "3 CRITICAL").
// Left-border accent color drives the severity meaning. Numeric `value`
// props get the StatCounter rollup animation; non-numeric values render
// as-is (so callers can still pass formatted strings or JSX).
import type { ReactNode } from "react";
import { StatCounter } from "performative-ui";

type Accent = "accent" | "critical" | "high" | "medium" | "low" | "success" | "muted";

type Props = {
  label: string;
  value: ReactNode;
  accent?: Accent;
  /** Optional sub-label (e.g. "in 2.3s"). */
  sub?: ReactNode;
  className?: string;
};

// Only critical / high keep their saturated accent — those carry real signal.
// Everything else collapses to a flat divider grey so a row of stat cards
// reads as data, not as a stoplight.
const ACCENT_COLOR: Record<Accent, string> = {
  accent:   "var(--border-bright)",
  critical: "var(--critical)",
  high:     "var(--high)",
  medium:   "var(--border-bright)",
  low:      "var(--border-bright)",
  success:  "var(--border-bright)",
  muted:    "var(--border-bright)",
};

export default function StatCard({
  label,
  value,
  accent = "accent",
  sub,
  className = "",
}: Props) {
  return (
    <div
      className={className}
      style={{
        padding: 16,
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        borderLeft: `3px solid ${ACCENT_COLOR[accent]}`,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 120,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 28,
          fontWeight: 700,
          lineHeight: 1.1,
          color: "var(--text-primary)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {typeof value === "number" ? (
          <StatCounter target={value} durationMs={700} />
        ) : (
          value
        )}
      </div>
      {sub && (
        <div
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 11,
            color: "var(--text-secondary)",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
