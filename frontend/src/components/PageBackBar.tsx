// Thin breadcrumb strip with a prominent Back (and Forward) button.
// Mounts globally in App.tsx between the engagement-tabs strip and <main>,
// so every page picks it up without per-page wiring. Hides itself when
// there's no history on the active tab — that's the "makes sense" gate
// (Home / Engagements list show nothing because back would do nothing).

import {
  canGoBack,
  canGoForward,
  getActiveTabId,
  goBack,
  goForward,
  useTabs,
} from "../lib/engagementTabs";
import { TOP_NAV, TOOL_GROUPS } from "../lib/nav";

function labelFor(id: string): string {
  const top = TOP_NAV.find((n) => n.id === id);
  if (top) return top.label;
  for (const g of TOOL_GROUPS) {
    const it = g.items.find((x) => x.id === id);
    if (it) return it.label;
  }
  return id;
}

export default function PageBackBar() {
  const { tabs, activeTabId } = useTabs();
  const tab = tabs.find((t) => t.id === activeTabId) ?? null;
  if (!tab) return null;

  const back = canGoBack(tab);
  const fwd  = canGoForward(tab);
  if (!back && !fwd) return null;

  const prev = back ? tab.history[tab.history.length - 1] : null;
  const next = fwd  ? tab.forward[tab.forward.length - 1] : null;

  return (
    <div className="flex items-center gap-2 px-3 py-1 border-b border-divider
                    bg-bg-sidebar text-[11px] text-ink-muted">
      <button
        onClick={() => goBack(getActiveTabId())}
        disabled={!back}
        title={prev ? `Back to ${labelFor(prev)}` : "Back"}
        className={
          "flex items-center gap-1.5 px-2 py-0.5 rounded transition " +
          (back
            ? "hover:bg-bg-nav-hover hover:text-ink-primary"
            : "opacity-30 cursor-not-allowed")
        }
      >
        <span className="text-[13px] leading-none">←</span>
        <span>Back</span>
        {prev && (
          <span className="text-ink-dim">· {labelFor(prev)}</span>
        )}
      </button>
      <button
        onClick={() => goForward(getActiveTabId())}
        disabled={!fwd}
        title={next ? `Forward to ${labelFor(next)}` : "Forward"}
        className={
          "flex items-center gap-1.5 px-2 py-0.5 rounded transition " +
          (fwd
            ? "hover:bg-bg-nav-hover hover:text-ink-primary"
            : "opacity-30 cursor-not-allowed")
        }
      >
        <span>Forward</span>
        <span className="text-[13px] leading-none">→</span>
      </button>
      <span className="ml-auto text-ink-dim tracking-wider uppercase
                       text-[10px]">
        {labelFor(tab.activePage)}
      </span>
    </div>
  );
}
