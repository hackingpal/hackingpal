// Tests for the chat suggestion-card logic. The backend decides which checks
// to propose; these pin what Approve carries out (nav + pre-fill payloads),
// the Modify override, and the Approve gate.

import { describe, expect, it } from "vitest";

import { approvePlan, canApprove, withTarget } from "./suggestion";
import type { SuggestedCheck } from "../api";

const check = (over: Partial<SuggestedCheck> = {}): SuggestedCheck => ({
  tool: "tls_audit", nav_id: "tls", label: "TLS audit",
  target: "example.com", rationale: "https is up", ...over,
});

describe("approvePlan", () => {
  it("navigates to nav_id and pre-fills the target two ways", () => {
    const plan = approvePlan(check());
    expect(plan.navId).toBe("tls");
    expect(plan.intent).toEqual({ target: "example.com" });
    expect(plan.target).toEqual({
      id: "suggest:example.com", address: "example.com",
      name: "example.com", kind: "manual",
    });
  });

  it("trims the target", () => {
    expect(approvePlan(check({ target: "  acme.test  " })).intent).toEqual({
      target: "acme.test",
    });
  });
});

describe("withTarget", () => {
  it("overrides the target", () => {
    expect(withTarget(check(), "new.host").target).toBe("new.host");
  });

  it("trims, and ignores a blank override", () => {
    expect(withTarget(check(), "  spaced  ").target).toBe("spaced");
    expect(withTarget(check({ target: "keep.me" }), "   ").target).toBe("keep.me");
  });
});

describe("canApprove", () => {
  it("is true only when pending with a non-empty target", () => {
    expect(canApprove(check(), "pending")).toBe(true);
    expect(canApprove(check(), "approved")).toBe(false);
    expect(canApprove(check(), "skipped")).toBe(false);
    expect(canApprove(check({ target: "   " }), "pending")).toBe(false);
  });
});
