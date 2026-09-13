import { describe, it, expect } from "vitest";
import { buildTickerIntelligence } from "../src/intelligence/buildTickerIntelligence.js";
import { toRiskProjection } from "../src/readmodel/riskViewModel.js";
import { fixtureRecord, fixtureSeries } from "./fixtures/intelligenceFixtures.js";

const CTX = { capturedAt: new Date("2026-09-12T16:45:03.764Z"), referenceStatus: "healthy_current" as const };

describe("toRiskProjection — A. MATURE + eligible", () => {
  it("preserves deviation, MAD multiple, classification and an active episode", () => {
    const flatBaseline = Array.from({ length: 250 }, () => 0.1);
    const history = fixtureSeries("2026-08-01T00:00:00.000Z", 60, flatBaseline);
    const current = fixtureRecord({ capturedAt: "2026-09-11T10:00:00.000Z", premiumDiscountPct: 3.0 });
    const intelligence = buildTickerIntelligence("AAPL", [...history, current]);
    expect(intelligence.maturity).toBe("MATURE");

    const risk = toRiskProjection({ symbol: "AAPL", intelligence, ...CTX });

    expect(risk.symbol).toBe("AAPL");
    expect(risk.apiVersion).toBe("v1");
    expect(risk.capturedAt).toBe(CTX.capturedAt.toISOString());
    expect(risk.capturedAt).toBe("2026-09-12T16:45:03.764Z");
    expect(risk.referenceStatus).toBe("healthy_current");
    expect(risk.deviation.currentPct).toBe(3.0);
    expect(risk.deviation.direction).toBe("premium");
    expect(risk.deviation.absDeviationPct).toBeCloseTo(3.0, 10);
    expect(risk.eligibility.eligible).toBe(true);
    expect(risk.intelligence.maturity).toBe("MATURE");
    expect(risk.intelligence.classification).toBe("SEVERE");
    expect(risk.intelligence.madMultiple).not.toBeNull();
    expect(risk.intelligence.madMultiple).toBeGreaterThan(0);
    expect(risk.intelligence.episode).not.toBeNull();
    expect(risk.intelligence.episode!.state).toBe("active");
    expect(risk.intelligence.episode!.startedAt).toBe("2026-09-11T10:00:00.000Z");
    expect(risk.intelligence.episode!.consecutiveObservations).toBe(1);
    expect(risk.intelligence.episode!.peakAbsDeviationPct).toBeCloseTo(3.0, 10);
    expect(risk.intelligence.baselineMedianPct).toBeCloseTo(0.1, 10);
    // A flat 0.1 baseline has MAD 0 — a real measurement, must survive as 0, not null.
    expect(risk.intelligence.baselineDispersionMad).toBe(0);
    expect(risk.intelligence.baselinePeriodHours).not.toBeNull();
    expect(risk.intelligence.observationCount).toBe(251);
  });
});

describe("toRiskProjection — B. DEVELOPING + eligible", () => {
  it("exposes the real current deviation while every mature-only statistic stays null", () => {
    const history = fixtureSeries("2026-09-01T00:00:00.000Z", 60, Array.from({ length: 30 }, () => 0.1));
    const intelligence = buildTickerIntelligence("GOOGL", history);
    expect(intelligence.maturity).toBe("DEVELOPING");

    const risk = toRiskProjection({ symbol: "GOOGL", intelligence, ...CTX });

    expect(risk.deviation.currentPct).toBe(0.1);
    expect(risk.deviation.direction).toBe("premium");
    expect(risk.eligibility.eligible).toBe(true);
    expect(risk.intelligence.maturity).toBe("DEVELOPING");
    expect(risk.intelligence.classification).toBeNull();
    expect(risk.intelligence.madMultiple).toBeNull();
    expect(risk.intelligence.episode).toBeNull();
    expect(risk.intelligence.observationCount).toBe(30);
  });
});

describe("toRiskProjection — C. intelligence-ineligible current observation", () => {
  it("MATURE but current record fails the P3 freshness rule: null deviation, ineligible, no carried-forward classification, no zero substitution", () => {
    const flatBaseline = Array.from({ length: 250 }, () => 0.1);
    const history = fixtureSeries("2026-08-01T00:00:00.000Z", 60, flatBaseline);
    const staleCurrent = fixtureRecord({
      capturedAt: "2026-09-11T10:00:00.000Z",
      premiumDiscountPct: 3.0,
      referenceUpdatedAt: "2026-08-01T00:00:00.000Z", // far past the 360-minute rule
    });
    const intelligence = buildTickerIntelligence("USO", [...history, staleCurrent]);
    expect(intelligence.maturity).toBe("MATURE");

    const risk = toRiskProjection({ symbol: "USO", intelligence, ...CTX });

    expect(risk.deviation.currentPct).toBeNull();
    expect(risk.deviation.direction).toBeNull();
    expect(risk.deviation.absDeviationPct).toBeNull();
    expect(risk.eligibility.eligible).toBe(false);
    expect(risk.intelligence.classification).toBeNull();
    expect(risk.intelligence.madMultiple).toBeNull();
    expect(risk.intelligence.episode).not.toBeNull();
    expect(risk.intelligence.episode!.state).toBe("current_observation_unavailable");
    // Never a fabricated zero anywhere in the ineligible path.
    expect(risk.deviation.currentPct).not.toBe(0);
  });

  it("DEVELOPING with an ineligible current record: eligibility false, deviation null, never zero", () => {
    const history = [
      ...fixtureSeries("2026-09-01T00:00:00.000Z", 60, Array.from({ length: 29 }, () => 0.1)),
      fixtureRecord({ capturedAt: "2026-09-02T05:00:00.000Z", oraclePaused: true }),
    ];
    const intelligence = buildTickerIntelligence("SPCX", history);
    expect(intelligence.maturity).toBe("DEVELOPING");

    const risk = toRiskProjection({ symbol: "SPCX", intelligence, ...CTX });
    expect(risk.eligibility.eligible).toBe(false);
    expect(risk.deviation.currentPct).toBeNull();
    expect(risk.deviation.direction).toBeNull();
  });
});

describe("toRiskProjection — D. exact zero deviation", () => {
  it("treats an exact 0 reading as flat, distinct from unavailable", () => {
    const history = fixtureSeries("2026-08-01T00:00:00.000Z", 60, Array.from({ length: 250 }, () => 0.1));
    const zeroCurrent = fixtureRecord({ capturedAt: "2026-09-11T10:00:00.000Z", premiumDiscountPct: 0 });
    const intelligence = buildTickerIntelligence("TSLA", [...history, zeroCurrent]);

    const risk = toRiskProjection({ symbol: "TSLA", intelligence, ...CTX });

    expect(risk.deviation.currentPct).toBe(0);
    expect(risk.deviation.absDeviationPct).toBe(0);
    expect(risk.deviation.direction).toBe("flat");
    expect(risk.eligibility.eligible).toBe(true); // zero is eligible, not unavailable
  });
});

describe("toRiskProjection — E. signed deviation direction", () => {
  it("positive maps to premium, negative maps to discount", () => {
    const history = fixtureSeries("2026-08-01T00:00:00.000Z", 60, Array.from({ length: 250 }, () => 0.1));
    const posIntel = buildTickerIntelligence("NVDA", [...history, fixtureRecord({ capturedAt: "2026-09-11T10:00:00.000Z", premiumDiscountPct: 2.5 })]);
    const negIntel = buildTickerIntelligence("NVDA", [...history, fixtureRecord({ capturedAt: "2026-09-11T10:00:00.000Z", premiumDiscountPct: -2.5 })]);

    expect(toRiskProjection({ symbol: "NVDA", intelligence: posIntel, ...CTX }).deviation.direction).toBe("premium");
    expect(toRiskProjection({ symbol: "NVDA", intelligence: negIntel, ...CTX }).deviation.direction).toBe("discount");
  });
});

describe("toRiskProjection — F. JSON safety", () => {
  it("round-trips through JSON.stringify/parse with no Date objects, NaN, Infinity, or label strings", () => {
    const history = fixtureSeries("2026-08-01T00:00:00.000Z", 60, Array.from({ length: 250 }, () => 0.1));
    const current = fixtureRecord({ capturedAt: "2026-09-11T10:00:00.000Z", premiumDiscountPct: 3.0 });
    const intelligence = buildTickerIntelligence("AAPL", [...history, current]);
    const risk = toRiskProjection({ symbol: "AAPL", intelligence, ...CTX });

    const json = JSON.stringify(risk);
    expect(json).not.toContain("[object Date]");
    expect(json).not.toMatch(/NaN|Infinity/);
    // Never leak the internal pre-rendered UI label or its forbidden wording.
    expect(json).not.toMatch(/typical/i);
    expect(json).not.toContain("z-score");
    expect((risk as unknown as Record<string, unknown>).label).toBeUndefined();

    const parsed = JSON.parse(json);
    expect(parsed.intelligence.episode.startedAt).toBe("2026-09-11T10:00:00.000Z");
    expect(typeof parsed.intelligence.episode.startedAt).toBe("string");

    // Every value in the whole object graph must be JSON-primitive-safe.
    const walk = (v: unknown): void => {
      if (v === null || typeof v === "string" || typeof v === "boolean") return;
      if (typeof v === "number") {
        expect(Number.isFinite(v)).toBe(true);
        return;
      }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (typeof v === "object") {
        expect(v).not.toBeInstanceOf(Date);
        Object.values(v as Record<string, unknown>).forEach(walk);
        return;
      }
      throw new Error(`unexpected JSON-unsafe value: ${String(v)}`);
    };
    walk(parsed);
  });

  it("INSUFFICIENT_DATA with zero history is fully JSON-safe with all statistics null", () => {
    const intelligence = buildTickerIntelligence("QQQ", []);
    const risk = toRiskProjection({ symbol: "QQQ", intelligence, ...CTX });
    const parsed = JSON.parse(JSON.stringify(risk));

    expect(parsed.intelligence.maturity).toBe("INSUFFICIENT_DATA");
    expect(parsed.intelligence.observationCount).toBe(0);
    expect(parsed.intelligence.baselinePeriodHours).toBeNull();
    expect(parsed.intelligence.baselineMedianPct).toBeNull();
    expect(parsed.intelligence.baselineDispersionMad).toBeNull();
    expect(parsed.intelligence.madMultiple).toBeNull();
    expect(parsed.intelligence.classification).toBeNull();
    expect(parsed.intelligence.episode).toBeNull();
    expect(parsed.deviation.currentPct).toBeNull();
    expect(parsed.deviation.direction).toBeNull();
    expect(parsed.eligibility.eligible).toBe(false);
  });
});

describe("toRiskProjection — capturedAt conversion", () => {
  it("converts a Date input into an unambiguous ISO-8601 string, regardless of how the Date was constructed", () => {
    const history = fixtureSeries("2026-08-01T00:00:00.000Z", 60, Array.from({ length: 250 }, () => 0.1));
    const current = fixtureRecord({ capturedAt: "2026-09-11T10:00:00.000Z", premiumDiscountPct: 0.5 });
    const intelligence = buildTickerIntelligence("AAPL", [...history, current]);

    // Constructed from a deliberately different representation (epoch ms)
    // to prove this is a real conversion, not a string passed straight
    // through unexamined.
    const epochMs = Date.UTC(2026, 8, 12, 16, 45, 3, 764); // month is 0-indexed: 8 = September
    const risk = toRiskProjection({ symbol: "AAPL", intelligence, capturedAt: new Date(epochMs), referenceStatus: "healthy_current" });

    expect(risk.capturedAt).toBe("2026-09-12T16:45:03.764Z");
    expect(typeof risk.capturedAt).toBe("string");
  });
});

describe("toRiskProjection — no-active-episode shape", () => {
  it("MATURE, eligible, classification NORMAL: episode reports no_active_episode with null episode fields, not zeros", () => {
    const history = fixtureSeries("2026-08-01T00:00:00.000Z", 60, Array.from({ length: 250 }, (_, i) => 0.1 + (i % 2 === 0 ? 0.01 : -0.01)));
    const intelligence = buildTickerIntelligence("AAPL", history);
    expect(intelligence.maturity).toBe("MATURE");

    const risk = toRiskProjection({ symbol: "AAPL", intelligence, ...CTX });
    expect(risk.intelligence.classification).toBe("NORMAL");
    expect(risk.intelligence.episode).not.toBeNull();
    expect(risk.intelligence.episode!.state).toBe("no_active_episode");
    expect(risk.intelligence.episode!.startedAt).toBeNull();
    expect(risk.intelligence.episode!.durationMinutes).toBeNull();
    expect(risk.intelligence.episode!.consecutiveObservations).toBeNull();
    expect(risk.intelligence.episode!.peakAbsDeviationPct).toBeNull();
  });
});
