// Pure logic behind the top-of-app container-runtime banner (RuntimeBanner.tsx):
// the session-dismiss flag and the visibility/label decision. Extracted so the
// "when does the banner show, and what does it say" rules are unit-testable
// without rendering the component or faking timers. The component keeps the
// polling effect and JSX; this module owns the decisions it feeds them.

import type { RuntimeStatus } from "../api";

export const DISMISS_KEY = "runtimeBanner:dismissed";

// Platform the app is running on, as reported by `nt.platform`. Windows has no
// colima path packaged yet, so the banner stays silent there.
export type RuntimePlatform = "darwin" | "linux" | "win32" | null;

export function isDismissed(): boolean {
  try { return sessionStorage.getItem(DISMISS_KEY) === "1"; }
  catch { return false; }
}

export function setDismissed(): void {
  try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
}

export function clearDismissed(): void {
  try { sessionStorage.removeItem(DISMISS_KEY); } catch { /* ignore */ }
}

// True on every platform we surface the banner on. Windows is excluded until a
// Docker Desktop path lands; Linux is included (the WS installer fails clearly
// where brew is absent).
export function runtimeBannerSupported(platform: RuntimePlatform): boolean {
  return platform !== "win32";
}

export type RuntimeBannerView = {
  headline: string;
  button: string;
};

/**
 * Decide whether the banner renders and, if so, its headline + button label.
 * Returns null whenever the banner should be hidden:
 *
 *   * unsupported platform (Windows),
 *   * status not yet loaded (first poll in flight),
 *   * dismissed this session,
 *   * runtime healthy (needs neither install nor start).
 *
 * Install takes precedence over start — a missing binary can't be started.
 */
export function runtimeBannerView(
  platform: RuntimePlatform,
  status: RuntimeStatus | null,
  dismissed: boolean,
): RuntimeBannerView | null {
  if (!runtimeBannerSupported(platform)) return null;
  if (!status) return null;
  if (dismissed) return null;
  if (!status.needs_install && !status.needs_start) return null;

  return status.needs_install
    ? { headline: "Labs need a container runtime.", button: "Install & start colima" }
    : { headline: "Container runtime is stopped.", button: "Start colima" };
}
