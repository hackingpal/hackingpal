// Generic streaming results panel. Drop in to replace bespoke output
// surfaces — header with count + copy-all + clear + WsStatus, scrolling
// body of monospace rows, optional empty/loading state.
//
// Rows are passed as ReactNode children so each page keeps full control of
// row layout while inheriting the panel chrome.
import { useState, type ReactNode } from "react";
import WsStatus, { type WsState } from "./WsStatus";

type Props = {
  title?: string;
  count?: number;
  state?: WsState;
  /** When provided, "Copy all" copies this text. */
  copyAll?: string;
  /** When provided, "Clear" shows a button that calls this. */
  onClear?: () => void;
  /** Optional right-side adornment (e.g. download buttons). */
  rightExtra?: ReactNode;
  /** Optional fixed body height; otherwise expands to fit. */
  bodyMaxHeight?: number | string;
  children: ReactNode;
  className?: string;
};

export default function ResultsPanel({
  title = "Results",
  count,
  state,
  copyAll,
  onClear,
  rightExtra,
  bodyMaxHeight,
  children,
  className = "",
}: Props) {
  const [copied, setCopied] = useState(false);

  async function doCopyAll() {
    if (!copyAll) return;
    try {
      await navigator.clipboard.writeText(copyAll);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch { /* ignore */ }
  }

  return (
    <section
      className={className}
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        className="flex items-center gap-3 px-4"
        style={{
          height: 40,
          background: "var(--bg-elevated)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
          }}
        >
          {title}
        </span>
        {typeof count === "number" && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              padding: "2px 8px",
              background: "var(--accent-dim)",
              color: "var(--accent-bright)",
              border: "1px solid var(--border-accent)",
              borderRadius: 999,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {count}
          </span>
        )}

        <span className="flex-1" />

        {copyAll && (
          <button
            type="button"
            onClick={doCopyAll}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-secondary)",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 8px",
              cursor: "pointer",
            }}
            className="hover:!text-[color:var(--text-primary)] hover:!border-[color:var(--border-bright)]"
          >
            {copied ? "✓ Copied" : "Copy all"}
          </button>
        )}

        {onClear && (
          <button
            type="button"
            onClick={onClear}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-secondary)",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 8px",
              cursor: "pointer",
            }}
            className="hover:!text-[color:var(--critical)] hover:!border-[color:var(--critical)]"
          >
            Clear
          </button>
        )}

        {rightExtra}

        {state && <WsStatus state={state} />}
      </header>

      <div
        style={{
          maxHeight: bodyMaxHeight,
          overflow: bodyMaxHeight ? "auto" : "visible",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
        }}
      >
        {children}
      </div>
    </section>
  );
}

/* Convenience row helper — opt-in via composition. */
export function ResultRow({
  timestamp,
  type,
  children,
  severity,
  critical = false,
  className = "",
}: {
  timestamp?: string;
  type?: ReactNode;
  severity?: "critical" | "high" | "medium" | "low" | "info";
  critical?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const dotColor = {
    critical: "var(--critical)",
    high:     "var(--high)",
    medium:   "var(--medium)",
    low:      "var(--low)",
    info:     "var(--text-muted)",
  }[severity ?? "info"];
  return (
    <div
      className={"group animate-in " + (critical ? "mhp-critical-pulse " : "") + className}
      style={{
        display: "grid",
        gridTemplateColumns: "80px 18px 1fr",
        gap: 12,
        padding: "6px 14px",
        borderBottom: "1px solid var(--border)",
        alignItems: "baseline",
        color: "var(--text-primary)",
      }}
    >
      {timestamp ? (
        <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
          {timestamp}
        </span>
      ) : <span />}
      <span style={{ color: dotColor, fontSize: 14, lineHeight: 1 }} aria-hidden>
        ●
      </span>
      <span style={{ wordBreak: "break-word" }}>
        {type && (
          <span style={{ color: "var(--text-muted)", marginRight: 8 }}>
            {type}
          </span>
        )}
        {children}
      </span>
    </div>
  );
}
