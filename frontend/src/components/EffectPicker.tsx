// Per-tool dropdown to choose which Dopamine effect fires when the user
// presses that tool's run/scan button. Selection is persisted to
// localStorage under `mhp:scan-effect:<toolKey>` so each tool keeps its own
// preferred vibe.
//
// The dropdown is small and sits inline near the run button. Selection is
// also fired as a one-shot preview so the user sees what they picked.
import { useEffect, useRef, useState } from "react";
import {
  getToolEffect, setToolEffect, playNamed, type EffectName,
} from "../lib/dopamine";

// `aurora` is omitted: it declares usesOrigin:false and renders as a
// full-screen curtain regardless of click point — wrong shape for a
// button-press signal. `halo` and `dots` are looping ambient effects
// that the wrapper has to force-stop; they don't fit either. Anyone
// who really wants them can still fire them from the Effects Debug page.
const CHOICES: { id: EffectName; label: string }[] = [
  { id: "ripple",     label: "Radar sweep" },
  { id: "solarbloom", label: "Pulse" },
  { id: "lightning",  label: "Lightning" },
  { id: "heartburst", label: "Heart burst" },
  { id: "confetti",   label: "Confetti" },
  { id: "inkstroke",  label: "Ink stroke" },
  { id: "comic",      label: "Comic impact" },
  { id: "fail",       label: "Fail stamp" },
];

type Props = {
  /** Unique key for localStorage, e.g. "lan", "ports", "wifi". */
  toolKey: string;
  /** Default effect if the user hasn't picked one. */
  defaultEffect?: EffectName;
  className?: string;
};

export default function EffectPicker({
  toolKey,
  defaultEffect = "ripple",
  className = "",
}: Props) {
  const [val, setVal] = useState<EffectName>(() => getToolEffect(toolKey, defaultEffect));
  const selectRef = useRef<HTMLSelectElement | null>(null);

  // Sync if another tab / settings page changes this tool's effect.
  useEffect(() => {
    function onChange(e: Event) {
      const d = (e as CustomEvent<{ toolKey: string; effect: EffectName }>).detail;
      if (d?.toolKey === toolKey) setVal(d.effect);
    }
    window.addEventListener("mhp:scan-effect-changed", onChange);
    return () => window.removeEventListener("mhp:scan-effect-changed", onChange);
  }, [toolKey]);

  return (
    <label
      className={"inline-flex items-center gap-1.5 " + className}
      title="Pick which effect fires when you start the scan"
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        FX
      </span>
      <select
        ref={selectRef}
        value={val}
        onChange={(e) => {
          const next = e.target.value as EffectName;
          setVal(next);
          setToolEffect(toolKey, next);
          // Fire a one-shot preview from the dropdown so the user sees
          // what they picked. Origin = center of select element.
          void playNamed(next, selectRef.current ?? undefined);
        }}
        style={{
          background: "var(--bg-base)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "4px 8px",
          fontFamily: "var(--font-sans)",
          fontSize: 11,
          color: "var(--text-primary)",
          outline: "none",
          cursor: "pointer",
        }}
      >
        {CHOICES.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
    </label>
  );
}
