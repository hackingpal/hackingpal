// Pill badge for a finding's severity. Replaces every inline severity dot/text
// across the tool pages with one consistent component.
import type { ReactNode } from "react";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

type Config = {
  bg: string;
  border: string;
  text: string;
  icon: ReactNode;
  label: string;
};

const config: Record<Severity, Config> = {
  critical: {
    bg: "var(--critical-dim)",
    border: "var(--critical)",
    text: "var(--critical)",
    icon: "▲",
    label: "Critical",
  },
  high: {
    bg: "var(--high-dim)",
    border: "var(--high)",
    text: "var(--high)",
    icon: "◆",
    label: "High",
  },
  medium: {
    bg: "var(--medium-dim)",
    border: "var(--medium)",
    text: "var(--medium)",
    icon: "■",
    label: "Medium",
  },
  low: {
    bg: "var(--low-dim)",
    border: "var(--low)",
    text: "var(--low)",
    icon: "●",
    label: "Low",
  },
  info: {
    bg: "transparent",
    border: "var(--border)",
    text: "var(--text-muted)",
    icon: "○",
    label: "Info",
  },
};

type Props = {
  severity: Severity;
  label?: string;
  size?: "sm" | "xs";
  className?: string;
};

export default function SeverityBadge({
  severity,
  label,
  size = "xs",
  className = "",
}: Props) {
  const c = config[severity];
  const fs = size === "sm" ? 11 : 10;
  const padX = size === "sm" ? 8 : 6;
  const padY = size === "sm" ? 2 : 1;
  return (
    <span
      className={"inline-flex items-center gap-1 " + className}
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.text,
        borderRadius: 999,
        padding: `${padY}px ${padX}px`,
        fontFamily: "var(--font-mono)",
        fontSize: fs,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        lineHeight: 1.2,
      }}
    >
      <span aria-hidden style={{ lineHeight: 1, fontSize: fs - 1 }}>
        {c.icon}
      </span>
      <span>{label ?? c.label}</span>
    </span>
  );
}

// Helper for callers that hold an arbitrary risk string and want to map it.
export function normalizeSeverity(value: string | undefined | null): Severity {
  const v = (value ?? "").toLowerCase();
  if (v === "critical" || v === "crit") return "critical";
  if (v === "high") return "high";
  if (v === "medium" || v === "med" || v === "warning" || v === "warn") return "medium";
  if (v === "low") return "low";
  return "info";
}
