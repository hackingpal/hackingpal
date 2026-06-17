// Behavioural spec for the SetupWizard persistence layer. The wizard's
// "only show when it hasn't been done" rule lives entirely in this module,
// so it's the right place to lock the contract in.

import { describe, expect, it } from "vitest";

async function load() {
  return await import("./setupState");
}

describe("setupState", () => {
  it("auto-opens on first visit when setup is needed", async () => {
    const m = await load();
    expect(m.shouldAutoOpen("tcpdump", true)).toBe(true);
  });

  it("never auto-opens when the tool reports it doesn't need setup", async () => {
    const m = await load();
    expect(m.shouldAutoOpen("tcpdump", false)).toBe(false);
    m.markSetupDismissed("tcpdump");
    expect(m.shouldAutoOpen("tcpdump", false)).toBe(false);
  });

  it("suppresses auto-open once the user has dismissed", async () => {
    const m = await load();
    expect(m.shouldAutoOpen("nmap", true)).toBe(true);
    m.markSetupDismissed("nmap");
    expect(m.isSetupDismissed("nmap")).toBe(true);
    expect(m.shouldAutoOpen("nmap", true)).toBe(false);
  });

  it("suppresses auto-open once the user has completed", async () => {
    const m = await load();
    m.markSetupCompleted("anthropic");
    expect(m.isSetupCompleted("anthropic")).toBe(true);
    expect(m.shouldAutoOpen("anthropic", true)).toBe(false);
  });

  it("clears the dismissed flag implicitly when completion is recorded", async () => {
    const m = await load();
    m.markSetupDismissed("cloud-aws");
    expect(m.isSetupDismissed("cloud-aws")).toBe(true);
    m.markSetupCompleted("cloud-aws");
    expect(m.isSetupDismissed("cloud-aws")).toBe(false);
    expect(m.isSetupCompleted("cloud-aws")).toBe(true);
  });

  it("isolates flags per-tool", async () => {
    const m = await load();
    m.markSetupDismissed("tcpdump");
    m.markSetupCompleted("nmap");
    expect(m.isSetupDismissed("tcpdump")).toBe(true);
    expect(m.isSetupCompleted("tcpdump")).toBe(false);
    expect(m.isSetupCompleted("nmap")).toBe(true);
    expect(m.isSetupDismissed("nmap")).toBe(false);
  });

  it("resetSetup clears both flags so the wizard re-opens", async () => {
    const m = await load();
    m.markSetupCompleted("cloud-gcp");
    m.markSetupDismissed("cloud-gcp");
    m.resetSetup("cloud-gcp");
    expect(m.isSetupCompleted("cloud-gcp")).toBe(false);
    expect(m.isSetupDismissed("cloud-gcp")).toBe(false);
    expect(m.shouldAutoOpen("cloud-gcp", true)).toBe(true);
  });

  it("persists via the mhp:setup: namespace so it survives reloads", async () => {
    const m = await load();
    m.markSetupCompleted("tcpdump");
    expect(window.localStorage.getItem("mhp:setup:tcpdump:completed")).toBe("1");
    m.markSetupDismissed("tcpdump");
    expect(window.localStorage.getItem("mhp:setup:tcpdump:dismissed")).toBe("1");
  });

  it("broadcasts a mhp:setup-changed event so live UI can react", async () => {
    const m = await load();
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("mhp:setup-changed", listener);
    try {
      m.markSetupCompleted("nmap");
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.some((e) => e.detail?.toolKey === "nmap" && e.detail?.flag === "completed" && e.detail?.value === true)).toBe(true);
    } finally {
      window.removeEventListener("mhp:setup-changed", listener);
    }
  });
});
