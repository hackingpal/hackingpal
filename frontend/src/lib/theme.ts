// Theme management: dark / light / system, persisted to localStorage.
//
// `system` follows the OS preference live via `prefers-color-scheme`.
// The resolved mode is applied as a class on <html> so CSS variables in
// index.css can swap.

import { useEffect, useState } from "react";

export type ThemeChoice = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const STORAGE_KEY = "mhp:theme";

function loadChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "dark" || v === "light" || v === "system") return v;
  } catch { /* ignore */ }
  return "system";
}

function saveChoice(c: ThemeChoice): void {
  try { localStorage.setItem(STORAGE_KEY, c); } catch { /* ignore */ }
}

function systemPrefersLight(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia
    && window.matchMedia("(prefers-color-scheme: light)").matches;
}

function resolve(choice: ThemeChoice): ResolvedTheme {
  if (choice === "system") return systemPrefersLight() ? "light" : "dark";
  return choice;
}

function apply(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  if (resolved === "light") root.classList.add("light");
  else root.classList.remove("light");
}

// Apply on import so the *first* paint is already correct (no dark flash on
// reload when user picked light). Re-applied by the hook on every change.
if (typeof document !== "undefined") {
  apply(resolve(loadChoice()));
}

export function useTheme(): {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (c: ThemeChoice) => void;
  cycle: () => void;
} {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => loadChoice());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(loadChoice()));

  // Re-resolve and re-apply when `choice` changes
  useEffect(() => {
    const r = resolve(choice);
    setResolved(r);
    apply(r);
  }, [choice]);

  // When `choice === "system"`, listen for OS-level changes
  useEffect(() => {
    if (choice !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => {
      const r: ResolvedTheme = mql.matches ? "light" : "dark";
      setResolved(r);
      apply(r);
    };
    mql.addEventListener?.("change", handler);
    return () => mql.removeEventListener?.("change", handler);
  }, [choice]);

  function setChoice(c: ThemeChoice): void {
    saveChoice(c);
    setChoiceState(c);
  }

  function cycle(): void {
    setChoice(choice === "dark" ? "light" : choice === "light" ? "system" : "dark");
  }

  return { choice, resolved, setChoice, cycle };
}
