import { describe, it, expect } from "vitest";
import { classifyMaturity } from "../src/intelligence/maturity.js";
import type { HistoricalBaseline } from "../src/intelligence/types.js";

function baseline(overrides: Partial<HistoricalBaseline>): HistoricalBaseline {
  return {
    observationCount: 0,
    baselineStartAt: null,
    baselineEndAt: null,
    medianPct: null,
    typicalAbsDeviationFromParityPct: null,
    dispersionMad: null,
    elapsedHours: 0,
    excludedByFreshnessCount: 0,
    ...overrides,
  };
}

describe("classifyMaturity — INSUFFICIENT_DATA", () => {
  it("is INSUFFICIENT_DATA with zero observations", () => {
    expect(classifyMaturity(baseline({ observationCount: 0, elapsedHours: 0 }))).toBe("INSUFFICIENT_DATA");
  });

  it("is INSUFFICIENT_DATA when observation count is below the floor, even with plenty of elapsed time", () => {
    expect(classifyMaturity(baseline({ observationCount: 19, elapsedHours: 500 }))).toBe("INSUFFICIENT_DATA");
  });

  it("is INSUFFICIENT_DATA when elapsed hours is below the floor, even with plenty of observations", () => {
    expect(classifyMaturity(baseline({ observationCount: 500, elapsedHours: 23 }))).toBe("INSUFFICIENT_DATA");
  });
});

describe("classifyMaturity — DEVELOPING", () => {
  it("is DEVELOPING once both floors are cleared but the MATURE bars are not", () => {
    expect(classifyMaturity(baseline({ observationCount: 20, elapsedHours: 24 }))).toBe("DEVELOPING");
    expect(classifyMaturity(baseline({ observationCount: 199, elapsedHours: 95 }))).toBe("DEVELOPING");
  });

  it("is DEVELOPING when observation count is mature but elapsed hours is not", () => {
    expect(classifyMaturity(baseline({ observationCount: 300, elapsedHours: 50 }))).toBe("DEVELOPING");
  });

  it("is DEVELOPING when elapsed hours is mature but observation count is not", () => {
    expect(classifyMaturity(baseline({ observationCount: 50, elapsedHours: 200 }))).toBe("DEVELOPING");
  });
});

describe("classifyMaturity — MATURE", () => {
  it("is MATURE exactly at both boundary values", () => {
    expect(classifyMaturity(baseline({ observationCount: 200, elapsedHours: 96 }))).toBe("MATURE");
  });

  it("is MATURE comfortably above both thresholds", () => {
    expect(classifyMaturity(baseline({ observationCount: 500, elapsedHours: 300 }))).toBe("MATURE");
  });
});
