import { describe, it, expect } from "vitest";
import { referenceAgeAtCaptureMinutes, evaluateIntelligenceEligibility, isEligibleForIntelligence } from "../src/intelligence/eligibility.js";
import { classifyOverallStatus } from "../src/readmodel/fieldStatus.js";
import { INTELLIGENCE_MAX_REFERENCE_AGE_MINUTES } from "../src/intelligence/thresholds.js";
import { fixtureRecord } from "./fixtures/intelligenceFixtures.js";

describe("referenceAgeAtCaptureMinutes", () => {
  it("computes the age of the reference relative to capturedAt, not to wall-clock now", () => {
    const record = fixtureRecord({
      capturedAt: "2026-09-07T12:00:00.000Z",
      referenceUpdatedAt: "2026-09-07T10:00:00.000Z", // 2 hours old at capture
    });
    expect(referenceAgeAtCaptureMinutes(record)).toBeCloseTo(120, 5);
  });

  it("returns null when the chainlink reference itself is unavailable", () => {
    const record = fixtureRecord({ capturedAt: "2026-09-07T12:00:00.000Z", chainlinkStale: true });
    expect(referenceAgeAtCaptureMinutes(record)).toBeNull();
  });

  it("is 0 when the reference was updated in the same instant it was captured", () => {
    const record = fixtureRecord({ capturedAt: "2026-09-07T12:00:00.000Z", referenceUpdatedAt: "2026-09-07T12:00:00.000Z" });
    expect(referenceAgeAtCaptureMinutes(record)).toBe(0);
  });
});

describe("evaluateIntelligenceEligibility — P2 necessary, P3 additionally sufficient", () => {
  it("is eligible when P2 is healthy_current AND the reference is well within the P3 freshness window", () => {
    const record = fixtureRecord({ capturedAt: "2026-09-07T12:00:00.000Z", referenceUpdatedAt: "2026-09-07T11:00:00.000Z" }); // 1h old
    const result = evaluateIntelligenceEligibility(record);
    expect(result.eligible).toBe(true);
    expect(isEligibleForIntelligence(record)).toBe(true);
  });

  it("is exactly at the boundary: reference age === 360 minutes is still eligible (<=, not <)", () => {
    const capturedAt = new Date("2026-09-07T12:00:00.000Z");
    const referenceUpdatedAt = new Date(capturedAt.getTime() - INTELLIGENCE_MAX_REFERENCE_AGE_MINUTES * 60000).toISOString();
    const record = fixtureRecord({ capturedAt: capturedAt.toISOString(), referenceUpdatedAt });
    expect(evaluateIntelligenceEligibility(record).eligible).toBe(true);
  });

  it("is NOT eligible, with reason p3_reference_too_old, when P2 is healthy_current but the reference exceeds 360 minutes old", () => {
    const capturedAt = new Date("2026-09-07T12:00:00.000Z");
    const referenceUpdatedAt = new Date(capturedAt.getTime() - (INTELLIGENCE_MAX_REFERENCE_AGE_MINUTES + 1) * 60000).toISOString();
    const record = fixtureRecord({ capturedAt: capturedAt.toISOString(), referenceUpdatedAt });
    const result = evaluateIntelligenceEligibility(record);
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toBe("p3_reference_too_old");
    }
  });

  it("is NOT eligible, with reason p2_unhealthy, when P2 already considers the record unhealthy (stale) — never conflated with the P3 reason", () => {
    const record = fixtureRecord({ capturedAt: "2026-09-07T12:00:00.000Z", chainlinkStale: true });
    const result = evaluateIntelligenceEligibility(record);
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toBe("p2_unhealthy");
    }
  });

  it("is NOT eligible, with reason p2_unhealthy, when oracle is paused", () => {
    const record = fixtureRecord({ capturedAt: "2026-09-07T12:00:00.000Z", oraclePaused: true });
    const result = evaluateIntelligenceEligibility(record);
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe("p2_unhealthy");
  });

  it("is NOT eligible, with reason p2_unhealthy, when there is a trading halt", () => {
    const record = fixtureRecord({ capturedAt: "2026-09-07T12:00:00.000Z", tradingHalt: true });
    const result = evaluateIntelligenceEligibility(record);
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe("p2_unhealthy");
  });
});

describe("synthetic weekend fixture — the exact inherited-risk scenario P3's freshness rule mitigates", () => {
  it("excludes weekend snapshots whose reference is frozen at Friday close, despite P2 reporting healthy_current for all of them", () => {
    const fridayClose = new Date("2026-09-04T20:00:00.000Z"); // Friday market close, reference stops updating here
    const weekendRecords = [];
    // Every 15 minutes from Friday close through Sunday night — the
    // reference's updatedAt never advances (frozen), but P0's 48h isStale
    // threshold has NOT fired yet for most of this window.
    for (let i = 0; i < 4 * 24 * 2; i++) {
      // 2 days of 15-minute samples
      const capturedAt = new Date(fridayClose.getTime() + (i + 1) * 15 * 60000);
      weekendRecords.push(fixtureRecord({ capturedAt: capturedAt.toISOString(), referenceUpdatedAt: fridayClose.toISOString() }));
    }

    // Confirm the premise: P2's own check reports healthy_current for
    // every one of these records, since P0's chainlinkReference.status
    // only flips to "unavailable/stale" once ITS OWN (48-hour, unmodified)
    // threshold fires — which this fixture deliberately does not simulate,
    // exactly reproducing the documented, inherited risk this rule exists
    // to mitigate at the P3 layer without touching P0.
    const stillHealthyByP2 = weekendRecords.filter((r) => classifyOverallStatus(r) === "healthy_current");
    expect(stillHealthyByP2.length).toBe(weekendRecords.length);

    // P3's stricter rule should reject everything past 6 hours of staleness.
    const eligibleByP3 = weekendRecords.filter((r) => isEligibleForIntelligence(r));
    const sixHoursOfSamples = 6 * 4; // 4 samples/hour at 15-minute cadence
    expect(eligibleByP3.length).toBeLessThanOrEqual(sixHoursOfSamples);
    expect(eligibleByP3.length).toBeGreaterThan(0); // the first few samples right after close are still genuinely fresh
  });
});
