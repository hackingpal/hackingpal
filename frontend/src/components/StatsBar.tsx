// Live stats footer for streaming tool pages.
// Shows: "47 results · 2 critical · 3 high · running 1m 23s · 2.3/s"
import { useEffect, useState } from "react";

type Props = {
  total: number;
  critical?: number;
  high?: number;
  medium?: number;
  low?: number;
  elapsed?: number;
  startedAt?: number | null;
  running?: boolean;
  rate?: number;
  extra?: string;
  className?: string;
};

function formatDuration(secs: number): string {
  if (!isFinite(secs) || secs < 0) return "0s";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export default function StatsBar({
  total,
  critical = 0,
  high = 0,
  medium = 0,
  low = 0,
  elapsed,
  startedAt,
  running = false,
  rate,
  extra,
  className = "",
}: Props) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running || startedAt == null) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [running, startedAt]);
  void tick;

  const effElapsed =
    elapsed != null
      ? elapsed
      : startedAt != null
        ? Math.max(0, (Date.now() - startedAt) / 1000)
        : 0;

  const effRate =
    rate != null
      ? rate
      : effElapsed > 0
        ? total / effElapsed
        : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className={"flex flex-wrap items-center gap-x-3 gap-y-1 " + className}
      style={{
        padding: "8px 14px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--text-secondary)",
        letterSpacing: "0.02em",
      }}
    >
      <span style={{ color: "var(--text-primary)" }}>
        <strong style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {total}
        </strong>
        <span style={{ marginLeft: 4, color: "var(--text-secondary)" }}>
          {total === 1 ? "result" : "results"}
        </span>
      </span>

      {critical > 0 && (
        <span style={{ color: "var(--critical)" }}>· {critical} critical</span>
      )}
      {high > 0 && (
        <span style={{ color: "var(--high)" }}>· {high} high</span>
      )}
      {medium > 0 && (
        <span style={{ color: "var(--medium)" }}>· {medium} medium</span>
      )}
      {low > 0 && (
        <span style={{ color: "var(--low)" }}>· {low} low</span>
      )}

      {(running || effElapsed > 0) && (
        <span style={{ color: "var(--text-secondary)" }}>
          · {running ? "running" : "ran"} {formatDuration(effElapsed)}
        </span>
      )}

      {effRate > 0 && (
        <span style={{ color: "var(--text-secondary)" }}>
          · {effRate.toFixed(effRate >= 10 ? 0 : 1)}/s
        </span>
      )}

      {extra && (
        <span style={{ color: "var(--text-muted)" }}>· {extra}</span>
      )}
    </div>
  );
}
