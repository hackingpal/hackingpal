// Tests for the container-runtime banner's pure logic: the session-dismiss
// flag and the visibility/label decision. The component's polling effect and
// JSX aren't exercised here — only the rules that decide whether it shows and
// what it says, which is where the consequential behavior lives.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DISMISS_KEY,
  clearDismissed,
  isDismissed,
  runtimeBannerSupported,
  runtimeBannerView,
  setDismissed,
} from "./runtimeBanner";
import type { RuntimeStatus } from "../api";

// jsdom + Node don't reliably expose sessionStorage as a global, mirroring the
// localStorage shim in test-setup. Install an in-memory one for the dismiss
// helpers and clear it around each test.
class MemoryStorage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  removeItem(k: string) { this.store.delete(k); }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
}
const session = new MemoryStorage();
(globalThis as { sessionStorage?: Storage }).sessionStorage = session as unknown as Storage;

beforeEach(() => session.clear());
afterEach(() => session.clear());

// Build a RuntimeStatus with the two booleans the banner switches on. The
// other fields don't affect the decision.
function status(over: Partial<RuntimeStatus>): RuntimeStatus {
  return {
    state: "ok",
    needs_install: false,
    needs_start: false,
    colima_path: null,
    docker_path: null,
    ...over,
  };
}

describe("session-dismiss flag", () => {
  it("round-trips set → is → clear", () => {
    expect(isDismissed()).toBe(false);
    setDismissed();
    expect(sessionStorage.getItem(DISMISS_KEY)).toBe("1");
    expect(isDismissed()).toBe(true);
    clearDismissed();
    expect(isDismissed()).toBe(false);
  });
});

describe("runtimeBannerSupported", () => {
  it("is true on darwin and linux, false on win32", () => {
    expect(runtimeBannerSupported("darwin")).toBe(true);
    expect(runtimeBannerSupported("linux")).toBe(true);
    expect(runtimeBannerSupported(null)).toBe(true);
    expect(runtimeBannerSupported("win32")).toBe(false);
  });
});

describe("runtimeBannerView", () => {
  it("hides on Windows even when the runtime needs work", () => {
    expect(runtimeBannerView("win32", status({ needs_install: true }), false)).toBeNull();
  });

  it("hides while status is still loading", () => {
    expect(runtimeBannerView("darwin", null, false)).toBeNull();
  });

  it("hides when dismissed this session", () => {
    expect(runtimeBannerView("darwin", status({ needs_install: true }), true)).toBeNull();
  });

  it("hides when the runtime is healthy", () => {
    expect(runtimeBannerView("darwin", status({}), false)).toBeNull();
  });

  it("shows the install copy when the binary is missing", () => {
    const v = runtimeBannerView("darwin", status({ needs_install: true }), false);
    expect(v).toEqual({
      headline: "Labs need a container runtime.",
      button: "Install & start colima",
    });
  });

  it("shows the start copy when the daemon is stopped", () => {
    const v = runtimeBannerView("darwin", status({ needs_start: true }), false);
    expect(v).toEqual({
      headline: "Container runtime is stopped.",
      button: "Start colima",
    });
  });

  it("prefers install over start when somehow both are set", () => {
    const v = runtimeBannerView(
      "darwin", status({ needs_install: true, needs_start: true }), false,
    );
    expect(v?.button).toBe("Install & start colima");
  });
});
