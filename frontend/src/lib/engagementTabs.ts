// Per-tab navigation state for the Kali-style multi-engagement workspace.
//
// Each tab holds its own engagement context + page history. Switching tabs
// also flips the global activeEngagementId so the existing engagement-aware
// recording pipeline (see lib/engagement.ts) keeps working untouched.

import { useEffect, useState } from "react";
import { setActiveEngagementId } from "./engagement";

export type Tab = {
  id: string;
  engagementId: string | null;
  label: string;
  activePage: string;
  history: string[];
  forward: string[];
};

const TABS_KEY = "mhp:tabs:v1";
const ACTIVE_TAB_KEY = "mhp:tabs:active:v1";
const MAX_HISTORY = 50;

// Tiny URL-safe id — avoids pulling nanoid as a dep just for this.
function makeId(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

function loadTabs(): Tab[] {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Tab[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t) =>
        t && typeof t.id === "string" && typeof t.activePage === "string",
    );
  } catch {
    return [];
  }
}

function loadActive(): string {
  try {
    return localStorage.getItem(ACTIVE_TAB_KEY) ?? "";
  } catch {
    return "";
  }
}

let tabs: Tab[] = loadTabs();
let activeTabId: string = loadActive();

if (tabs.length === 0) {
  const seed: Tab = {
    id: makeId(),
    engagementId: null,
    label: "Lab",
    activePage: "home",
    history: [],
    forward: [],
  };
  tabs = [seed];
  activeTabId = seed.id;
} else if (!tabs.some((t) => t.id === activeTabId)) {
  activeTabId = tabs[0].id;
}

const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}

function persist() {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
    localStorage.setItem(ACTIVE_TAB_KEY, activeTabId);
  } catch {
    /* quota — ignore */
  }
}

function syncActiveEngagement() {
  const t = tabs.find((x) => x.id === activeTabId);
  setActiveEngagementId(t ? t.engagementId : null);
}

export function getTabs(): Tab[] {
  return tabs;
}

export function getActiveTabId(): string {
  return activeTabId;
}

export function useTabs(): { tabs: Tab[]; activeTabId: string } {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return { tabs, activeTabId };
}

export function openTab(
  engagementId: string | null,
  label: string,
  page: string = "home",
): string {
  const t: Tab = {
    id: makeId(),
    engagementId,
    label,
    activePage: page,
    history: [],
    forward: [],
  };
  tabs = [...tabs, t];
  activeTabId = t.id;
  persist();
  syncActiveEngagement();
  notify();
  return t.id;
}

export function closeTab(tabId: string): void {
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;
  const wasActive = tabId === activeTabId;
  tabs = tabs.filter((t) => t.id !== tabId);

  if (tabs.length === 0) {
    const seed: Tab = {
      id: makeId(),
      engagementId: null,
      label: "Lab",
      activePage: "home",
      history: [],
      forward: [],
    };
    tabs = [seed];
    activeTabId = seed.id;
  } else if (wasActive) {
    // Prefer the neighbour to the right (matches browser tab behaviour),
    // fall back to the new last tab.
    const next = tabs[idx] ?? tabs[tabs.length - 1];
    activeTabId = next.id;
  }
  persist();
  syncActiveEngagement();
  notify();
}

export function setActiveTab(tabId: string): void {
  if (!tabs.some((t) => t.id === tabId)) return;
  if (activeTabId === tabId) return;
  activeTabId = tabId;
  persist();
  syncActiveEngagement();
  notify();
}

export function setTabPage(tabId: string, page: string): void {
  const t = tabs.find((x) => x.id === tabId);
  if (!t) return;
  if (t.activePage === page) return;
  const newHistory = [...t.history, t.activePage];
  if (newHistory.length > MAX_HISTORY) newHistory.shift();
  const updated: Tab = {
    ...t,
    history: newHistory,
    forward: [],
    activePage: page,
  };
  tabs = tabs.map((x) => (x.id === tabId ? updated : x));
  persist();
  notify();
}

export function goBack(tabId: string): void {
  const t = tabs.find((x) => x.id === tabId);
  if (!t || t.history.length === 0) return;
  const prev = t.history[t.history.length - 1];
  const updated: Tab = {
    ...t,
    history: t.history.slice(0, -1),
    forward: [t.activePage, ...t.forward],
    activePage: prev,
  };
  tabs = tabs.map((x) => (x.id === tabId ? updated : x));
  persist();
  notify();
}

export function goForward(tabId: string): void {
  const t = tabs.find((x) => x.id === tabId);
  if (!t || t.forward.length === 0) return;
  const next = t.forward[0];
  const updated: Tab = {
    ...t,
    history: [...t.history, t.activePage],
    forward: t.forward.slice(1),
    activePage: next,
  };
  tabs = tabs.map((x) => (x.id === tabId ? updated : x));
  persist();
  notify();
}

export function canGoBack(tab: Tab): boolean {
  return tab.history.length > 0;
}

export function canGoForward(tab: Tab): boolean {
  return tab.forward.length > 0;
}
