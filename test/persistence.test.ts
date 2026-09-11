import { describe, it, expect } from "vitest";
import { computePersistenceEpisode } from "../src/intelligence/persistence.js";
import { fixtureRecord } from "./fixtures/intelligenceFixtures.js";
import type { HistoricalBaseline } from "../src/intelligence/types.js";

// median 0, mad 0.1 -> a reading of 0.5 is 5.0x (SEVERE), 0.05 is 0.5x (NORMAL)
const baseline: HistoricalBaseline = {
  observationCount: 300,
  baselineStartAt: new Date("2026-08-01T00:00:00.000Z"),
  baselineEndAt: new Date("2026-09-07T00:00:00.000Z"),
  medianPct: 0,
  typicalAbsDeviationFromParityPct: 0.1,
  dispersionMad: 0.1,
  elapsedHours: 900,
  excludedByFreshnessCount: 0,
};

describe("computePersistenceEpisode — no active episode", () => {
  it("reports no_active_episode when the current reading is NORMAL", () => {
    const records = [
      fixtureRecord({ capturedAt: "2026-09-07T10:00:00.000Z", premiumDiscountPct: 0.5 }), // SEVERE
      fixtureRecord({ capturedAt: "2026-09-07T10:15:00.000Z", premiumDiscountPct: 0.02 }), // NORMAL — recovered
    ];
    const episode = computePersistenceEpisode(records, baseline);
    expect(episode.state).toBe("no_active_episode");
  });

  it("reports no_active_episode with an empty (but present) current NORMAL reading and no prior history", () => {
    const records = [fixtureRecord({ capturedAt: "2026-09-07T10:00:00.000Z", premiumDiscountPct: 0.01 })];
    expect(computePersistenceEpisode(records, baseline).state).toBe("no_active_episode");
  });
});

describe("computePersistenceEpisode — current_observation_unavailable", () => {
  it("reports current_observation_unavailable when there is no history at all", () => {
    expect(computePersistenceEpisode([], baseline).state).toBe("current_observation_unavailable");
  });

  it("reports current_observation_unavailable when the most recent record is P2-unhealthy", () => {
    const records = [
      fixtureRecord({ capturedAt: "2026-09-07T10:00:00.000Z", premiumDiscountPct: 0.5 }),
      fixtureRecord({ capturedAt: "2026-09-07T10:15:00.000Z", chainlinkStale: true }),
    ];
    expect(computePersistenceEpisode(records, baseline).state).toBe("current_observation_unavailable");
  });

  it("reports current_observation_unavailable when the most recent record fails ONLY P3's freshness rule", () => {
    const records = [
      fixtureRecord({ capturedAt: "2026-09-07T10:00:00.000Z", premiumDiscountPct: 0.5 }),
      fixtureRecord({ capturedAt: "2026-09-07T10:15:00.000Z", premiumDiscountPct: 0.5, referenceUpdatedAt: "2026-08-01T00:00:00.000Z" }),
    ];
    expect(computePersistenceEpisode(records, baseline).state).toBe("current_observation_unavailable");
  });
});

describe("computePersistenceEpisode — normal 15-minute continuity", () => {
  it("extends the episode across consecutive 15-minute abnormal readings", () => {
    const records = [
      fixtureRecord({ capturedAt: "2026-09-07T10:00:00.000Z", premiumDiscountPct: 0.5 }),
      fixtureRecord({ capturedAt: "2026-09-07T10:15:00.000Z", premiumDiscountPct: 0.55 }),
      fixtureRecord({ capturedAt: "2026-09-07T10:30:00.000Z", premiumDiscountPct: 0.6 }),
    ];
    const episode = computePersistenceEpisode(records, baseline);
    expect(episode.state).toBe("active");
    if (episode.state === "active") {
      expect(episode.dislocationStartedAt.toISOString()).toBe("2026-09-07T10:00:00.000Z");
      expect(episode.durationMinutes).toBeCloseTo(30, 5);
      expect(episode.consecutiveAbnormalObservations).toBe(3);
      expect(episode.peakAbsoluteDeviationPct).toBeCloseTo(0.6, 5);
    }
  });
});

describe("computePersistenceEpisode — allowed jitter", () => {
  it("does not break continuity for a 22-minute gap (within the 30-minute tolerance)", () => {
    const records = [
      fixtureRecord({ capturedAt: "2026-09-07T10:00:00.000Z", premiumDiscountPct: 0.5 }),
      fixtureRecord({ capturedAt: "2026-09-07T10:22:00.000Z", premiumDiscountPct: 0.55 }),
    ];
    const episode = computePersistenceEpisode(records, baseline);
    expect(episode.state).toBe("active");
    if (episode.state === "active") {
      expect(episode.consecutiveAbnormalObservations).toBe(2);
      expect(episode.dislocationStartedAt.toISOString()).toBe("2026-09-07T10:00:00.000Z");
    }
  });
});

describe("computePersistenceEpisode — excessive timestamp gap (the brief's own example)", () => {
  it("does NOT report a 3-hour continuous episode across a missing capture window (10:00, 10:15, [gap], 13:00)", () => {
    const records = [
      fixtureRecord({ capturedAt: "2026-09-07T10:00:00.000Z", premiumDiscountPct: 0.5 }),
      fixtureRecord({ capturedAt: "2026-09-07T10:15:00.000Z", premiumDiscountPct: 0.55 }),
      // collector stops — nothing written for 10:30 through 12:45
      fixtureRecord({ capturedAt: "2026-09-07T13:00:00.000Z", premiumDiscountPct: 0.6 }),
    ];
    const episode = computePersistenceEpisode(records, baseline);
    expect(episode.state).toBe("active");
    if (episode.state === "active") {
      // The episode must start at 10:15 (the record immediately before the
      // gap that the walk-back could still reach), NOT 10:00 — the 165
      // minute gap between 10:15 and 13:00 must break continuity.
      expect(episode.dislocationStartedAt.toISOString()).toBe("2026-09-07T13:00:00.000Z");
      expect(episode.durationMinutes).toBe(0);
      expect(episode.consecutiveAbnormalObservations).toBe(1);
    }
  });
});

describe("computePersistenceEpisode — invalid-record continuity break", () => {
  it("breaks continuity when a P2-invalid record sits between two otherwise-abnormal, closely-spaced records", () => {
    const records = [
      fixtureRecord({ capturedAt: "2026-09-07T10:00:00.000Z", premiumDiscountPct: 0.5 }),
      fixtureRecord({ capturedAt: "2026-09-07T10:15:00.000Z", chainlinkStale: true }), // invalid, even though only 15 min gap
      fixtureRecord({ capturedAt: "2026-09-07T10:30:00.000Z", premiumDiscountPct: 0.6 }),
    ];
    const episode = computePersistenceEpisode(records, baseline);
    expect(episode.state).toBe("active");
    if (episode.state === "active") {
      // Cannot extend back through the invalid record, even though the
      // timestamp delta alone would have been within tolerance.
      expect(episode.dislocationStartedAt.toISOString()).toBe("2026-09-07T10:30:00.000Z");
      expect(episode.consecutiveAbnormalObservations).toBe(1);
    }
  });

  it("breaks continuity when the earlier record fails only P3's freshness rule", () => {
    const records = [
      fixtureRecord({ capturedAt: "2026-09-07T10:00:00.000Z", premiumDiscountPct: 0.5, referenceUpdatedAt: "2026-08-01T00:00:00.000Z" }), // P2 ok, P3 stale
      fixtureRecord({ capturedAt: "2026-09-07T10:15:00.000Z", premiumDiscountPct: 0.6 }),
    ];
    const episode = computePersistenceEpisode(records, baseline);
    expect(episode.state).toBe("active");
    if (episode.state === "active") {
      expect(episode.dislocationStartedAt.toISOString()).toBe("2026-09-07T10:15:00.000Z");
      expect(episode.consecutiveAbnormalObservations).toBe(1);
    }
  });
});

describe("computePersistenceEpisode — peak deviation during an episode", () => {
  it("tracks the maximum absolute deviation reached anywhere in the episode, not just the current or first value", () => {
    const records = [
      fixtureRecord({ capturedAt: "2026-09-07T10:00:00.000Z", premiumDiscountPct: 0.3 }),
      fixtureRecord({ capturedAt: "2026-09-07T10:15:00.000Z", premiumDiscountPct: 0.9 }), // peak
      fixtureRecord({ capturedAt: "2026-09-07T10:30:00.000Z", premiumDiscountPct: 0.4 }),
    ];
    const episode = computePersistenceEpisode(records, baseline);
    expect(episode.state).toBe("active");
    if (episode.state === "active") {
      expect(episode.peakAbsoluteDeviationPct).toBeCloseTo(0.9, 5);
    }
  });

  it("tracks peak deviation symmetrically for a negative-discount episode", () => {
    const records = [
      fixtureRecord({ capturedAt: "2026-09-07T10:00:00.000Z", premiumDiscountPct: -0.3 }),
      fixtureRecord({ capturedAt: "2026-09-07T10:15:00.000Z", premiumDiscountPct: -0.9 }),
    ];
    const episode = computePersistenceEpisode(records, baseline);
    expect(episode.state).toBe("active");
    if (episode.state === "active") {
      expect(episode.peakAbsoluteDeviationPct).toBeCloseTo(0.9, 5);
    }
  });
});

describe("computePersistenceEpisode — recovery back to NORMAL", () => {
  it("an episode that recovers to NORMAL and stays there reports no_active_episode, not a stale episode carried forward", () => {
    const records = [
      fixtureRecord({ capturedAt: "2026-09-07T09:00:00.000Z", premiumDiscountPct: 0.5 }),
      fixtureRecord({ capturedAt: "2026-09-07T09:15:00.000Z", premiumDiscountPct: 0.55 }),
      fixtureRecord({ capturedAt: "2026-09-07T09:30:00.000Z", premiumDiscountPct: 0.02 }), // recovered
      fixtureRecord({ capturedAt: "2026-09-07T09:45:00.000Z", premiumDiscountPct: 0.01 }),
    ];
    expect(computePersistenceEpisode(records, baseline).state).toBe("no_active_episode");
  });
});
