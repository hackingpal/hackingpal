// Targets — top-level view of in-scope targets across engagements.
// TODO: surface the active engagement's scope here with per-target status
// (last scanned, evidence count, findings count). For now a placeholder.

import { useActiveEngagementId } from "../lib/engagement";

type Props = { onJumpTo: (id: string) => void };

export default function Targets({ onJumpTo }: Props) {
  const activeId = useActiveEngagementId();
  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">SCOPE</div>
        <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
          Targets
        </h2>
      </header>
      <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
        <p className="text-ink-muted text-sm leading-relaxed mb-4">
          A unified view of in-scope targets — last scanned, evidence count,
          open findings — is on the roadmap. For now, scope lives inside each
          engagement.
        </p>
        {activeId ? (
          <button
            onClick={() => onJumpTo("engagements")}
            className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                       hover:bg-accentDim transition"
          >
            Edit active engagement scope →
          </button>
        ) : (
          <div className="text-ink-dim text-[13px]">
            No active engagement. <button
              onClick={() => onJumpTo("engagements")}
              className="text-accent hover:underline"
            >Open Engagements</button> to create or activate one.
          </div>
        )}
      </div>
    </div>
  );
}
