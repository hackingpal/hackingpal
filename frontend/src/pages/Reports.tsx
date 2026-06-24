// Reports — engagement report generation.
// TODO: list of generated reports + on-demand HTML/MD generation from the
// active engagement. For now: link to the active engagement's report URLs.

import { useState } from "react";
import { requestReportLink, useActiveEngagementId } from "../lib/engagement";

type Props = { onJumpTo: (id: string) => void };

export default function Reports({ onJumpTo }: Props) {
  const activeId = useActiveEngagementId();
  const [error, setError] = useState<string | null>(null);

  async function openReport(format: "html" | "md") {
    if (!activeId) return;
    setError(null);
    try {
      const url = await requestReportLink(activeId, format);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">DELIVERABLES</div>
        <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
          Reports
        </h2>
      </header>
      <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
        {!activeId ? (
          <div className="text-ink-dim text-[13px]">
            No active engagement. <button
              onClick={() => onJumpTo("engagements")}
              className="text-accent hover:underline"
            >Open Engagements</button> to activate one before generating a report.
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-ink-muted text-sm leading-relaxed">
              Generate a report from the active engagement's findings + evidence.
              Open in a new tab.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => openReport("html")}
                className="px-3 py-1.5 rounded bg-accent text-white text-[12px] font-bold
                           hover:bg-accentDim transition"
              >
                Open HTML report
              </button>
              <button
                type="button"
                onClick={() => openReport("md")}
                className="px-3 py-1.5 rounded bg-bg-card border border-divider
                           text-ink-primary text-[12px] hover:border-accent transition"
              >
                Open Markdown
              </button>
            </div>
            {error && <div className="text-[11px] text-danger">{error}</div>}
            <p className="text-ink-dim text-[11px] leading-relaxed pt-3 border-t border-divider mt-3">
              A managed list of versioned reports is on the roadmap. For now
              these endpoints render live from the engagement's current state.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
