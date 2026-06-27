// Tests for the coverage-matrix presentation helpers. The backend decides
// coverage; these only shape it for the grid, so the cases pin the roll-up
// math and the per-area status-line branches (recon vs findings vs report,
// covered vs not).

import { describe, expect, it } from "vitest";

import {
  areaStatusLine,
  areaTone,
  coverageHeadline,
  coveragePercent,
} from "./coverageView";
import type { CoverageArea } from "./engagement";

function area(over: Partial<CoverageArea>): CoverageArea {
  return {
    key: "dns", label: "DNS", description: "",
    covered: false, runs: 0, last_ts: null, last_tool: null,
    last_target: null, tools_seen: [], ...over,
  };
}

describe("coveragePercent", () => {
  it("rounds covered/total to a percentage", () => {
    expect(coveragePercent({ covered_count: 3, total: 6 })).toBe(50);
    expect(coveragePercent({ covered_count: 0, total: 6 })).toBe(0);
    expect(coveragePercent({ covered_count: 6, total: 6 })).toBe(100);
  });

  it("is 0 (not NaN) when total is 0", () => {
    expect(coveragePercent({ covered_count: 0, total: 0 })).toBe(0);
  });
});

describe("coverageHeadline", () => {
  it("reads as a fraction of areas", () => {
    expect(coverageHeadline({ covered_count: 2, total: 6 })).toBe("2 / 6 areas covered");
  });
});

describe("areaStatusLine", () => {
  it("says not-yet for uncovered areas", () => {
    expect(areaStatusLine(area({ covered: false }))).toBe("Not yet checked");
  });

  it("shows run count and last tool for recon areas", () => {
    expect(areaStatusLine(area({
      key: "dns", covered: true, runs: 3, last_tool: "dns_recon",
    }))).toBe("3 runs · dns_recon");
  });

  it("singularizes a single run", () => {
    expect(areaStatusLine(area({ key: "tls", covered: true, runs: 1, last_tool: "tls_audit" })))
      .toBe("1 run · tls_audit");
  });

  it("counts findings rather than runs", () => {
    expect(areaStatusLine(area({ key: "findings", covered: true, runs: 1 }))).toBe("1 finding");
    expect(areaStatusLine(area({ key: "findings", covered: true, runs: 4 }))).toBe("4 findings");
  });

  it("reads report as a plain done state", () => {
    expect(areaStatusLine(area({ key: "report", covered: true, runs: 2 }))).toBe("Report exported");
  });
});

describe("areaTone", () => {
  it("is success-toned when covered, muted otherwise", () => {
    expect(areaTone(area({ covered: true })).dot).toBe("bg-success");
    expect(areaTone(area({ covered: false })).dot).toBe("bg-ink-dim");
  });
});
