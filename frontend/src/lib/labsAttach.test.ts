// Tests for the Labs "attach to engagement" decision helpers: which
// engagement a one-click attach targets, the URL a freshly-created engagement
// is seeded with, and the three confirmation messages. These are the branches
// the Labs.tsx handler delegates to; the fetch/timer plumbing around them is
// the component's job and isn't covered here.

import { describe, expect, it } from "vitest";

import {
  attachConfirmation,
  chooseAttachEngagement,
  deriveLabUrl,
  type AttachLab,
} from "./labsAttach";

const eng = (id: string) => ({ id });

describe("chooseAttachEngagement", () => {
  it("uses the active engagement when one is set", () => {
    expect(chooseAttachEngagement("e1", [eng("e1"), eng("e2")])).toEqual({
      action: "use-active",
      engagementId: "e1",
    });
  });

  it("honors a truthy active id even if it's absent from the list", () => {
    // The active engagement may be archived and thus omitted from the list;
    // we still attach to it rather than silently retargeting.
    expect(chooseAttachEngagement("archived", [eng("e1")])).toEqual({
      action: "use-active",
      engagementId: "archived",
    });
  });

  it("falls back to the first engagement when none is active", () => {
    expect(chooseAttachEngagement(null, [eng("first"), eng("second")])).toEqual({
      action: "use-first",
      engagementId: "first",
    });
  });

  it("creates one when there's no active engagement and the list is empty", () => {
    expect(chooseAttachEngagement(null, [])).toEqual({ action: "create" });
  });
});

describe("deriveLabUrl", () => {
  const lab = (over: Partial<AttachLab>): AttachLab => ({
    name: "DVWA", primary_url: "", port_map: {}, ...over,
  });

  it("prefers the advertised primary URL", () => {
    expect(deriveLabUrl(lab({ primary_url: "http://127.0.0.1:8080" }))).toBe(
      "http://127.0.0.1:8080",
    );
  });

  it("falls back to a loopback URL on the first published port", () => {
    expect(deriveLabUrl(lab({ port_map: { "80/tcp": 8081 } }))).toBe(
      "http://127.0.0.1:8081",
    );
  });

  it("returns empty when the lab publishes nothing", () => {
    expect(deriveLabUrl(lab({}))).toBe("");
  });
});

describe("attachConfirmation", () => {
  it("announces an auto-created engagement", () => {
    expect(attachConfirmation({
      created: true, addedToScope: true, engName: "Lab: DVWA", scopeEntry: "x",
    })).toBe('Created engagement "Lab: DVWA" and attached this lab');
  });

  it("reports the scope entry it added", () => {
    expect(attachConfirmation({
      created: false, addedToScope: true, engName: "Acme",
      scopeEntry: "http://127.0.0.1:8080",
    })).toBe("Attached to Acme — added http://127.0.0.1:8080 to scope");
  });

  it("notes an idempotent re-attach when the URL was already in scope", () => {
    expect(attachConfirmation({
      created: false, addedToScope: false, engName: "Acme", scopeEntry: "x",
    })).toBe("Attached to Acme — already in scope");
  });
});
