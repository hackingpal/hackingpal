// Generic placeholder rendered when the user navigates to a planned tool.
// Just shows the description plus a hint on how to get it built.

import { findPlannedTool, removePlannedTool } from "../lib/plannedTools";

type Props = {
  id: string;
  onOpenCatalog: () => void;
  onAfterRemove: () => void;
};

export default function PlannedToolPage({ id, onOpenCatalog, onAfterRemove }: Props) {
  const tool = findPlannedTool(id);

  if (!tool) {
    // Stale id (e.g. removed from another window). Just punt.
    return (
      <div className="h-full p-6 flex flex-col items-center justify-center text-ink-dim">
        <p>This planned tool no longer exists.</p>
        <button onClick={onOpenCatalog}
                className="mt-4 px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold">
          Open Tool Catalog
        </button>
      </div>
    );
  }

  function remove() {
    if (!tool) return;
    if (!confirm(`Remove "${tool.label}" from the planned list?`)) return;
    removePlannedTool(tool.id);
    onAfterRemove();
  }

  return (
    <div className="h-full p-6 overflow-y-auto">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] tracking-widest text-amber bg-amber/10
                           border border-amber/30 rounded px-1.5 py-0.5">
            PLANNED
          </span>
          <span className="text-[10px] text-ink-dim">
            added {new Date(tool.addedAt).toLocaleString()}
          </span>
        </div>

        <h1 className="text-[22px] font-bold text-ink-primary tracking-wide mb-3">
          {tool.label}
        </h1>

        <div className="bg-bg-card border border-divider rounded p-4 mb-4">
          <div className="text-[11px] text-ink-muted tracking-wider mb-2">DESCRIPTION</div>
          <div className="text-[13px] text-ink-primary whitespace-pre-wrap leading-relaxed">
            {tool.description || (
              <span className="italic text-ink-dim">
                No description yet. Open the catalog (+ in the top bar) to edit.
              </span>
            )}
          </div>
        </div>

        <div className="bg-bg-card border border-divider rounded p-4 mb-4">
          <div className="text-[11px] text-ink-muted tracking-wider mb-2">NEXT STEPS</div>
          <p className="text-[12px] text-ink-primary mb-2">
            When you're ready to build this, open the AI chat (bottom-right
            bubble) and say something like:
          </p>
          <pre className="bg-bg-panel border border-divider rounded p-2 text-[12px]
                          text-phos whitespace-pre-wrap">
            implement the "{tool.label}" tool: {tool.description.split("\n")[0]
              || "(see the description on this page)"}
          </pre>
        </div>

        <div className="flex gap-2">
          <button onClick={onOpenCatalog}
                  className="px-3 py-1.5 rounded bg-bg-base border border-divider
                             text-ink-primary text-[12px] hover:bg-bg-nav-hover">
            Edit in catalog
          </button>
          <button onClick={remove}
                  className="px-3 py-1.5 rounded bg-bg-base border border-danger
                             text-danger text-[12px]">
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
