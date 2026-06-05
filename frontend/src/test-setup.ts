// Global setup for the Vitest suite.
//
// Production code reads bare `localStorage` (browser semantics). jsdom +
// Node 24+ don't reliably expose it as a true global without an
// experimental flag, so we install a tiny in-memory `Storage` shim
// before any test module loads. Cleared between tests so previous
// writes can't leak.

import { afterEach, beforeEach, vi } from "vitest";

class MemoryStorage implements Storage {
  private store: Map<string, string> = new Map();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void { this.store.delete(key); }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const storage = new MemoryStorage();
(globalThis as { localStorage?: Storage }).localStorage = storage;
if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
  });
}

beforeEach(() => {
  storage.clear();
  // `lib/mode.ts` and `lib/engagement.ts` read localStorage at module-init
  // time, so a single import is cached for the rest of the file unless we
  // wipe the module graph between tests. With reset, each `await import(...)`
  // re-runs the top-level read against the freshly-seeded storage.
  vi.resetModules();
});

afterEach(() => { storage.clear(); });
