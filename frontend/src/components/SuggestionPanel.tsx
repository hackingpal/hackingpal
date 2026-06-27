// Approval cards for chat-proposed checks. The copilot proposes a bounded
// set of checks (api.suggestChecks); each renders here as an Approve / Skip /
// Modify card. Approve hands the (possibly edited) check back to the parent,
// which navigates to the tool page with the target pre-filled — the copilot
// proposes, the operator approves, nothing runs from here.
//
// Card state and the Approve payloads live in lib/suggestion (tested); this
// component is the rendering + local interaction shell.

import { useState } from "react";
import type { SuggestedCheck } from "../api";
import { canApprove, withTarget, type CardStatus } from "../lib/suggestion";

type Props = {
  checks: SuggestedCheck[];
  onApprove: (check: SuggestedCheck) => void;
  onClose: () => void;
};

export default function SuggestionPanel({ checks, onApprove, onClose }: Props) {
  // Per-card status + an optional in-progress target edit, keyed by index
  // (the proposal list is stable for the life of the panel).
  const [status, setStatus] = useState<Record<number, CardStatus>>({});
  const [edits, setEdits] = useState<Record<number, SuggestedCheck>>({});

  const cardFor = (i: number) => edits[i] ?? checks[i];
  const statusFor = (i: number) => status[i] ?? "pending";

  return (
    <div className="mb-2 rounded-lg border border-accent/40 bg-bg-elevated/95 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-divider">
        <span className="text-[10px] uppercase tracking-[0.2em] text-ink-muted flex-1">
          Proposed checks
        </span>
        <button
          onClick={onClose}
          aria-label="Dismiss proposed checks"
          className="text-ink-dim hover:text-ink-primary text-sm leading-none px-1"
        >
          ✕
        </button>
      </div>

      <div className="divide-y divide-divider">
        {checks.map((_, i) => {
          const card = cardFor(i);
          const st = statusFor(i);
          return (
            <Card
              key={i}
              check={card}
              status={st}
              onApprove={() => {
                setStatus((s) => ({ ...s, [i]: "approved" }));
                onApprove(card);
              }}
              onSkip={() => setStatus((s) => ({ ...s, [i]: "skipped" }))}
              onModify={(target) =>
                setEdits((e) => ({ ...e, [i]: withTarget(card, target) }))
              }
            />
          );
        })}
      </div>
    </div>
  );
}

function Card({
  check, status, onApprove, onSkip, onModify,
}: {
  check: SuggestedCheck;
  status: CardStatus;
  onApprove: () => void;
  onSkip: () => void;
  onModify: (target: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(check.target);
  const settled = status !== "pending";

  return (
    <div className={"px-3 py-2 " + (settled ? "opacity-60" : "")}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-ink-primary font-medium">{check.label}</span>
        <span className="text-[10px] text-ink-dim font-mono truncate flex-1">
          {check.target}
        </span>
        {status === "approved" && <span className="text-[10px] text-success">approved →</span>}
        {status === "skipped" && <span className="text-[10px] text-ink-dim">skipped</span>}
      </div>

      {check.rationale && !settled && (
        <div className="text-[10px] text-ink-muted mt-0.5">{check.rationale}</div>
      )}

      {editing && !settled && (
        <div className="flex items-center gap-1 mt-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="flex-1 bg-bg-base border border-divider rounded px-2 py-1
                       text-[11px] font-mono text-ink-primary"
            placeholder="target host / url"
          />
          <button
            onClick={() => { onModify(draft); setEditing(false); }}
            className="text-[10px] uppercase tracking-wider text-accent px-2 py-1
                       border border-accent/40 rounded hover:bg-accent/10"
          >
            Set
          </button>
        </div>
      )}

      {!settled && !editing && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <button
            onClick={onApprove}
            disabled={!canApprove(check, status)}
            className="text-[10px] uppercase tracking-wider px-2 py-1 rounded
                       border border-accent/50 text-accent hover:bg-accent/10
                       disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Approve
          </button>
          <button
            onClick={onSkip}
            className="text-[10px] uppercase tracking-wider px-2 py-1 rounded
                       border border-divider text-ink-muted hover:text-ink-primary
                       hover:border-ink-muted transition"
          >
            Skip
          </button>
          <button
            onClick={() => { setDraft(check.target); setEditing(true); }}
            className="text-[10px] uppercase tracking-wider px-2 py-1 rounded
                       border border-divider text-ink-muted hover:text-ink-primary
                       hover:border-ink-muted transition"
          >
            Modify
          </button>
        </div>
      )}
    </div>
  );
}
