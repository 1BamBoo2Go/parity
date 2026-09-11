import { describe, it, expect } from "vitest";
import { classifyCurrentDislocation } from "../src/intelligence/classification.js";
import type { HistoricalBaseline } from "../src/intelligence/types.js";

function maturedBaseline(medianPct: number, dispersionMad: number): HistoricalBaseline {
  return {
    observationCount: 300,
    baselineStartAt: new Date("2026-08-01T00:00:00.000Z"),
    baselineEndAt: new Date("2026-09-07T00:00:00.000Z"),
    medianPct,
    typicalAbsDeviationFromParityPct: Math.abs(medianPct),
    dispersionMad,
    elapsedHours: 900,
    excludedByFreshnessCount: 0,
  };
}

describe("classifyCurrentDislocation — the brief's own worked examples", () => {
  it("+0.25% at 0.8x typical deviation classifies NORMAL", () => {
    // Choose median/MAD so that (0.25 - median)/mad = 0.8
    const baseline = maturedBaseline(0.1, (0.25 - 0.1) / 0.8); // mad = 0.1875
    const result = classifyCurrentDislocation(0.25, baseline);
    expect(result.relativeDeviationMultiple).toBeCloseTo(0.8, 5);
    expect(result.classification).toBe("NORMAL");
  });

  it("+2.84% at 5.2x typical deviation classifies SEVERE", () => {
    const baseline = maturedBaseline(0.1, (2.84 - 0.1) / 5.2); // mad ~= 0.5269
    const result = classifyCurrentDislocation(2.84, baseline);
    expect(result.relativeDeviationMultiple).toBeCloseTo(5.2, 1);
    expect(result.classification).toBe("SEVERE");
  });
});

describe("classifyCurrentDislocation — tier boundaries", () => {
  const baseline = maturedBaseline(0, 0.1); // median 0, mad 0.1 -> multiple = |current|/0.1

  it("classifies NORMAL below the ELEVATED relative threshold", () => {
    expect(classifyCurrentDislocation(0.15, baseline).classification).toBe("NORMAL"); // 1.5x
  });

  it("classifies ELEVATED exactly at 2.0x with the absolute floor cleared", () => {
    const result = classifyCurrentDislocation(0.2, baseline); // 2.0x, 0.2% >= 0.10% floor
    expect(result.classification).toBe("ELEVATED");
  });

  it("classifies DISLOCATED exactly at 3.5x with the absolute floor cleared", () => {
    const result = classifyCurrentDislocation(0.35, baseline); // 3.5x, 0.35% >= 0.25% floor
    expect(result.classification).toBe("DISLOCATED");
  });

  it("classifies SEVERE exactly at 5.0x with the absolute floor cleared", () => {
    const result = classifyCurrentDislocation(0.5, baseline); // 5.0x, 0.5% >= 0.50% floor
    expect(result.classification).toBe("SEVERE");
  });

  it("is robust to floating-point representation error at an exact boundary (regression: 0.35/0.1 !== 3.5 in IEEE754)", () => {
    // This exact case (0.35 against a MAD of 0.1) was caught failing during
    // development: raw division yields 3.4999999999999996, one ULP short
    // of the DISLOCATED threshold, which would have silently placed a
    // genuinely-at-the-boundary observation one tier too low.
    expect(0.35 / 0.1).not.toBe(3.5); // confirms the underlying float behavior this test guards against
    const result = classifyCurrentDislocation(0.35, baseline);
    expect(result.classification).toBe("DISLOCATED");
  });
});

describe("classifyCurrentDislocation — absolute floor preventing false alarms on tiny-variance tickers", () => {
  it("does NOT escalate when the relative multiple is huge but the absolute move is economically insignificant", () => {
    // A ticker whose normal MAD is extremely tiny (0.001%): even a move to
    // 0.05% would be 50x the typical deviation, but 0.05% absolute is
    // below every tier's absolute floor -> must remain NORMAL, not SEVERE.
    const tinyVarianceBaseline = maturedBaseline(0, 0.001);
    const result = classifyCurrentDislocation(0.05, tinyVarianceBaseline);
    expect(result.relativeDeviationMultiple).toBeGreaterThan(5); // would clear SEVERE's multiple alone
    expect(result.classification).toBe("NORMAL"); // but the absolute floor blocks it
  });
});

describe("classifyCurrentDislocation — exact boundary matrix (relative multiple AND absolute floor, independently)", () => {
  // Denominator chosen to make 2.0x/3.5x/5.0x land on values with real
  // floating-point representation risk (division, not clean multiples of
  // powers of two), so these tests actually exercise the epsilon fix
  // rather than accidentally landing on exact binary fractions.
  const mad = 0.1;
  const baseline = maturedBaseline(0, mad);

  it("ELEVATED: exactly 2.0x clears; the absolute floor (0.10%) is exactly cleared", () => {
    const result = classifyCurrentDislocation(0.2, baseline); // 0.2/0.1 = 2.0 exactly (clean binary fraction, still checked)
    expect(result.relativeDeviationMultiple).toBeCloseTo(2.0, 9);
    expect(result.currentAbsDeviationFromParityPct).toBeCloseTo(0.2, 9);
    expect(result.classification).toBe("ELEVATED");
  });

  it("ELEVATED: just below 2.0x on the multiple does NOT escalate, even with the absolute floor cleared", () => {
    const result = classifyCurrentDislocation(0.1999, baseline);
    expect(result.classification).toBe("NORMAL");
  });

  it("ELEVATED: multiple clears comfortably but absolute value is just below the 0.10% floor -> NORMAL (the false-alarm guard)", () => {
    // Note: the MAD_FLOOR_PCT (0.005) applies here since this baseline's
    // raw MAD (0.0001) is below it — effectiveMad becomes 0.005, giving a
    // multiple of 0.0999/0.005 ~= 19.98, which alone would clear even the
    // SEVERE relative threshold. The absolute floor must still block it.
    const tinyMadBaseline = maturedBaseline(0, 0.0001);
    const result = classifyCurrentDislocation(0.0999, tinyMadBaseline);
    expect(result.relativeDeviationMultiple).toBeGreaterThan(5);
    expect(result.classification).toBe("NORMAL");
  });

  it("ELEVATED: absolute value exactly at the 0.10% floor, with the multiple also exactly cleared, DOES escalate (inclusive >=)", () => {
    const tinyMadBaseline = maturedBaseline(0, 0.00005); // multiple for 0.10 = 2000x, comfortably clears 2.0x
    const result = classifyCurrentDislocation(0.1, tinyMadBaseline);
    expect(result.currentAbsDeviationFromParityPct).toBeCloseTo(0.1, 9);
    expect(result.classification).not.toBe("NORMAL");
  });

  it("DISLOCATED: exactly 3.5x clears (the documented IEEE754 case: 0.35/0.1 !== 3.5 in raw float)", () => {
    const result = classifyCurrentDislocation(0.35, baseline);
    expect(result.classification).toBe("DISLOCATED");
  });

  it("DISLOCATED: just below 3.5x does NOT escalate to DISLOCATED (falls back to ELEVATED)", () => {
    const result = classifyCurrentDislocation(0.349, baseline);
    expect(result.classification).toBe("ELEVATED");
  });

  it("DISLOCATED: absolute value exactly at the 0.25% floor, with the multiple exactly cleared, DOES escalate", () => {
    const tinyMadBaseline = maturedBaseline(0, 0.25 / 3.5); // multiple for 0.25 = exactly 3.5x
    const result = classifyCurrentDislocation(0.25, tinyMadBaseline);
    expect(result.classification).toBe("DISLOCATED");
  });

  it("DISLOCATED: multiple clears but absolute value is just below the 0.25% floor -> stays at ELEVATED", () => {
    const tinyMadBaseline = maturedBaseline(0, 0.001); // multiple for 0.2499 is huge, isolates the abs floor
    const result = classifyCurrentDislocation(0.2499, tinyMadBaseline);
    expect(result.classification).toBe("ELEVATED");
  });

  it("SEVERE: exactly 5.0x clears; the absolute floor (0.50%) is exactly cleared", () => {
    const result = classifyCurrentDislocation(0.5, baseline); // 0.5/0.1 = 5.0
    expect(result.classification).toBe("SEVERE");
  });

  it("SEVERE: just below 5.0x does NOT escalate to SEVERE (falls back to DISLOCATED)", () => {
    const result = classifyCurrentDislocation(0.499, baseline);
    expect(result.classification).toBe("DISLOCATED");
  });

  it("SEVERE: absolute value exactly at the 0.50% floor, with the multiple exactly cleared, DOES escalate", () => {
    const tinyMadBaseline = maturedBaseline(0, 0.5 / 5.0); // multiple for 0.50 = exactly 5.0x
    const result = classifyCurrentDislocation(0.5, tinyMadBaseline);
    expect(result.classification).toBe("SEVERE");
  });

  it("SEVERE: multiple clears but absolute value is just below the 0.50% floor -> stays at DISLOCATED", () => {
    const tinyMadBaseline = maturedBaseline(0, 0.001); // isolates the abs floor
    const result = classifyCurrentDislocation(0.4999, tinyMadBaseline);
    expect(result.classification).toBe("DISLOCATED");
  });

  it("the epsilon fix does not broaden the boundary enough to admit a genuinely-below-threshold value", () => {
    // 1.9 is unambiguously, non-marginally below 2.0 — must never round up.
    const result = classifyCurrentDislocation(0.19, baseline);
    expect(result.classification).toBe("NORMAL");
  });
});

describe("classifyCurrentDislocation — sign symmetry", () => {
  const baseline = maturedBaseline(0, 0.1);

  it("classifies a positive premium and an equal-magnitude negative discount identically", () => {
    const positive = classifyCurrentDislocation(0.5, baseline);
    const negative = classifyCurrentDislocation(-0.5, baseline);
    expect(positive.classification).toBe(negative.classification);
    expect(positive.relativeDeviationMultiple).toBeCloseTo(negative.relativeDeviationMultiple, 10);
    expect(positive.currentAbsDeviationFromParityPct).toBeCloseTo(negative.currentAbsDeviationFromParityPct, 10);
  });

  it("a negative discount alone can reach SEVERE, exactly like a positive premium", () => {
    expect(classifyCurrentDislocation(-0.5, baseline).classification).toBe("SEVERE");
  });
});

describe("classifyCurrentDislocation — refuses to classify against an empty baseline", () => {
  it("throws when medianPct/dispersionMad are null (observationCount === 0)", () => {
    const emptyBaseline: HistoricalBaseline = {
      observationCount: 0,
      baselineStartAt: null,
      baselineEndAt: null,
      medianPct: null,
      typicalAbsDeviationFromParityPct: null,
      dispersionMad: null,
      elapsedHours: 0,
      excludedByFreshnessCount: 0,
    };
    expect(() => classifyCurrentDislocation(1.0, emptyBaseline)).toThrow();
  });
});
