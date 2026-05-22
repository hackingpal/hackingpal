import { useEffect, useState } from "react";
import {
  calculateScore, DEFAULT_VECTOR, METRICS, parseVector,
  severityFromScore, vectorToString, type CvssVector,
} from "../lib/cvss";

const SEV_COLORS: Record<string, string> = {
  critical: "text-danger",
  high:     "text-danger",
  medium:   "text-amber",
  low:      "text-accent",
  info:     "text-ink-muted",
};

export default function CvssCalculator() {
  const [vector, setVector] = useState<CvssVector>(DEFAULT_VECTOR);
  const [vectorInput, setVectorInput] = useState(vectorToString(DEFAULT_VECTOR));
  const [parseError, setParseError] = useState("");

  // Recompute the input box when metrics change
  useEffect(() => {
    setVectorInput(vectorToString(vector));
    setParseError("");
  }, [vector]);

  function tryParse(s: string) {
    setVectorInput(s);
    const parsed = parseVector(s);
    if (parsed) {
      setVector(parsed);
      setParseError("");
    } else {
      setParseError("Invalid vector — required: CVSS:3.1/AV:?/AC:?/PR:?/UI:?/S:?/C:?/I:?/A:?");
    }
  }

  const score = calculateScore(vector);
  const severity = severityFromScore(score);
  const sevColor = SEV_COLORS[severity] ?? "text-ink-muted";

  return (
    <div className="h-full p-4 overflow-y-auto">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-ink-primary tracking-wide">CVSS CALCULATOR</h2>
        <p className="text-[11px] text-ink-dim">
          CVSS v3.1 Base score. Pick metrics or paste a vector string; both stay in sync.
        </p>
      </header>

      {/* Score readout */}
      <div className="bg-bg-card border border-divider rounded p-4 mb-4 flex items-center gap-6">
        <div className={"text-[44px] font-bold leading-none tabular-nums " + sevColor}>
          {score.toFixed(1)}
        </div>
        <div>
          <div className={"text-[14px] font-bold uppercase tracking-widest " + sevColor}>
            {severity}
          </div>
          <div className="text-[11px] text-ink-dim font-mono mt-1 break-all">
            {vectorToString(vector)}
          </div>
        </div>
        <button
          onClick={() => navigator.clipboard?.writeText(vectorToString(vector))}
          className="ml-auto px-3 py-1.5 rounded border border-divider text-[11px]
                     text-ink-primary hover:bg-bg-nav-hover"
        >
          Copy vector
        </button>
      </div>

      {/* Vector text input */}
      <div className="bg-bg-card border border-divider rounded p-3 mb-4">
        <label className="block text-[11px] text-ink-muted tracking-wider mb-1">
          PASTE VECTOR
        </label>
        <input
          value={vectorInput}
          onChange={(e) => tryParse(e.target.value)}
          spellCheck={false}
          className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                     text-[12px] font-mono focus:outline-none focus:border-accent"
        />
        {parseError && <div className="text-[11px] text-danger mt-1">{parseError}</div>}
      </div>

      {/* Metric pickers */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {METRICS.map((m) => (
          <div key={m.id} className="bg-bg-card border border-divider rounded p-3">
            <div className="text-[10px] text-ink-muted tracking-wider mb-1">
              {m.id} · {m.label.toUpperCase()}
            </div>
            <div className="flex flex-col gap-1">
              {m.options.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setVector({ ...vector, [m.id]: opt.value })}
                  className={
                    "px-2 py-1 rounded text-[12px] text-left transition " +
                    (vector[m.id] === opt.value
                      ? "bg-accent text-white font-bold"
                      : "bg-bg-base text-ink-primary hover:bg-bg-nav-hover")
                  }
                >
                  <span className="font-mono text-[10px] text-ink-dim mr-1">{opt.value}</span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-ink-dim mt-4 leading-relaxed">
        Base score only — Temporal (E/RL/RC) and Environmental (CR/IR/AR/M*)
        modifiers in pasted vectors are ignored. Severity bands: 0 info, 0.1–3.9
        low, 4.0–6.9 medium, 7.0–8.9 high, 9.0–10.0 critical.
      </p>
    </div>
  );
}
