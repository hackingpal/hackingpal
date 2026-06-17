// Effects Debug — a grid of buttons, one per Dopamine effect, that fires
// the effect anchored to the button itself. Use this to isolate which
// effect causes visual glitches (black-screen, off-position bloom, etc.)
// and which ones behave. Toggles for the debug-log flag and theme-
// awareness controls let you see exactly what's being passed to dopamine.

import { useEffect, useState } from "react";
import { EyebrowPill, WibblingSpinner } from "performative-ui";
import {
  playNamed,
  pulse,
  celebrateBig,
  inkConfirm,
  radarSweep,
  failStamp,
  type EffectName,
} from "../lib/dopamine";

type Row = {
  id: string;
  label: string;
  blurb: string;
  fire: (el: HTMLElement) => Promise<void>;
};

const BUILTIN_NAMES: EffectName[] = [
  "solarbloom", "inkstroke", "comic", "fail", "ripple",
  "confetti", "heartburst", "lightning",
];

// Static-audit notes for each remaining effect. aurora/halo/dots were
// removed entirely (see lib/dopamine.ts "Removed effects" note).
const NOTE: Record<EffectName, string> = {
  solarbloom: "bloom + check anchored at origin",
  inkstroke:  "ink stroke anchored at origin",
  comic:      "comic word anchored at origin",
  fail:       "✗ stamp anchored at origin",
  ripple:     "concentric waves from origin",
  confetti:   "panel burst from origin",
  heartburst: "panel burst from origin",
  lightning:  "strike from origin",
};

export default function EffectsDebug() {
  const [debugOn, setDebugOn] = useState<boolean>(
    () => (typeof window !== "undefined"
      && window.localStorage.getItem("mhp:dopamine-debug") === "1"),
  );
  const [lastFired, setLastFired] = useState<string | null>(null);
  const [errored, setErrored] = useState<Set<string>>(new Set());
  const [success, setSuccess] = useState<Set<string>>(new Set());
  const [inflight, setInflight] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem("mhp:dopamine-debug", debugOn ? "1" : "0");
    } catch { /* ignore */ }
  }, [debugOn]);

  // Wrap each fire to log + capture pass/fail. We can't differentiate
  // visual breakage from a thrown error, but at least promise rejection
  // is captured deterministically.
  async function safeFire(id: string, btn: HTMLElement, fn: () => Promise<void>) {
    setInflight(id);
    setLastFired(id);
    const onErr = (e: ErrorEvent | PromiseRejectionEvent) => {
      // eslint-disable-next-line no-console
      console.warn("[effects-debug]", id, "window error:", e);
    };
    window.addEventListener("error", onErr as EventListener);
    window.addEventListener("unhandledrejection", onErr as EventListener);
    try {
      await fn();
      setSuccess((s) => new Set(s).add(id));
      setErrored((s) => {
        const n = new Set(s); n.delete(id); return n;
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[effects-debug]", id, "rejected:", e);
      setErrored((s) => new Set(s).add(id));
    } finally {
      window.removeEventListener("error", onErr as EventListener);
      window.removeEventListener("unhandledrejection", onErr as EventListener);
      // Small grace period so back-to-back clicks don't stack overlays.
      setTimeout(() => setInflight((cur) => cur === id ? null : cur), 250);
    }
    void btn; // kept for future per-button highlight
  }

  // The whole catalogue: every named built-in + each high-level helper.
  const rows: Row[] = [
    ...BUILTIN_NAMES.map<Row>((name) => ({
      id: `play:${name}`,
      label: name,
      blurb: NOTE[name],
      fire: (el) => playNamed(name, el),
    })),
    { id: "helper:pulse",        label: "pulse() — celebrate",
      blurb: "m.celebrate(…) with current settings",
      fire: (el) => pulse(el) },
    { id: "helper:celebrateBig", label: "celebrateBig() — milestone",
      blurb: "celebrate boosted by 1.5×",
      fire: (el) => celebrateBig(el) },
    { id: "helper:inkConfirm",   label: "inkConfirm() — checkbox",
      blurb: "m.celebrateInk(…)",
      fire: (el) => inkConfirm(el) },
    { id: "helper:radarSweep",   label: "radarSweep() — scan start",
      blurb: 'm.play("ripple", …)',
      fire: (el) => radarSweep(el) },
    { id: "helper:failStamp",    label: "failStamp() — error",
      blurb: "m.fail(…)",
      fire: (el) => failStamp(el) },
  ];

  return (
    <div className="h-full flex flex-col bg-bg-base">
      <header className="px-6 py-4 border-b border-divider">
        <EyebrowPill icon={false} className="mhp-eyebrow">DEBUG</EyebrowPill>
        <h1 className="text-[15px] font-bold text-ink-primary tracking-tight mt-0.5">
          Effects Debug
        </h1>
        <p className="text-[12px] text-ink-muted mt-1">
          Click any tile to fire that effect anchored to the tile's center.
          The console logs origin coordinates + the full options object when
          debug is on. Tiles turn green on success, red on a thrown error —
          but a quiet visual glitch (black-screen) won't show up here, watch
          the page itself.
        </p>
      </header>

      <div className="px-6 py-3 border-b border-divider bg-bg-sidebar
                      flex items-center gap-4 text-[11px]">
        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={debugOn}
            onChange={(e) => setDebugOn(e.target.checked)}
            className="accent-accent"
          />
          <span className="text-ink-primary">Console debug (mhp:dopamine-debug)</span>
        </label>
        <span className="text-ink-dim">·</span>
        <span className="text-ink-muted">
          Last fired: <span className="font-mono text-ink-primary">{lastFired ?? "—"}</span>
        </span>
        {inflight && (
          <span className="ml-auto text-ink-muted inline-flex items-center gap-2">
            <WibblingSpinner />
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {rows.map((r) => {
            const ok = success.has(r.id);
            const bad = errored.has(r.id);
            return (
              <button
                key={r.id}
                ref={(el) => {
                  // Store the latest ref on a data attribute so we don't
                  // need a per-row useRef. fire uses currentTarget anyway.
                  void el;
                }}
                onClick={(e) => safeFire(r.id, e.currentTarget, () => r.fire(e.currentTarget))}
                disabled={inflight === r.id}
                className={
                  "text-left rounded-md border px-3 py-3 transition " +
                  (bad ? "border-danger/60 bg-danger/10 "
                    : ok ? "border-phos/60 bg-phos/10 "
                    : "border-divider hover:border-ink-muted bg-bg-card ")
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ink-primary text-[12px] font-bold font-mono">
                    {r.label}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider">
                    {bad ? <span className="text-danger">err</span>
                      : ok ? <span className="text-phos">ok</span>
                      : <span className="text-ink-dim">idle</span>}
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-ink-muted font-mono truncate">
                  {r.blurb}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-8 text-[11px] text-ink-muted leading-relaxed max-w-2xl">
          <div className="text-ink-dim uppercase tracking-wider text-[10px] mb-1">
            What this catches
          </div>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Off-position bloom — the effect should originate from the tile
              you clicked, not the top-left of the page. If it doesn't,
              `toOrigin()` is still passing the wrong shape.
            </li>
            <li>
              Black screen on light theme — caused by dopamine's default
              `mix-blend-mode: screen` overlay. Fixed by passing `backdrop`
              = current --bg-base, which we now do automatically.
            </li>
            <li>
              Rejected promise — captured per-tile (red). Open DevTools to
              read the full error.
            </li>
            <li>
              Removed: aurora (full-screen curtain, ignored origin), halo
              and dots (looping ambient effects). See lib/dopamine.ts.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
