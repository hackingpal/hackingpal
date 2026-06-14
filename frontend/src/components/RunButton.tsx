// Run / Stop CTA used by every page that drives a scan or stream.
// Idle = accent (run); running = critical (stop). Disabled state and
// optional label override.
import { useEffect, useRef, useState } from "react";
import { pulse } from "../lib/dopamine";

type Props = {
  running: boolean;
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
  /** Override the idle label (default: "Run"). */
  startLabel?: string;
  /** Override the running label (default: "Stop"). */
  stopLabel?: string;
  size?: "md" | "sm";
  className?: string;
  /** When the start button is disabled because auth wasn't confirmed,
      pass a string to show as the title attribute. */
  disabledTitle?: string;
};

export default function RunButton({
  running,
  onStart,
  onStop,
  disabled = false,
  startLabel = "Run",
  stopLabel = "Stop",
  size = "md",
  className = "",
  disabledTitle,
}: Props) {
  const [hover, setHover] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const wasRunningRef = useRef(running);

  // Fire a tasteful electric-violet pulse the moment a scan completes
  // (running → not running, button still mounted). Doesn't fire on stop
  // mid-scan since we can't distinguish "stopped" from "completed" here —
  // pages that want a different effect on stop can override.
  useEffect(() => {
    if (wasRunningRef.current && !running) {
      pulse(btnRef.current ?? undefined);
    }
    wasRunningRef.current = running;
  }, [running]);

  const h = size === "sm" ? 32 : 40;
  const px = size === "sm" ? 14 : 18;
  const fs = size === "sm" ? 12 : 13;

  if (running) {
    return (
      <button
        ref={btnRef}
        type="button"
        onClick={onStop}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={"inline-flex items-center gap-2 " + className}
        style={{
          height: h,
          padding: `0 ${px}px`,
          borderRadius: 8,
          background: hover ? "rgb(239 68 68 / 0.25)" : "var(--critical-dim)",
          color: "var(--critical)",
          border: "1px solid var(--critical)",
          fontFamily: "var(--font-sans)",
          fontSize: fs,
          fontWeight: 600,
          letterSpacing: "0.02em",
          cursor: "pointer",
          transition: "background 150ms ease, transform 150ms ease",
        }}
      >
        <span
          className="scanning inline-block"
          style={{
            width: 8,
            height: 8,
            background: "var(--critical)",
            borderRadius: 2,
          }}
          aria-hidden
        />
        {stopLabel}
      </button>
    );
  }

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={onStart}
      disabled={disabled}
      title={disabled ? disabledTitle : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={"inline-flex items-center gap-2 " + className}
      style={{
        height: h,
        padding: `0 ${px}px`,
        borderRadius: 8,
        background: disabled
          ? "color-mix(in srgb, var(--accent) 30%, transparent)"
          : (hover ? "var(--accent-bright)" : "var(--accent)"),
        color: "white",
        border: "1px solid transparent",
        fontFamily: "var(--font-sans)",
        fontSize: fs,
        fontWeight: 600,
        letterSpacing: "0.02em",
        cursor: disabled ? "not-allowed" : "pointer",
        transform: hover && !disabled ? "translateY(-1px)" : "translateY(0)",
        boxShadow: hover && !disabled
          ? "0 8px 20px -6px var(--accent-glow)"
          : "none",
        opacity: disabled ? 0.55 : 1,
        transition: "background 150ms ease, transform 150ms ease, box-shadow 150ms ease",
      }}
    >
      <svg
        width={fs - 1}
        height={fs - 1}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
      >
        <path d="M8 5v14l11-7z" />
      </svg>
      {startLabel}
    </button>
  );
}
