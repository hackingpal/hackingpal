// Top-bar pill for the Lab / Engagement mode switch.
//
// Lab mode (default) skips engagement-scope enforcement and silences
// auto-record. Engagement mode enforces scope against the active
// engagement and auto-records evidence. The flag is persisted per-window
// in localStorage and sent on every backend request.
//
// Flipping into Engagement mode is a deliberate action — the user is
// asserting they have authorization for the active engagement's scope —
// so we gate the transition behind a confirm dialog. Flipping back to
// Lab is one click since it only ever loosens enforcement.

import { useEffect, useRef, useState } from "react";
import { setMode, useMode, type Mode } from "../lib/mode";
import { useActiveEngagementId } from "../lib/engagement";

type Props = {
  onOpenEngagementsPage: () => void;
};

export default function ModePill({ onOpenEngagementsPage }: Props) {
  const mode = useMode();
  const activeId = useActiveEngagementId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setConfirmOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [confirmOpen]);

  function handleClick() {
    if (mode === "lab") {
      setConfirmOpen(true);
    } else {
      setMode("lab");
    }
  }

  function confirmSwitch() {
    setMode("engagement");
    setConfirmOpen(false);
  }

  const isEngagement = mode === "engagement";
  const labelText: Record<Mode, string> = {
    lab: "LAB MODE",
    engagement: "ENGAGEMENT",
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={handleClick}
        title={
          isEngagement
            ? "Engagement mode — scope enforced, evidence auto-recorded. Click to switch back to Lab."
            : "Lab mode — free experimentation, no scope checks. Click to enter Engagement mode."
        }
        className={
          "flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] tracking-wider " +
          "border transition leading-none " +
          (isEngagement
            ? "border-phos/40 text-phos hover:border-phos"
            : "border-amber/40 text-amber hover:border-amber")
        }
      >
        <span
          className={
            "inline-block w-1.5 h-1.5 rounded-full " +
            (isEngagement ? "bg-phos" : "bg-amber")
          }
        />
        <span className="uppercase">{labelText[mode]}</span>
      </button>

      {confirmOpen && (
        <div
          className="absolute right-0 top-full mt-1 w-80 bg-bg-card border border-divider
                     rounded shadow-2xl z-50 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-divider text-[10px] tracking-widest text-ink-muted">
            ENTER ENGAGEMENT MODE
          </div>
          <div className="px-3 py-3 text-[12px] text-ink-primary space-y-2">
            <p>
              Engagement mode enforces the active engagement's scope on every
              target-accepting tool and records results to the evidence
              timeline.
            </p>
            {!activeId && (
              <p className="text-amber text-[11px]">
                No active engagement. Tools that take a target will be denied
                until you{" "}
                <button
                  type="button"
                  onClick={() => { setConfirmOpen(false); onOpenEngagementsPage(); }}
                  className="underline hover:text-ink-primary"
                >
                  pick one
                </button>
                .
              </p>
            )}
            <p className="text-[11px] text-ink-muted">
              Only enable this when you have written authorization to test
              the targets in scope.
            </p>
          </div>
          <div className="flex border-t border-divider">
            <button
              onClick={() => setConfirmOpen(false)}
              className="flex-1 px-3 py-2 text-[11px] text-ink-muted hover:bg-bg-nav-hover"
            >
              Cancel
            </button>
            <button
              onClick={confirmSwitch}
              className="flex-1 px-3 py-2 text-[11px] text-phos border-l border-divider
                         hover:bg-bg-nav-hover"
            >
              I have authorization — enable
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
