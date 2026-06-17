// Kali-style multi-engagement tab strip. Renders below the title bar and
// above <main>. Each tab owns its own page + back/forward history; clicking
// a tab also flips the global activeEngagementId so auto-recording stays
// pinned to whichever engagement the user is looking at.

import { useEffect, useRef, useState } from "react";
import {
  canGoBack,
  canGoForward,
  closeTab,
  goBack,
  goForward,
  openTab,
  setActiveTab,
  useTabs,
} from "../lib/engagementTabs";
import { listEngagements, type Engagement } from "../lib/engagement";

type Props = {
  onChange: (page: string) => void;
};

export default function EngagementTabs({ onChange }: Props) {
  const { tabs, activeTabId } = useTabs();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const pickerRef = useRef<HTMLDivElement>(null);
  const lastSyncedTabRef = useRef<string>("");
  const lastSyncedPageRef = useRef<string>("");

  const active = tabs.find((t) => t.id === activeTabId) ?? null;

  // Sync App.tsx's `active` state when the active tab changes OR when the
  // active tab's page changes from back/forward navigation. We dedupe so we
  // don't fight App.tsx's own setActive on first render.
  useEffect(() => {
    if (!active) return;
    if (
      lastSyncedTabRef.current === active.id &&
      lastSyncedPageRef.current === active.activePage
    ) {
      return;
    }
    lastSyncedTabRef.current = active.id;
    lastSyncedPageRef.current = active.activePage;
    onChange(active.activePage);
  }, [active, onChange]);

  async function refreshEngagements() {
    try {
      setEngagements(await listEngagements(false));
    } catch {
      /* backend may not be up */
    }
  }

  useEffect(() => {
    if (pickerOpen) void refreshEngagements();
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(e.target as Node)
      ) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [pickerOpen]);

  function handleNewLab() {
    openTab(null, "Lab", "home");
    setPickerOpen(false);
  }

  function handleAttach(e: Engagement) {
    openTab(e.id, e.name, "dashboard");
    setPickerOpen(false);
  }

  function handleClose(e: React.MouseEvent, tabId: string) {
    e.stopPropagation();
    closeTab(tabId);
  }

  const activeIds = new Set(
    tabs.map((t) => t.engagementId).filter((x): x is string => !!x),
  );
  const attachable = engagements.filter((e) => e.status === "active");

  return (
    <div
      className="h-8 border-b border-divider bg-bg-sidebar flex items-stretch
                 text-[11px] font-mono select-none"
    >
      <div className="flex items-center gap-0.5 px-1.5 border-r border-divider">
        <button
          onClick={() => active && goBack(active.id)}
          disabled={!active || !canGoBack(active)}
          title="Back"
          className="w-6 h-6 flex items-center justify-center rounded
                     text-ink-muted hover:text-ink-primary hover:bg-bg-nav-hover
                     disabled:opacity-30 disabled:hover:bg-transparent
                     disabled:hover:text-ink-muted transition leading-none"
          aria-label="Back"
        >
          ←
        </button>
        <button
          onClick={() => active && goForward(active.id)}
          disabled={!active || !canGoForward(active)}
          title="Forward"
          className="w-6 h-6 flex items-center justify-center rounded
                     text-ink-muted hover:text-ink-primary hover:bg-bg-nav-hover
                     disabled:opacity-30 disabled:hover:bg-transparent
                     disabled:hover:text-ink-muted transition leading-none"
          aria-label="Forward"
        >
          →
        </button>
      </div>

      <div className="flex-1 flex items-stretch overflow-x-auto min-w-0">
        {tabs.map((t) => {
          const isActive = t.id === activeTabId;
          return (
            <div
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              role="tab"
              aria-selected={isActive}
              className={
                "group flex items-center gap-1.5 px-2.5 h-full cursor-pointer " +
                "border-r border-divider min-w-[120px] max-w-[200px] " +
                "transition " +
                (isActive
                  ? "bg-bg-card text-ink-primary border-b-2 border-b-accent -mb-px"
                  : "text-ink-muted hover:text-ink-primary hover:bg-bg-nav-hover")
              }
            >
              <span
                className={
                  "inline-block w-1.5 h-1.5 rounded-full shrink-0 " +
                  (t.engagementId
                    ? isActive
                      ? "bg-accent"
                      : "bg-accentDim"
                    : "bg-ink-dim")
                }
              />
              <span className="flex-1 truncate text-[11px] tracking-wide">
                {t.label}
              </span>
              <button
                onClick={(e) => handleClose(e, t.id)}
                title="Close tab"
                aria-label={`Close ${t.label}`}
                className="w-4 h-4 flex items-center justify-center rounded
                           text-ink-dim hover:text-danger hover:bg-bg-base
                           opacity-0 group-hover:opacity-100 transition
                           text-[12px] leading-none"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* "+" picker lives OUTSIDE the overflow-x-auto strip so its dropdown
          isn't clipped by the strip's computed overflow-y. */}
      <div ref={pickerRef} className="relative flex items-center shrink-0 border-l border-divider">
        <button
          onClick={() => setPickerOpen((v) => !v)}
          title="New tab"
          aria-label="New tab"
          className="w-8 h-full flex items-center justify-center
                     text-ink-muted hover:text-ink-primary hover:bg-bg-nav-hover
                     transition text-[14px] leading-none"
        >
          +
        </button>
        {pickerOpen && (
          <div
            className="absolute right-0 top-full mt-1 w-64 bg-bg-card border
                       border-divider rounded shadow-2xl z-50 overflow-hidden"
          >
            <div
              className="px-3 py-2 border-b border-divider text-[10px]
                         tracking-widest text-ink-muted"
            >
              NEW TAB
            </div>
            <button
              onClick={handleNewLab}
              className="w-full text-left px-3 py-2 text-[12px] text-ink-primary
                         hover:bg-bg-nav-hover flex items-center gap-2"
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-ink-dim" />
              Lab tab
              <span className="text-ink-dim text-[10px] ml-auto">no engagement</span>
            </button>
            <div className="max-h-64 overflow-y-auto border-t border-divider">
              <div
                className="px-3 py-1.5 text-[10px] tracking-widest text-ink-muted
                           bg-bg-base/40"
              >
                ACTIVE ENGAGEMENTS
              </div>
              {attachable.length === 0 && (
                <div className="px-3 py-3 text-[11px] text-ink-dim italic">
                  No active engagements.
                </div>
              )}
              {attachable.map((e) => {
                const already = activeIds.has(e.id);
                return (
                  <button
                    key={e.id}
                    onClick={() => handleAttach(e)}
                    className="w-full text-left px-3 py-2 text-[12px]
                               text-ink-primary hover:bg-bg-nav-hover
                               flex items-center gap-2"
                  >
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent" />
                    <span className="flex-1 truncate">{e.name}</span>
                    {already && (
                      <span className="text-[9px] text-amber uppercase">
                        open
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
