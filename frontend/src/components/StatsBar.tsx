// Live stats footer for streaming tool pages.
// Shows: "47 results · 2 critical · 3 high · running 1m 23s · 2.3/s"
import { useEffect, useState } from "react";

type Props = {
  total: number;
  critical?: number;
  high?: number;
  medium?: number;
  low?: number;
  // Either pass elapsed seconds directly, or pass startedAt (ms epoch) and
  // we'll tick once a second while `running` is true.
  elapsed?: number;
  startedAt?: number | null;
  running?: boolean;
  // Results-per-second; if absent we derive it from total / elapsed.
  rate?: number;
  // Optional extras (e.g. "stopped", "phase: probe")
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
  // Tick once a second while running so the elapsed display stays live.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running || startedAt == null) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [running, startedAt]);
  // tick is referenced so React re-renders; the value itself is unused.
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
      className={
        "flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-divider " +
        "bg-bg-panel px-3 py-1.5 text-[11px] font-mono text-ink-muted " +
        className
      }
    >
      <span className="text-ink-primary">
        <strong className="font-bold">{total}</strong>
        <span className="ml-1 text-ink-muted">{total === 1 ? "result" : "results"}</span>
      </span>

      {critical > 0 && (
        <span className="text-red-400">· {critical} critical</span>
      )}
      {high > 0 && (
        <span className="text-orange-400">· {high} high</span>
      )}
      {medium > 0 && (
        <span className="text-yellow-400">· {medium} medium</span>
      )}
      {low > 0 && (
        <span className="text-blue-400">· {low} low</span>
      )}

      {(running || effElapsed > 0) && (
        <span className="text-ink-muted">
          · {running ? "running" : "ran"} {formatDuration(effElapsed)}
        </span>
      )}

      {effRate > 0 && (
        <span className="text-ink-muted">
          · {effRate.toFixed(effRate >= 10 ? 0 : 1)}/s
        </span>
      )}

      {extra && <span className="text-ink-dim">· {extra}</span>}
    </div>
  );
}
