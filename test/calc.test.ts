import { describe, it, expect } from "vitest";
import {
  normalizeOnchainAnswer,
  applyMultiplierOnce,
  computePremiumDiscountPct,
  assertPlausiblePremiumDiscountPct,
  isStale,
  midPrice,
} from "../src/domain/calc.js";

describe("normalizeOnchainAnswer", () => {
  it("scales a standard 8-decimal Chainlink answer correctly", () => {
    // 30000000000 at 8 decimals = $300.00 — the exact worked example from
    // docs.robinhood.com/chain/oracles-and-price-feeds.
    expect(normalizeOnchainAnswer(30_000_000_000n, 8)).toBe(300);
  });

  it("handles a non-round fractional value without float drift on the integer part", () => {
    // $213.45 at 8 decimals
    expect(normalizeOnchainAnswer(21_345_000_000n, 8)).toBeCloseTo(213.45, 6);
  });

  it("handles 18-decimal answers", () => {
    expect(normalizeOnchainAnswer(200_000_000_000_000_000_000n, 18)).toBe(200);
  });

  it("rejects implausible decimals rather than silently misinterpreting them", () => {
    expect(() => normalizeOnchainAnswer(100n, -1)).toThrow();
    expect(() => normalizeOnchainAnswer(100n, 40)).toThrow();
  });
});

describe("applyMultiplierOnce — the double-application guard", () => {
  it("applies the corporate-action multiplier exactly once to a raw REST price", () => {
    // Worked example from docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood:
    // stock $200, multiplier drifts 1.000 -> 1.008 after a dividend, token price becomes $201.60.
    expect(applyMultiplierOnce(200, "1.008")).toBeCloseTo(201.6, 6);
  });

  it("is a no-op in effect at multiplier 1.0 (pre-corporate-action baseline)", () => {
    expect(applyMultiplierOnce(213.45, "1.000000000000000000")).toBeCloseTo(213.45, 6);
  });

  it("reproduces the documented 10:1 split continuity example", () => {
    // Before split: stock $200, multiplier 1.0 -> token price $200.
    // After split: stock $20, multiplier 10.0 -> token price should still be $200.
    expect(applyMultiplierOnce(200, "1.0")).toBeCloseTo(200, 6);
    expect(applyMultiplierOnce(20, "10.0")).toBeCloseTo(200, 6);
  });

  it("refuses a non-numeric or non-positive multiplier rather than propagating garbage", () => {
    expect(() => applyMultiplierOnce(100, "not-a-number")).toThrow();
    expect(() => applyMultiplierOnce(100, "0")).toThrow();
    expect(() => applyMultiplierOnce(100, "-1")).toThrow();
  });
});

describe("computePremiumDiscountPct", () => {
  it("computes a positive premium when secondary trades above reference", () => {
    expect(computePremiumDiscountPct(102, 100)).toBeCloseTo(2, 6);
  });

  it("computes a negative discount when secondary trades below reference", () => {
    expect(computePremiumDiscountPct(97, 100)).toBeCloseTo(-3, 6);
  });

  it("is exactly zero at true parity", () => {
    expect(computePremiumDiscountPct(100, 100)).toBe(0);
  });

  it("refuses to divide by a non-positive reference price", () => {
    expect(() => computePremiumDiscountPct(100, 0)).toThrow();
    expect(() => computePremiumDiscountPct(100, -5)).toThrow();
  });
});

describe("assertPlausiblePremiumDiscountPct — the circuit breaker added after the external P0 run incident", () => {
  it("accepts ordinary, realistic premium/discount values", () => {
    expect(() => assertPlausiblePremiumDiscountPct(0.26)).not.toThrow();
    expect(() => assertPlausiblePremiumDiscountPct(-3.1)).not.toThrow();
    expect(() => assertPlausiblePremiumDiscountPct(0)).not.toThrow();
  });

  it("rejects the EXACT nonsense values observed in the first external live P0 run", () => {
    // AAPL: +970,533,841.6960%
    expect(() => assertPlausiblePremiumDiscountPct(970_533_841.696)).toThrow(/implausible/);
    // GOOGL: -100.0000%
    expect(() => assertPlausiblePremiumDiscountPct(-100)).toThrow(/implausible/);
    // USO: +4,934,315,251.2301%
    expect(() => assertPlausiblePremiumDiscountPct(4_934_315_251.2301)).toThrow(/implausible/);
    // SPCX: -100.0000%
    expect(() => assertPlausiblePremiumDiscountPct(-100)).toThrow(/implausible/);
  });

  it("rejects non-finite values outright", () => {
    expect(() => assertPlausiblePremiumDiscountPct(Infinity)).toThrow();
    expect(() => assertPlausiblePremiumDiscountPct(NaN)).toThrow();
  });

  it("respects a custom bound when one is explicitly supplied", () => {
    expect(() => assertPlausiblePremiumDiscountPct(60, 100)).not.toThrow();
    expect(() => assertPlausiblePremiumDiscountPct(60, 50)).toThrow();
  });
});

describe("isStale", () => {
  const now = new Date("2026-09-07T12:00:00Z");

  it("is not stale exactly at the boundary minus one second", () => {
    const updatedAt = new Date(now.getTime() - 47 * 3600 * 1000); // 47h old, max 48h
    expect(isStale(updatedAt, now, 172_800)).toBe(false);
  });

  it("is stale just past the max age", () => {
    const updatedAt = new Date(now.getTime() - 49 * 3600 * 1000); // 49h old, max 48h
    expect(isStale(updatedAt, now, 172_800)).toBe(true);
  });

  it("treats data from the future as not stale (clock-skew tolerant, not a crash)", () => {
    const updatedAt = new Date(now.getTime() + 60_000);
    expect(isStale(updatedAt, now, 172_800)).toBe(false);
  });
});

describe("midPrice", () => {
  it("computes the mid of a normal bid/ask spread", () => {
    expect(midPrice(213.45, 213.47)).toBeCloseTo(213.46, 6);
  });

  it("refuses an inverted or non-positive bid/ask (a real upstream data bug, not something to paper over)", () => {
    expect(() => midPrice(0, 100)).toThrow();
    expect(() => midPrice(100, 0)).toThrow();
    expect(() => midPrice(101, 100)).toThrow(); // ask < bid
  });
});
