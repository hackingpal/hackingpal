// Generic step-by-step setup popup. Used by tools that require external
// configuration before they work (passwordless sudo install for tcpdump /
// nmap, Anthropic API key, AWS/Azure/GCP credentials, etc).
//
// Visual model: a vertical list of numbered steps with a connecting line,
// matching the "Step-by-step progress" reference but recoloured to the
// HackingPal dark + violet theme. Performative-UI provides the eyebrow
// pill, animated percentage, and the busy spinner. When every step flips
// to done, dopamine fires a confetti effect from the card centre.
//
// Steps drive themselves via their `done` prop (almost always derived from
// the page's external status call). Optional `cta` exposes an inline action
// button on the active step — pages that need richer UX (paste-key form,
// shell-command snippet, etc.) can render anything into `description`.

import {
  useCallback, useEffect, useId, useMemo, useRef, useState,
} from "react";
import { EyebrowPill, Sparkle, StatCounter, WibblingSpinner } from "performative-ui";
import { playNamed } from "../lib/dopamine";
import { markSetupCompleted, markSetupDismissed } from "../lib/setupState";

export type SetupStep = {
  /** Stable identifier for keying. */
  id: string;
  title: string;
  /** Card body. Plain text or a custom JSX form. */
  description: React.ReactNode;
  /**
   * Externally-driven completion. When this flips true the wizard advances
   * to the next step (and fires confetti when the final one flips).
   */
  done: boolean;
  /**
   * Optional inline action button rendered on the active step. Omit for
   * info-only steps or when the description provides its own input.
   */
  cta?: {
    label: string;
    /** Verb shown by WibblingSpinner while the action is running. */
    busyLabel?: string;
    onRun: () => Promise<void> | void;
  };
};

export type SetupWizardProps = {
  open: boolean;
  toolKey: string;
  title: string;
  steps: SetupStep[];
  /** Called when the user closes the wizard (Skip / X / Esc / Done). */
  onClose: () => void;
  /** Fires once when all steps go from incomplete to complete. */
  onCompleted?: () => void;
};

export default function SetupWizard({
  open, toolKey, title, steps, onClose, onCompleted,
}: SetupWizardProps) {
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const completedFired = useRef(false);

  const total = steps.length;
  const completedCount = useMemo(() => steps.filter((s) => s.done).length, [steps]);
  const activeIdx = useMemo(() => steps.findIndex((s) => !s.done), [steps]);
  const allDone = total > 0 && completedCount === total;
  const pct = total === 0 ? 0 : Math.round((completedCount / total) * 100);
  const currentStepNumber = allDone ? total : Math.max(1, activeIdx + 1);

  const dismiss = useCallback(() => {
    if (!allDone) markSetupDismissed(toolKey);
    setErr(null);
    onClose();
  }, [allDone, toolKey, onClose]);

  // Fire confetti + persist completion the moment everything flips green.
  useEffect(() => {
    if (!open || !allDone || completedFired.current) return;
    completedFired.current = true;
    markSetupCompleted(toolKey);
    const target = cardRef.current ?? undefined;
    void playNamed("confetti", target, { intensity: 0.9, whimsy: 0.65 });
    onCompleted?.();
  }, [open, allDone, toolKey, onCompleted]);

  // Reset the latch when the wizard is re-opened on a fresh setup cycle.
  useEffect(() => { if (open && !allDone) completedFired.current = false; }, [open, allDone]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") dismiss(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  if (!open) return null;

  async function runStep(step: SetupStep) {
    if (busy || !step.cta) return;
    setBusy(true); setErr(null);
    try {
      await step.cta.onRun();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm
                 flex items-center justify-center p-4
                 animate-[mhp-result-in_180ms_ease-out]"
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div
        ref={cardRef}
        className="relative w-full max-w-md bg-bg-card border border-divider rounded-xl
                   shadow-accent-glow-lg p-6 max-h-[90vh] overflow-auto"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <h2 id={headingId}
                className="text-lg font-bold tracking-wide text-ink-primary truncate">
              {allDone ? <><Sparkle solid /> {title}</> : title}
            </h2>
            <div className="mt-1.5">
              <EyebrowPill
                className="mhp-eyebrow"
                statusColor={allDone ? "rgb(34 197 94)" : "rgb(124 58 237)"}
              >
                {allDone ? "ALL SET" : `STEP ${currentStepNumber} OF ${total}`}
              </EyebrowPill>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close setup wizard"
            className="text-ink-muted hover:text-ink-primary text-base leading-none
                       w-7 h-7 rounded hover:bg-bg-row-alt flex items-center justify-center
                       transition shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Progress bar + animated percentage */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-1.5 rounded-full bg-bg-panel overflow-hidden">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ease-out
                          ${allDone ? "bg-phos" : "bg-accent"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-[11px] font-mono tracking-wide text-ink-muted
                          tabular-nums w-10 text-right">
            <StatCounter
              target={pct}
              durationMs={500}
              format={(n) => `${Math.round(n)}%`}
            />
          </div>
        </div>

        {/* Steps */}
        <ol className="space-y-3 mb-4">
          {steps.map((step, i) => {
            const isActive = !allDone && i === activeIdx;
            const isDone = step.done;
            const isPending = !isDone && !isActive;
            const isLast = i === steps.length - 1;
            const circleClass = isDone
              ? "bg-phos/15 border-phos text-phos"
              : isActive
                ? "bg-accent text-white border-accent shadow-[0_0_0_4px_rgb(124_58_237_/_0.22)]"
                : "bg-bg-panel border-divider text-ink-dim";
            const cardClass = isActive
              ? "border-accent/60 bg-accent/5 shadow-accent-glow"
              : isDone
                ? "border-divider bg-bg-panel/50"
                : "border-divider bg-bg-panel/30 opacity-60";
            return (
              <li key={step.id} className="relative grid grid-cols-[2rem_1fr] gap-3">
                <div className="relative flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full border flex items-center justify-center
                                text-xs font-bold transition ${circleClass}`}
                  >
                    {isDone ? "✓" : i + 1}
                  </div>
                  {!isLast && (
                    <div
                      className={`flex-1 w-px mt-1 -mb-3
                                  ${isDone ? "bg-phos/40" : "bg-divider"}`}
                      aria-hidden
                    />
                  )}
                </div>

                <div className={`rounded-lg border px-3.5 py-3 transition-all ${cardClass}`}>
                  <div className={`text-sm font-bold ${isPending ? "text-ink-muted" : "text-ink-primary"}`}>
                    {step.title}
                  </div>
                  <div className="text-xs text-ink-muted mt-1 leading-relaxed">
                    {step.description}
                  </div>
                  {isActive && step.cta && (
                    <button
                      type="button"
                      onClick={() => runStep(step)}
                      disabled={busy}
                      className="mt-3 inline-flex items-center gap-2
                                 bg-accent hover:bg-accentDim active:translate-y-px
                                 text-white text-xs font-bold tracking-wide
                                 px-3.5 py-1.5 rounded transition border border-accent/60
                                 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {busy ? (
                        <WibblingSpinner
                          verbs={[step.cta.busyLabel ?? "Working"]}
                          ellipsis="…"
                        />
                      ) : (
                        <>{step.cta.label} <span aria-hidden>→</span></>
                      )}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {err && (
          <div className="mb-4 border border-danger/40 bg-danger/10 text-danger
                          rounded px-3 py-2 text-xs font-mono">
            {err}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-divider">
          {allDone ? (
            <>
              <span className="text-[10px] uppercase tracking-widest text-phos">
                ✓ Ready to go
              </span>
              <button
                type="button"
                onClick={onClose}
                className="bg-phos/10 hover:bg-phos/20 active:translate-y-px
                           text-phos text-xs font-bold tracking-wide
                           px-3.5 py-1.5 rounded transition border border-phos/40"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <span className="text-[10px] uppercase tracking-widest text-ink-dim">
                {completedCount}/{total} done
              </span>
              <button
                type="button"
                onClick={dismiss}
                className="text-xs text-ink-muted hover:text-ink-primary
                           px-3 py-1.5 rounded hover:bg-bg-row-alt transition"
              >
                Skip for now
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
