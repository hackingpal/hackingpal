// Promote-to-Finding — small button that opens a modal pre-filled from the
// scan result it sits next to, then POSTs to /findings against the active
// engagement. Findings always belong to an engagement; if none is active,
// the button surfaces the same warning the engagement-mode pages use and
// disables the form until the user picks/creates one.
//
// Used by Port Scanner, Nmap, TLS Auditor, and the shared web-exploit
// AttackResults. Each call site supplies the seed values (title, severity
// heuristic, tool, target, evidence) — the modal stays the same shape.

import { useEffect, useRef, useState } from "react";
import {
  FINDING_SEVERITIES,
  promoteToFinding,
  summarizeFinding,
  useActiveEngagementId,
  type FindingSeverity,
} from "../lib/engagement";

export type PromoteSeed = {
  /** Tool that produced the result. Stored on the finding and audited. */
  tool: string;
  /** Best-effort target string (host, URL, IP, …). */
  target: string;
  /** Pre-filled title — editable. */
  title: string;
  /** Severity heuristic from the call site — editable. */
  severity: FindingSeverity;
  /** Raw scan output snippet captured for the evidence field. */
  evidence: string;
  /** Optional pre-filled description. */
  description?: string;
};

type Props = {
  seed: PromoteSeed;
  /** Visual style: row-level small button, or banner-style large CTA. */
  variant?: "compact" | "default";
  /** Override label — defaults to "Promote". */
  label?: string;
  /** Optional callback after a successful promote. */
  onPromoted?: () => void;
};

export default function PromoteToFindingButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Promote this result to a tracked finding on the active engagement"
        className={
          props.variant === "compact"
            ? "px-1.5 py-0.5 text-[10px] uppercase tracking-widest rounded " +
              "border border-divider text-ink-muted " +
              "hover:border-accent hover:text-accent transition opacity-80 group-hover:opacity-100"
            : "px-2 py-1 text-[11px] uppercase tracking-widest rounded " +
              "border border-accent/40 bg-accent/10 text-accent " +
              "hover:bg-accent/20 transition"
        }
      >
        ⬆ {props.label ?? "Promote"}
      </button>
      {open && (
        <PromoteModal seed={props.seed} onClose={() => setOpen(false)}
                      onPromoted={props.onPromoted} />
      )}
    </>
  );
}

function PromoteModal({
  seed, onClose, onPromoted,
}: {
  seed: PromoteSeed;
  onClose: () => void;
  onPromoted?: () => void;
}) {
  const activeId = useActiveEngagementId();
  const [title, setTitle] = useState(seed.title);
  const [severity, setSeverity] = useState<FindingSeverity>(seed.severity);
  const [target, setTarget] = useState(seed.target);
  const [evidence, setEvidence] = useState(seed.evidence);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Autofocus the title — it's the most likely thing the user edits.
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  // Esc to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    if (!activeId || !title.trim()) return;
    setSaving(true); setError("");
    try {
      const f = await promoteToFinding({
        engagement_id: activeId,
        title:       title.trim(),
        severity,
        // Seed-provided description carries through (e.g. TLS auditor's
        // per-finding detail). The AI summary lands separately in
        // `ai_summary` — the manual description text input was removed
        // from the modal because the AI fills that role now.
        description: (seed.description ?? "").trim(),
        tool:        seed.tool,
        target:      target.trim(),
        evidence:    evidence,
      });
      setSavedId(f.id);
      onPromoted?.();
      // Kick the AI summary in the background. Failures (no API key, rate
      // limit) are intentionally swallowed — the finding still exists and
      // the detail page exposes a "Generate AI summary" retry button.
      void summarizeFinding(f.id).catch(() => { /* surfaced on detail page */ });
      // Slightly longer than before so the user sees the "summarizing" hint
      // before the modal closes.
      window.setTimeout(() => onClose(), 1400);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-bg-base/70 backdrop-blur-sm flex items-start
                    justify-center pt-[8vh] px-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-xl bg-bg-card border border-divider rounded-lg
                      shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center px-4 py-3 border-b border-divider">
          <span className="text-accent text-[11px] font-bold tracking-widest">
            PROMOTE TO FINDING
          </span>
          <span className="text-[10px] text-ink-dim ml-3 truncate">
            from <code>{seed.tool || "(unknown tool)"}</code>
          </span>
          <span className="flex-1" />
          <button onClick={onClose} className="text-ink-muted hover:text-ink-primary px-1">✕</button>
        </div>

        {!activeId ? (
          <div className="p-5 text-[12px] text-ink-muted leading-relaxed">
            <p className="mb-2 text-ink-primary font-bold">No active engagement.</p>
            <p>
              Findings always belong to an engagement. Open the engagement pill
              in the top bar and select (or create) one, then promote this
              result again.
            </p>
            <div className="mt-4 flex justify-end">
              <button onClick={onClose}
                      className="px-3 py-1.5 rounded border border-divider text-ink-muted text-[12px]">
                Close
              </button>
            </div>
          </div>
        ) : savedId ? (
          <div className="p-5 text-[12px] text-phos space-y-1">
            <div>✓ Promoted — finding created on the active engagement.</div>
            <div className="text-ink-muted">
              ✨ Summarizing evidence… open the Findings tab to see it land.
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div>
                <label className="block text-[11px] text-ink-muted tracking-wider mb-1">TITLE</label>
                <input
                  ref={titleRef}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Short, descriptive title"
                  className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                             text-[13px] focus:outline-none focus:border-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-ink-muted tracking-wider mb-1">SEVERITY</label>
                  <select value={severity}
                          onChange={(e) => setSeverity(e.target.value as FindingSeverity)}
                          className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                     text-[12px] focus:outline-none focus:border-accent">
                    {FINDING_SEVERITIES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-ink-muted tracking-wider mb-1">TARGET</label>
                  <input value={target}
                         onChange={(e) => setTarget(e.target.value)}
                         className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                    text-[12px] font-mono focus:outline-none focus:border-accent" />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-ink-muted tracking-wider mb-1">EVIDENCE</label>
                <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)}
                          rows={6}
                          className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                                     text-[11px] font-mono focus:outline-none focus:border-accent" />
              </div>

              {error && <div className="text-[12px] text-danger">⚠ {error}</div>}
            </div>

            <div className="border-t border-divider px-4 py-3 flex gap-2 justify-end items-center">
              <span className="flex-1 text-[10px] text-ink-dim">
                Posts to the active engagement and writes an audit-log row.
              </span>
              <button onClick={onClose}
                      className="px-3 py-1.5 rounded border border-divider text-ink-muted text-[12px]">
                Cancel
              </button>
              <button onClick={save} disabled={saving || !title.trim()}
                      className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                                 disabled:opacity-40 disabled:cursor-not-allowed">
                {saving ? "Saving…" : "Create finding"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
