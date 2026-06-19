// Evidence — engagement-wide timeline of every captured artifact.
// TODO: unify scan output, screenshots, command transcripts, and chat turns
// into one timeline per the roadmap. For now a placeholder.

import { useEffect, useState } from "react";
import {
  listResults,
  useActiveEngagementId,
  type ScanResult,
} from "../lib/engagement";

type Props = { onJumpTo: (id: string) => void };

export default function Evidence({ onJumpTo }: Props) {
  const activeId = useActiveEngagementId();
  const [results, setResults] = useState<ScanResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeId) { setResults([]); return; }
    setLoading(true);
    listResults(activeId, 50)
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [activeId]);

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-divider px-6 pt-4 pb-3">
        <div className="text-[10px] uppercase tracking-[0.25em] text-ink-dim">ARTIFACTS</div>
        <h2 className="mt-0.5 text-base font-bold tracking-wide text-ink-primary">
          Evidence
        </h2>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        {!activeId ? (
          <div className="text-ink-dim text-[13px] max-w-2xl">
            No active engagement. Evidence auto-attaches to the active
            engagement as tools run — <button
              onClick={() => onJumpTo("engagements")}
              className="text-accent hover:underline"
            >open Engagements</button> to activate one.
          </div>
        ) : loading ? (
          <div className="text-ink-dim text-[13px]">Loading…</div>
        ) : results.length === 0 ? (
          <div className="text-ink-dim text-[13px] max-w-2xl">
            No evidence captured yet for this engagement. Run a tool from the{" "}
            <button
              onClick={() => onJumpTo("tools")}
              className="text-accent hover:underline"
            >Tool Library</button> and results will appear here automatically.
          </div>
        ) : (
          <div className="space-y-2">
            {results.map((r) => (
              <article key={r.id} className="rounded-md border border-divider bg-bg-card p-3">
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-accent font-mono">{r.tool}</span>
                  <span className="text-ink-dim font-mono">{r.target}</span>
                  <span className="text-ink-dim ml-auto tabular-nums">
                    {new Date(r.ts).toLocaleString()}
                  </span>
                </div>
                {r.summary && (
                  <div className="text-[12px] text-ink-muted mt-1 whitespace-pre-wrap">
                    {r.summary}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
