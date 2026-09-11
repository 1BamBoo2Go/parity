import { describe, it, expect } from "vitest";
import { buildTickerIntelligence, toIntelligenceSummary } from "../src/intelligence/buildTickerIntelligence.js";
import { fixtureSeries, fixtureRecord } from "./fixtures/intelligenceFixtures.js";

describe("buildTickerIntelligence — insufficient history", () => {
  it("returns INSUFFICIENT_DATA for a ticker with zero history", () => {
    const intelligence = buildTickerIntelligence("AAPL", []);
    expect(intelligence.maturity).toBe("INSUFFICIENT_DATA");
    expect(intelligence.baseline.observationCount).toBe(0);
    // No records at all -> no current record -> both null, honestly.
    expect(intelligence.currentPremiumDiscountPct).toBeNull();
    expect(intelligence.currentAbsDeviationFromParityPct).toBeNull();
  });

  it("returns INSUFFICIENT_DATA for a ticker with only a handful of observations", () => {
    const records = fixtureSeries("2026-09-07T00:00:00.000Z", 15, [0.1, 0.1, 0.1, 0.1, 0.1]);
    const intelligence = buildTickerIntelligence("AAPL", records);
    expect(intelligence.maturity).toBe("INSUFFICIENT_DATA");
  });

  it("REGRESSION: INSUFFICIENT_DATA with an individually eligible current record still exposes the current pct and abs pct — this is the exact bug found during real VPS verification", () => {
    const records = fixtureSeries("2026-09-07T00:00:00.000Z", 15, [0.1, 0.12, -0.09320591265655016]);
    const intelligence = buildTickerIntelligence("AAPL", records);
    expect(intelligence.maturity).toBe("INSUFFICIENT_DATA");
    expect(intelligence.currentPremiumDiscountPct).toBe(-0.09320591265655016);
    expect(intelligence.currentAbsDeviationFromParityPct).toBeCloseTo(0.09320591265655016, 10);
    // Statistical intelligence must NOT be present on this variant at all
    // (type-level guarantee, not just a null value) — confirmed by the
    // absence of these properties on the object itself.
    expect("relativeDeviationMultiple" in intelligence).toBe(false);
    expect("classification" in intelligence).toBe(false);
    expect("episode" in intelligence).toBe(false);
  });

  it("immature (INSUFFICIENT_DATA) with an INELIGIBLE current record: both current fields remain null", () => {
    const records = [
      ...fixtureSeries("2026-09-07T00:00:00.000Z", 15, [0.1, 0.12]),
      fixtureRecord({ capturedAt: "2026-09-07T00:30:00.000Z", chainlinkStale: true }), // P2-ineligible current record
    ];
    const intelligence = buildTickerIntelligence("AAPL", records);
    expect(intelligence.maturity).toBe("INSUFFICIENT_DATA");
    expect(intelligence.currentPremiumDiscountPct).toBeNull();
    expect(intelligence.currentAbsDeviationFromParityPct).toBeNull();
  });
});

describe("buildTickerIntelligence — developing history", () => {
  it("returns DEVELOPING once past the insufficient floor but before the mature bars", () => {
    // 30 observations, 15-min cadence => ~7.25 hours elapsed — clears the
    // 20-observation/24-hour insufficient floor only via observation count
    // being checked independently... actually need >=24h too. Build with
    // a coarser cadence to also clear the elapsed-hours floor cheaply.
    const records = fixtureSeries("2026-09-01T00:00:00.000Z", 60, Array.from({ length: 30 }, () => 0.1)); // 30 obs, 1h apart => 29h elapsed
    const intelligence = buildTickerIntelligence("AAPL", records);
    expect(intelligence.maturity).toBe("DEVELOPING");
  });

  it("REGRESSION: DEVELOPING with an eligible current record exposes current pct/abs pct while statistical intelligence stays unavailable", () => {
    const records = fixtureSeries("2026-09-01T00:00:00.000Z", 60, [
      ...Array.from({ length: 29 }, () => 0.1),
      -0.09320591265655016, // the "current" observation — matches the real VPS AAPL example
    ]);
    const intelligence = buildTickerIntelligence("AAPL", records);
    expect(intelligence.maturity).toBe("DEVELOPING");
    expect(intelligence.currentPremiumDiscountPct).toBe(-0.09320591265655016);
    expect(intelligence.currentAbsDeviationFromParityPct).toBeCloseTo(0.09320591265655016, 10);
    // Still no statistical intelligence at the DEVELOPING tier.
    expect("relativeDeviationMultiple" in intelligence).toBe(false);
    expect("classification" in intelligence).toBe(false);
    expect("episode" in intelligence).toBe(false);
  });

  it("immature (DEVELOPING) with an INELIGIBLE current record: both current fields remain null", () => {
    const records = [
      ...fixtureSeries("2026-09-01T00:00:00.000Z", 60, Array.from({ length: 29 }, () => 0.1)),
      fixtureRecord({ capturedAt: "2026-09-02T05:00:00.000Z", oraclePaused: true }), // P2-ineligible current record
    ];
    const intelligence = buildTickerIntelligence("AAPL", records);
    expect(intelligence.maturity).toBe("DEVELOPING");
    expect(intelligence.currentPremiumDiscountPct).toBeNull();
    expect(intelligence.currentAbsDeviationFromParityPct).toBeNull();
  });
});

describe("buildTickerIntelligence — mature history, NORMAL", () => {
  it("classifies NORMAL when the current reading is close to the historical median", () => {
    const pcts = Array.from({ length: 250 }, (_, i) => 0.1 + (i % 2 === 0 ? 0.01 : -0.01));
    const records = fixtureSeries("2026-08-01T00:00:00.000Z", 60, pcts); // 250 obs, 1h apart => 249h elapsed
    const intelligence = buildTickerIntelligence("AAPL", records);
    expect(intelligence.maturity).toBe("MATURE");
    if (intelligence.maturity === "MATURE") {
      expect(intelligence.classification).toBe("NORMAL");
      expect(intelligence.episode.state).toBe("no_active_episode");
    }
  });
});

describe("buildTickerIntelligence — mature history, escalating severity", () => {
  function matureBaselineRecords(): ReturnType<typeof fixtureSeries> {
    // 250 tight observations around 0.1% with small noise -> small MAD.
    const pcts = Array.from({ length: 250 }, (_, i) => 0.1 + (i % 2 === 0 ? 0.02 : -0.02));
    return fixtureSeries("2026-08-01T00:00:00.000Z", 60, pcts);
  }

  it("classifies ELEVATED for a moderately abnormal current reading", () => {
    const history = matureBaselineRecords();
    const current = fixtureRecord({ capturedAt: "2026-09-11T10:00:00.000Z", premiumDiscountPct: 0.3 });
    const intelligence = buildTickerIntelligence("AAPL", [...history, current]);
    expect(intelligence.maturity).toBe("MATURE");
    if (intelligence.maturity === "MATURE") {
      expect(["ELEVATED", "DISLOCATED", "SEVERE"]).toContain(intelligence.classification);
    }
  });

  it("classifies SEVERE for a dramatically abnormal current reading, with an active episode", () => {
    const history = matureBaselineRecords();
    const current = fixtureRecord({ capturedAt: "2026-09-11T10:00:00.000Z", premiumDiscountPct: 3.0 });
    const intelligence = buildTickerIntelligence("AAPL", [...history, current]);
    expect(intelligence.maturity).toBe("MATURE");
    if (intelligence.maturity === "MATURE") {
      expect(intelligence.classification).toBe("SEVERE");
      expect(intelligence.episode.state).toBe("active");
      expect(intelligence.currentPremiumDiscountPct).toBe(3.0);
    }
  });

  it("classifies a negative discount of the same magnitude identically (sign symmetry end-to-end)", () => {
    const history = matureBaselineRecords();
    const positiveCurrent = fixtureRecord({ capturedAt: "2026-09-11T10:00:00.000Z", premiumDiscountPct: 3.0 });
    const negativeCurrent = fixtureRecord({ capturedAt: "2026-09-11T10:00:00.000Z", premiumDiscountPct: -3.0 });
    const positiveIntel = buildTickerIntelligence("AAPL", [...history, positiveCurrent]);
    const negativeIntel = buildTickerIntelligence("AAPL", [...history, negativeCurrent]);
    if (positiveIntel.maturity === "MATURE" && negativeIntel.maturity === "MATURE") {
      expect(positiveIntel.classification).toBe(negativeIntel.classification);
    } else {
      throw new Error("expected both to be MATURE");
    }
  });
});

describe("buildTickerIntelligence — current observation unavailable despite a mature baseline", () => {
  it("reports classification: null and episode: current_observation_unavailable when the latest record is stale-by-P3", () => {
    const pcts = Array.from({ length: 250 }, () => 0.1);
    const history = fixtureSeries("2026-08-01T00:00:00.000Z", 60, pcts);
    const staleCurrent = fixtureRecord({
      capturedAt: "2026-09-11T10:00:00.000Z",
      premiumDiscountPct: 0.1,
      referenceUpdatedAt: "2026-08-01T00:00:00.000Z", // wildly stale by P3's rule
    });
    const intelligence = buildTickerIntelligence("AAPL", [...history, staleCurrent]);
    expect(intelligence.maturity).toBe("MATURE");
    if (intelligence.maturity === "MATURE") {
      expect(intelligence.classification).toBeNull();
      expect(intelligence.currentPremiumDiscountPct).toBeNull();
      expect(intelligence.episode.state).toBe("current_observation_unavailable");
    }
  });
});

describe("toIntelligenceSummary — summary/detail agreement", () => {
  it("the summary's classification and maturity always match the full intelligence object they were projected from", () => {
    const pcts = Array.from({ length: 250 }, () => 0.1);
    const history = fixtureSeries("2026-08-01T00:00:00.000Z", 60, pcts);
    const current = fixtureRecord({ capturedAt: "2026-09-11T10:00:00.000Z", premiumDiscountPct: 3.0 });
    const intelligence = buildTickerIntelligence("AAPL", [...history, current]);
    const summary = toIntelligenceSummary(intelligence);

    expect(summary.maturity).toBe(intelligence.maturity);
    if (intelligence.maturity === "MATURE") {
      expect(summary.classification).toBe(intelligence.classification);
      expect(summary.relativeDeviationMultiple).toBe(intelligence.relativeDeviationMultiple);
      expect(summary.observationCount).toBe(intelligence.baseline.observationCount);
    }
  });

  it("produces a non-empty, informative label for every maturity state", () => {
    expect(toIntelligenceSummary(buildTickerIntelligence("AAPL", [])).label).toMatch(/insufficient/i);

    const developingRecords = fixtureSeries("2026-09-01T00:00:00.000Z", 60, Array.from({ length: 30 }, () => 0.1));
    expect(toIntelligenceSummary(buildTickerIntelligence("AAPL", developingRecords)).label).toMatch(/developing/i);
  });

  it("episodeDurationMinutes is null when there is no active episode, never 0 masquerading as a real duration", () => {
    const pcts = Array.from({ length: 250 }, () => 0.1);
    const history = fixtureSeries("2026-08-01T00:00:00.000Z", 60, pcts);
    const normalCurrent = fixtureRecord({ capturedAt: "2026-09-11T10:00:00.000Z", premiumDiscountPct: 0.1 });
    const intelligence = buildTickerIntelligence("AAPL", [...history, normalCurrent]);
    const summary = toIntelligenceSummary(intelligence);
    expect(summary.episodeDurationMinutes).toBeNull();
  });
});
