// Collapsible section header for grouped results.
// Critical/high default open; info/low default closed.
import { useState, type ReactNode } from "react";
import type { Severity } from "./SeverityBadge";

type Props = {
  title: string;
  count: number;
  severity?: Severity;
  defaultOpen?: boolean;       // overrides severity-derived default
  children: ReactNode;
  className?: string;
};

function severityDefaultOpen(s: Severity | undefined): boolean {
  if (s === "critical" || s === "high") return true;
  if (s === "info" || s === "low") return false;
  return true; // medium + unknown → open
}

export default function ResultGroup({
  title,
  count,
  severity,
  defaultOpen,
  children,
  className = "",
}: Props) {
  const [open, setOpen] = useState<boolean>(
    defaultOpen ?? severityDefaultOpen(severity),
  );

  return (
    <section
      className={
        "border border-divider rounded-md overflow-hidden bg-bg-card " +
        className
      }
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-bg-panel
                   border-b border-divider text-left text-[11px] uppercase
                   tracking-[0.2em] text-ink-muted hover:bg-bg-nav-hover transition"
      >
        <span
          aria-hidden
          className={
            "inline-block transition-transform duration-200 " +
            (open ? "rotate-90" : "rotate-0")
          }
        >
          ▶
        </span>
        <span className="font-bold tracking-wider text-ink-primary">{title}</span>
        <span
          className="ml-auto inline-flex items-center justify-center min-w-[1.5rem]
                     h-5 px-1.5 rounded border border-divider bg-bg-card text-[10px]
                     font-mono text-ink-muted"
        >
          {count}
        </span>
      </button>
      {open && <div>{children}</div>}
    </section>
  );
}
