// Unit tests for the Lab/Engagement mode store.

import { describe, expect, it, vi } from "vitest";

describe("lib/mode", () => {
  it("defaults to lab when localStorage is empty", async () => {
    const { getMode } = await import("./mode");
    expect(getMode()).toBe("lab");
  });

  it("reads a persisted engagement value", async () => {
    localStorage.setItem("mhp:mode:v1", "engagement");
    const { getMode } = await import("./mode");
    expect(getMode()).toBe("engagement");
  });

  it("normalises unknown values to lab (safer default)", async () => {
    localStorage.setItem("mhp:mode:v1", "garbage");
    const { getMode } = await import("./mode");
    expect(getMode()).toBe("lab");
  });

  it("setMode persists to localStorage and notifies subscribers", async () => {
    const { setMode, getMode } = await import("./mode");
    setMode("engagement");
    expect(getMode()).toBe("engagement");
    expect(localStorage.getItem("mhp:mode:v1")).toBe("engagement");
    setMode("lab");
    expect(localStorage.getItem("mhp:mode:v1")).toBe("lab");
  });

  it("survives a localStorage quota failure on write", async () => {
    const { setMode, getMode } = await import("./mode");
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error("quota exceeded");
    });
    try {
      setMode("engagement");      // must not throw
      expect(getMode()).toBe("engagement");
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});
