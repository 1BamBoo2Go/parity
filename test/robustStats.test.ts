import { describe, it, expect } from "vitest";
import { median, medianAbsoluteDeviation, medianAbsoluteFromZero, relativeDeviationMultiple } from "../src/intelligence/robustStats.js";

describe("median", () => {
  it("computes the middle value of an odd-length array", () => {
    expect(median([1, 3, 2])).toBe(2);
  });

  it("averages the two middle values of an even-length array", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("is insensitive to input order", () => {
    expect(median([5, 1, 3, 2, 4])).toBe(3);
  });

  it("throws on an empty array rather than fabricating 0", () => {
    expect(() => median([])).toThrow();
  });

  it("is robust to a single extreme outlier (the whole point of using median over mean)", () => {
    const normal = [0.1, 0.12, 0.09, 0.11, 0.1];
    const withOutlier = [...normal, 50]; // one wild dislocation event
    expect(median(withOutlier)).toBeCloseTo(0.11, 2);
    // Contrast: a mean would be dragged far from the typical value.
    const mean = withOutlier.reduce((a, b) => a + b, 0) / withOutlier.length;
    expect(mean).toBeGreaterThan(8);
  });
});

describe("medianAbsoluteDeviation", () => {
  it("computes MAD around the series' own median", () => {
    // median = 3; deviations = [2,1,0,1,2]; median of those = 1
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 5])).toBe(1);
  });

  it("accepts an explicit center override instead of recomputing the median", () => {
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 5], 3)).toBe(1);
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 5], 0)).toBe(3);
  });

  it("is resistant to a single extreme outlier", () => {
    const normal = [0.1, 0.12, 0.09, 0.11, 0.1, 0.1, 0.12];
    const withOutlier = [...normal, 50];
    // MAD should stay small despite the outlier — this is the actual point
    // of choosing MAD over standard deviation for this application.
    expect(medianAbsoluteDeviation(withOutlier)).toBeLessThan(1);
  });

  it("throws on an empty array", () => {
    expect(() => medianAbsoluteDeviation([])).toThrow();
  });
});

describe("medianAbsoluteFromZero", () => {
  it("computes median(|x|), distinct from MAD around the median", () => {
    // A ticker with a persistent +0.2% bias: median-from-zero should
    // reflect that bias, not cancel it out the way MAD-around-median would.
    const values = [0.18, 0.2, 0.22, 0.19, 0.21];
    expect(medianAbsoluteFromZero(values)).toBeCloseTo(0.2, 2);
  });

  it("treats positive and negative values symmetrically", () => {
    expect(medianAbsoluteFromZero([0.2, -0.2, 0.2, -0.2, 0.2])).toBeCloseTo(0.2, 5);
  });

  it("throws on an empty array", () => {
    expect(() => medianAbsoluteFromZero([])).toThrow();
  });
});

describe("relativeDeviationMultiple", () => {
  it("computes a simple multiple of MAD-distance from the median", () => {
    // median=0, mad=0.1, current=0.5 -> |0.5-0|/0.1 = 5
    expect(relativeDeviationMultiple(0.5, 0, 0.1, 0.005)).toBeCloseTo(5, 5);
  });

  it("uses the floor when MAD is smaller than it, avoiding division by a near-zero number", () => {
    // mad=0, floor=0.005, current=0.5, median=0 -> 0.5/0.005 = 100
    expect(relativeDeviationMultiple(0.5, 0, 0, 0.005)).toBeCloseTo(100, 5);
  });

  it("returns 0 when current equals the median exactly", () => {
    expect(relativeDeviationMultiple(0.2, 0.2, 0.05, 0.005)).toBe(0);
  });

  it("is symmetric for a positive premium and a negative discount of the same magnitude", () => {
    const positive = relativeDeviationMultiple(0.5, 0, 0.1, 0.005);
    const negative = relativeDeviationMultiple(-0.5, 0, 0.1, 0.005);
    expect(positive).toBeCloseTo(negative, 10);
  });
});
