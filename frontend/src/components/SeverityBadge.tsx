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

// Tailwind palette colours for critical/high/medium/low render the same in
// light + dark mode (severity meaning shouldn't depend on theme). The "info"
// row binds to project CSS variables so it inherits the theme.
const config: Record<Severity, Config> = {
  critical: {
    bg: "bg-red-500/15",
    border: "border-red-500/50",
    text: "text-red-400",
    icon: "💀",
    label: "Critical",
  },
  high: {
    bg: "bg-orange-500/15",
    border: "border-orange-500/50",
    text: "text-orange-400",
    icon: "🔥",
    label: "High",
  },
  medium: {
    bg: "bg-yellow-500/15",
    border: "border-yellow-500/50",
    text: "text-yellow-400",
    icon: "⚠️",
    label: "Medium",
  },
  low: {
    bg: "bg-blue-400/15",
    border: "border-blue-400/50",
    text: "text-blue-400",
    icon: "ℹ️",
    label: "Low",
  },
  info: {
    bg: "bg-[rgb(var(--ink-muted)/0.15)]",
    border: "border-[rgb(var(--divider))]",
    text: "text-[rgb(var(--ink-muted))]",
    icon: "○",
    label: "Info",
  },
};

type Props = {
  severity: Severity;
  label?: string;             // override default label (e.g. "CRITICAL")
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
  const sizing =
    size === "sm"
      ? "px-2 py-0.5 text-[11px]"
      : "px-1.5 py-[1px] text-[10px]";
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded border font-bold uppercase tracking-wider " +
        `${c.bg} ${c.border} ${c.text} ${sizing} ${className}`
      }
    >
      <span aria-hidden className="leading-none">{c.icon}</span>
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
