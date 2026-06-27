// Top-bar pill showing the active engagement. Click → dropdown with quick
// switch + "Open Engagements" deep-link. Live-syncs with localStorage.

import { useEffect, useRef, useState } from "react";
import {
  listEngagements,
  setActiveEngagementId,
  useActiveEngagementId,
  type Engagement,
} from "../lib/engagement";

type Props = {
  onOpenEngagementsPage: () => void;
};

export default function EngagementPill({ onOpenEngagementsPage }: Props) {
  const activeId = useActiveEngagementId();
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    try {
      setEngagements(await listEngagements(false));
    } catch { /* backend may not be up yet */ }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const active = engagements.find((e) => e.id === activeId) ?? null;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Active engagement"
        className={
          "flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] tracking-wider " +
          "border transition leading-none whitespace-nowrap shrink-0 " +
          (active
            ? "border-ink-primary/50 text-ink-primary hover:border-ink-primary"
            : "border-divider text-ink-dim hover:border-ink-muted hover:text-ink-primary")
        }
      >
        <span
          aria-hidden
          className={active ? "text-ink-primary" : "text-ink-dim"}
          style={{ fontSize: 9, lineHeight: 1 }}
        >
          ▪
        </span>
        <span className={"max-w-[180px] truncate " + (active ? "" : "uppercase")}>
          {active ? active.name : "No engagement"}
        </span>
        <span className="text-ink-dim">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-bg-card border border-divider
                        rounded shadow-2xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-divider text-[10px] tracking-widest text-ink-muted">
            ACTIVE ENGAGEMENT
          </div>

          <button
            onClick={() => { setActiveEngagementId(null); setOpen(false); }}
            className={
              "w-full text-left px-3 py-2 text-[12px] " +
              (activeId === null
                ? "bg-bg-nav-active text-ink-primary"
                : "text-ink-muted hover:bg-bg-nav-hover")
            }
          >
            <div className="flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-ink-dim" />
              None (don't auto-record)
            </div>
          </button>

          <div className="max-h-64 overflow-y-auto border-t border-divider">
            {engagements.length === 0 && (
              <div className="px-3 py-3 text-[11px] text-ink-dim italic">
                No engagements yet.
              </div>
            )}
            {engagements.map((e) => (
              <button
                key={e.id}
                onClick={() => { setActiveEngagementId(e.id); setOpen(false); }}
                className={
                  "w-full text-left px-3 py-2 text-[12px] " +
                  (e.id === activeId
                    ? "bg-bg-nav-active text-ink-primary"
                    : "text-ink-primary hover:bg-bg-nav-hover")
                }
              >
                <div className="flex items-center gap-2">
                  <span className={"inline-block w-1.5 h-1.5 rounded-full " +
                    (e.id === activeId ? "bg-ink-primary" : "bg-ink-dim")} />
                  <span className="flex-1 truncate">{e.name}</span>
                  <span className="text-[9px] text-ink-dim uppercase">{e.status}</span>
                </div>
              </button>
            ))}
          </div>

          <button
            onClick={() => { setOpen(false); onOpenEngagementsPage(); }}
            className="w-full text-left px-3 py-2 text-[11px] border-t border-divider
                       text-ink-primary hover:bg-bg-nav-hover"
          >
            Manage engagements →
          </button>
        </div>
      )}
    </div>
  );
}
