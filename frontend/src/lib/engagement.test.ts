// Unit tests for the active-engagement store + auto-record gating in
// `lib/engagement.ts`.
//
// `recordResultIfActive` is the function every successful api() call goes
// through — it fires a fire-and-forget POST to the active engagement's
// /results endpoint. The three things worth pinning down:
//
//   1. No active engagement → no fetch at all.
//   2. Lab mode → no fetch even when an engagement is active.
//   3. Engagement mode + active engagement → POST to /engagements/{id}/results
//      with the tool / target / summary payload.
//
// We never use a real network here — `fetch` is stubbed per-test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACTIVE_KEY = "mhp:active-engagement:v1";
const MODE_KEY   = "mhp:mode:v1";

describe("getActiveEngagementId / setActiveEngagementId", () => {
  it("returns null when nothing is set", async () => {
    const { getActiveEngagementId } = await import("./engagement");
    expect(getActiveEngagementId()).toBeNull();
  });

  it("loads a persisted id on module init", async () => {
    localStorage.setItem(ACTIVE_KEY, "eng-123");
    const { getActiveEngagementId } = await import("./engagement");
    expect(getActiveEngagementId()).toBe("eng-123");
  });

  it("setActiveEngagementId persists and clears", async () => {
    const { setActiveEngagementId, getActiveEngagementId } = await import("./engagement");
    setActiveEngagementId("eng-456");
    expect(getActiveEngagementId()).toBe("eng-456");
    expect(localStorage.getItem(ACTIVE_KEY)).toBe("eng-456");
    setActiveEngagementId(null);
    expect(getActiveEngagementId()).toBeNull();
    expect(localStorage.getItem(ACTIVE_KEY)).toBeNull();
  });
});

describe("recordResultIfActive", () => {
  // `api.ts` auto-prefetches /auth/token on import, so the fetch spy will
  // see that call too. Helpers below let each test ignore the bootstrap
  // call and assert on the /results POST specifically.
  let fetchMock: ReturnType<typeof vi.fn>;

  function recordCalls() {
    return fetchMock.mock.calls.filter(
      ([url]) => String(url).includes("/results"),
    );
  }

  beforeEach(() => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/token")) {
        return new Response(JSON.stringify({ token: "test-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is a no-op when no engagement is active", async () => {
    localStorage.setItem(MODE_KEY, "engagement");
    const { recordResultIfActive } = await import("./engagement");
    await recordResultIfActive("/dns/check", "example.com", "ok", {});
    expect(recordCalls()).toHaveLength(0);
  });

  it("is a no-op in Lab mode even with an active engagement", async () => {
    localStorage.setItem(ACTIVE_KEY, "eng-1");
    localStorage.setItem(MODE_KEY,   "lab");
    const { recordResultIfActive } = await import("./engagement");
    await recordResultIfActive("/dns/check", "example.com", "ok", {});
    expect(recordCalls()).toHaveLength(0);
  });

  it("POSTs to /engagements/{id}/results in Engagement mode", async () => {
    localStorage.setItem(ACTIVE_KEY, "eng-1");
    localStorage.setItem(MODE_KEY,   "engagement");
    const { recordResultIfActive } = await import("./engagement");
    await recordResultIfActive("/dns/check", "example.com",
                                "1 record", { ok: true });

    const calls = recordCalls();
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(String(url)).toContain("/engagements/eng-1/results");
    expect(init?.method).toBe("POST");
    const body = JSON.parse((init?.body as string) || "{}");
    expect(body.tool).toBe("/dns/check");
    expect(body.target).toBe("example.com");
    expect(body.summary).toBe("1 record");
  });

  it("skips engagement-itself endpoints to avoid recursion", async () => {
    localStorage.setItem(ACTIVE_KEY, "eng-1");
    localStorage.setItem(MODE_KEY,   "engagement");
    const { recordResultIfActive } = await import("./engagement");
    // The skip list in engagement.ts blocks /engagements/, /health, /chat/,
    // /settings/, /system/ — verify a couple representative paths.
    await recordResultIfActive("/engagements/eng-1/findings", "x", "y", {});
    await recordResultIfActive("/health", "x", "y", {});
    await recordResultIfActive("/chat/stream", "x", "y", {});
    expect(recordCalls()).toHaveLength(0);
  });

  it("truncates over-long target + summary fields before POST", async () => {
    localStorage.setItem(ACTIVE_KEY, "eng-1");
    localStorage.setItem(MODE_KEY,   "engagement");
    const { recordResultIfActive } = await import("./engagement");
    const longTarget  = "x".repeat(2000);
    const longSummary = "y".repeat(10000);
    await recordResultIfActive("/dns/check", longTarget, longSummary, {});
    const calls = recordCalls();
    expect(calls).toHaveLength(1);
    const body = JSON.parse((calls[0][1]?.body as string) || "{}");
    expect(body.target.length).toBeLessThanOrEqual(500);
    expect(body.summary.length).toBeLessThanOrEqual(4000);
  });

  it("swallows fetch errors silently (must never block the scan flow)", async () => {
    localStorage.setItem(ACTIVE_KEY, "eng-1");
    localStorage.setItem(MODE_KEY,   "engagement");
    // Make every fetch (including /results) reject. The function must not
    // throw — auto-recording is best-effort.
    fetchMock.mockImplementation(async () => {
      throw new Error("offline");
    });
    const { recordResultIfActive } = await import("./engagement");
    await recordResultIfActive("/dns/check", "example.com", "ok", {});
  });
});
