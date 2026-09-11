import { describe, it, expect } from "vitest";
import { computeHistoricalBaseline } from "../src/intelligence/baseline.js";
import { fixtureRecord, fixtureSeries } from "./fixtures/intelligenceFixtures.js";

describe("computeHistoricalBaseline — empty and degenerate cases", () => {
  it("returns an honest all-null/zero baseline for zero records, never a fabricated statistic", () => {
    const baseline = computeHistoricalBaseline([]);
    expect(baseline.observationCount).toBe(0);
    expect(baseline.baselineStartAt).toBeNull();
    expect(baseline.baselineEndAt).toBeNull();
    expect(baseline.medianPct).toBeNull();
    expect(baseline.typicalAbsDeviationFromParityPct).toBeNull();
    expect(baseline.dispersionMad).toBeNull();
    expect(baseline.elapsedHours).toBe(0);
    expect(baseline.excludedByFreshnessCount).toBe(0);
  });

  it("computes real statistics once at least one eligible observation exists", () => {
    const records = fixtureSeries("2026-09-01T00:00:00.000Z", 15, [0.1, 0.15, 0.12, 0.11, 0.13]);
    const baseline = computeHistoricalBaseline(records);
    expect(baseline.observationCount).toBe(5);
    expect(baseline.medianPct).toBeCloseTo(0.12, 5);
    expect(baseline.baselineStartAt?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(baseline.baselineEndAt?.toISOString()).toBe("2026-09-01T01:00:00.000Z");
    expect(baseline.elapsedHours).toBeCloseTo(1, 5);
  });
});

describe("computeHistoricalBaseline — robust to an outlier", () => {
  it("the median and MAD are not dragged far by a single extreme historical dislocation", () => {
    const normalPcts = [0.1, 0.12, 0.09, 0.11, 0.1, 0.12, 0.09, 0.11, 0.1];
    const withOutlier = [...normalPcts, 15.0]; // one wild past event
    const records = fixtureSeries("2026-09-01T00:00:00.000Z", 15, withOutlier);
    const baseline = computeHistoricalBaseline(records);
    expect(baseline.medianPct).toBeLessThan(0.2);
    expect(baseline.dispersionMad).toBeLessThan(0.1);
  });
});

describe("computeHistoricalBaseline — excludedByFreshnessCount is diagnostic-only and precise", () => {
  it("is 0 when there are zero exclusions of any kind", () => {
    const records = fixtureSeries("2026-09-01T00:00:00.000Z", 15, [0.1, 0.1, 0.1]);
    expect(computeHistoricalBaseline(records).excludedByFreshnessCount).toBe(0);
  });

  it("increments only for records that pass P2 healthy_current but fail P3's freshness rule", () => {
    const fresh = fixtureRecord({ capturedAt: "2026-09-01T00:00:00.000Z", premiumDiscountPct: 0.1 });
    const staleByP3Only = fixtureRecord({
      capturedAt: "2026-09-01T01:00:00.000Z",
      premiumDiscountPct: 0.1,
      referenceUpdatedAt: "2026-08-01T00:00:00.000Z", // wildly older than 360 minutes, but P2 still says "ok"
    });
    const baseline = computeHistoricalBaseline([fresh, staleByP3Only]);
    expect(baseline.observationCount).toBe(1); // only the fresh one counted as an eligible observation
    expect(baseline.excludedByFreshnessCount).toBe(1);
  });

  it("does NOT increment for records P2 already considers unhealthy for a different reason (stale/paused/halted)", () => {
    const fresh = fixtureRecord({ capturedAt: "2026-09-01T00:00:00.000Z", premiumDiscountPct: 0.1 });
    const p2Stale = fixtureRecord({ capturedAt: "2026-09-01T01:00:00.000Z", chainlinkStale: true });
    const p2Paused = fixtureRecord({ capturedAt: "2026-09-01T02:00:00.000Z", oraclePaused: true });
    const p2Halted = fixtureRecord({ capturedAt: "2026-09-01T03:00:00.000Z", tradingHalt: true });
    const baseline = computeHistoricalBaseline([fresh, p2Stale, p2Paused, p2Halted]);
    expect(baseline.observationCount).toBe(1);
    // None of these three were excluded BY FRESHNESS specifically — they
    // were never eligible in the first place for other, P2-side reasons.
    expect(baseline.excludedByFreshnessCount).toBe(0);
  });

  it("correctly counts a mix of P2-invalid and P3-freshness-only exclusions without conflating them", () => {
    const fresh1 = fixtureRecord({ capturedAt: "2026-09-01T00:00:00.000Z", premiumDiscountPct: 0.1 });
    const fresh2 = fixtureRecord({ capturedAt: "2026-09-01T00:15:00.000Z", premiumDiscountPct: 0.11 });
    const p3Only1 = fixtureRecord({ capturedAt: "2026-09-01T00:30:00.000Z", premiumDiscountPct: 0.1, referenceUpdatedAt: "2026-08-01T00:00:00.000Z" });
    const p3Only2 = fixtureRecord({ capturedAt: "2026-09-01T00:45:00.000Z", premiumDiscountPct: 0.1, referenceUpdatedAt: "2026-08-01T00:00:00.000Z" });
    const p2Invalid = fixtureRecord({ capturedAt: "2026-09-01T01:00:00.000Z", chainlinkStale: true });
    const baseline = computeHistoricalBaseline([fresh1, fresh2, p3Only1, p3Only2, p2Invalid]);
    expect(baseline.observationCount).toBe(2);
    expect(baseline.excludedByFreshnessCount).toBe(2);
  });
});

describe("computeHistoricalBaseline — does not require pre-sorted input", () => {
  it("sorts internally by capturedAt regardless of input order", () => {
    const records = [
      fixtureRecord({ capturedAt: "2026-09-01T02:00:00.000Z", premiumDiscountPct: 0.3 }),
      fixtureRecord({ capturedAt: "2026-09-01T00:00:00.000Z", premiumDiscountPct: 0.1 }),
      fixtureRecord({ capturedAt: "2026-09-01T01:00:00.000Z", premiumDiscountPct: 0.2 }),
    ];
    const baseline = computeHistoricalBaseline(records);
    expect(baseline.baselineStartAt?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(baseline.baselineEndAt?.toISOString()).toBe("2026-09-01T02:00:00.000Z");
  });
});
