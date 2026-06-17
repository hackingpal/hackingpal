// Persistent per-tool flags for the SetupWizard. Each tool tracks two bits:
//   - "dismissed" — user closed or skipped the wizard; auto-open is suppressed
//                   until either the tool's setup state changes externally or
//                   the user re-opens it manually.
//   - "completed" — user finished the wizard at least once. Auto-open stays
//                   suppressed; the wizard is still re-openable via the
//                   in-page "Run setup" link.
//
// Auto-open rule on each page: open when the tool reports needsSetup AND the
// user has not dismissed AND has not previously completed.

const NS = "mhp:setup:";
type Flag = "dismissed" | "completed";

function key(toolKey: string, flag: Flag): string {
  return `${NS}${toolKey}:${flag}`;
}

function read(toolKey: string, flag: Flag): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(key(toolKey, flag)) === "1"; }
  catch { return false; }
}

function write(toolKey: string, flag: Flag, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key(toolKey, flag), "1");
    else window.localStorage.removeItem(key(toolKey, flag));
    window.dispatchEvent(new CustomEvent("mhp:setup-changed", {
      detail: { toolKey, flag, value },
    }));
  } catch { /* quota / disabled storage — ignore */ }
}

export function isSetupDismissed(toolKey: string): boolean {
  return read(toolKey, "dismissed");
}

export function isSetupCompleted(toolKey: string): boolean {
  return read(toolKey, "completed");
}

export function markSetupDismissed(toolKey: string): void {
  write(toolKey, "dismissed", true);
}

export function markSetupCompleted(toolKey: string): void {
  write(toolKey, "completed", true);
  // Re-completing implicitly un-dismisses, so a future re-setup cycle won't
  // get blocked by a stale dismissed flag.
  write(toolKey, "dismissed", false);
}

export function resetSetup(toolKey: string): void {
  write(toolKey, "completed", false);
  write(toolKey, "dismissed", false);
}

/**
 * Should the wizard auto-open on mount? True only when the tool currently
 * needs setup AND the user has neither dismissed nor completed it before.
 */
export function shouldAutoOpen(toolKey: string, needsSetup: boolean): boolean {
  if (!needsSetup) return false;
  return !isSetupDismissed(toolKey) && !isSetupCompleted(toolKey);
}
