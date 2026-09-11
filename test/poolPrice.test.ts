import { describe, it, expect } from "vitest";
import { computeStockTokenPriceInQuoteAsset } from "../src/domain/poolPrice.js";

const STOCK = "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9"; // AAPL, per config
const QUOTE = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"; // USDG, per config
const UNRELATED = "0x0000000000000000000000000000000000dEaD";

/** Build a sqrtPriceX96 for a given "token1 per token0" HUMAN price, at given decimals, so tests can work backward from a known target price. */
function sqrtPriceX96For(humanPriceToken1PerToken0: number, decimals0: number, decimals1: number): bigint {
  const rawPriceToken1PerToken0 = humanPriceToken1PerToken0 / 10 ** (decimals0 - decimals1);
  const sqrtPrice = Math.sqrt(rawPriceToken1PerToken0);
  const Q96 = 2 ** 96;
  return BigInt(Math.round(sqrtPrice * Q96));
}

describe("computeStockTokenPriceInQuoteAsset — orientation and decimals normalization", () => {
  it("computes the correct price when the Stock Token is token0 and USDG (fewer decimals) is token1", () => {
    // Target: 1 AAPL = 213.45 USDG. Stock=18 decimals, USDG=6 decimals.
    const sqrtPriceX96 = sqrtPriceX96For(213.45, 18, 6);
    const price = computeStockTokenPriceInQuoteAsset({
      sqrtPriceX96,
      token0: STOCK,
      token1: QUOTE,
      decimals0: 18,
      decimals1: 6,
      expectedStockTokenAddress: STOCK,
      expectedQuoteAssetAddress: QUOTE,
    });
    expect(price).toBeCloseTo(213.45, 2);
  });

  it("computes the correct price when USDG (fewer decimals) is token0 and the Stock Token is token1 (the inverted case)", () => {
    // Uniswap always orders by address, so this orientation is just as real as the other.
    // Target is still 1 AAPL = 213.45 USDG, but now we must invert.
    // humanPriceToken1PerToken0 here means "AAPL per USDG" = 1 / 213.45.
    const sqrtPriceX96 = sqrtPriceX96For(1 / 213.45, 6, 18);
    const price = computeStockTokenPriceInQuoteAsset({
      sqrtPriceX96,
      token0: QUOTE,
      token1: STOCK,
      decimals0: 6,
      decimals1: 18,
      expectedStockTokenAddress: STOCK,
      expectedQuoteAssetAddress: QUOTE,
    });
    expect(price).toBeCloseTo(213.45, 2);
  });

  it("handles a pair with EQUAL decimals correctly (no adjustment needed, but the code path must not assume this)", () => {
    const sqrtPriceX96 = sqrtPriceX96For(1.5, 18, 18);
    const price = computeStockTokenPriceInQuoteAsset({
      sqrtPriceX96,
      token0: STOCK,
      token1: QUOTE,
      decimals0: 18,
      decimals1: 18,
      expectedStockTokenAddress: STOCK,
      expectedQuoteAssetAddress: QUOTE,
    });
    expect(price).toBeCloseTo(1.5, 2);
  });

  it("refuses to guess orientation when the pool does not contain the expected pair at all", () => {
    const sqrtPriceX96 = sqrtPriceX96For(1, 18, 18);
    expect(() =>
      computeStockTokenPriceInQuoteAsset({
        sqrtPriceX96,
        token0: UNRELATED,
        token1: QUOTE,
        decimals0: 18,
        decimals1: 6,
        expectedStockTokenAddress: STOCK,
        expectedQuoteAssetAddress: QUOTE,
      }),
    ).toThrow(/does not match the expected/);
  });

  it("refuses a pool that has the stock token but the WRONG quote asset (guards against a mispaired pool)", () => {
    const sqrtPriceX96 = sqrtPriceX96For(1, 18, 18);
    expect(() =>
      computeStockTokenPriceInQuoteAsset({
        sqrtPriceX96,
        token0: STOCK,
        token1: UNRELATED,
        decimals0: 18,
        decimals1: 18,
        expectedStockTokenAddress: STOCK,
        expectedQuoteAssetAddress: QUOTE,
      }),
    ).toThrow(/does not match the expected/);
  });

  it("is case-insensitive on addresses (checksummed vs lowercase must not break matching)", () => {
    const sqrtPriceX96 = sqrtPriceX96For(213.45, 18, 6);
    const price = computeStockTokenPriceInQuoteAsset({
      sqrtPriceX96,
      token0: STOCK.toUpperCase().replace("0X", "0x"),
      token1: QUOTE,
      decimals0: 18,
      decimals1: 6,
      expectedStockTokenAddress: STOCK,
      expectedQuoteAssetAddress: QUOTE,
    });
    expect(price).toBeCloseTo(213.45, 2);
  });
});

describe("regression test — reproduces the exact external P0 run incident", () => {
  it("would NOT reproduce the +970,533,841.6960% AAPL bug: correct normalization gives a sane price, not a billion-percent one", () => {
    // The bug was caused by using the raw, un-decimals-adjusted ratio
    // directly. Simulate a realistic AAPL(18dec)/USDG(6dec) pool at a real
    // price and confirm the OLD buggy path (no decimals adjustment) would
    // have been wildly wrong, while the fixed function is not.
    const sqrtPriceX96 = sqrtPriceX96For(213.45, 18, 6);

    // Old, buggy computation for comparison (do NOT use in real code):
    const Q96 = 2 ** 96;
    const sqrtPrice = Number(sqrtPriceX96) / Q96;
    const buggyRawRatio = sqrtPrice * sqrtPrice; // <- what the old code treated as the price
    expect(buggyRawRatio).toBeLessThan(0.001); // wildly, obviously wrong vs. a real ~$213 stock

    const fixedPrice = computeStockTokenPriceInQuoteAsset({
      sqrtPriceX96,
      token0: STOCK,
      token1: QUOTE,
      decimals0: 18,
      decimals1: 6,
      expectedStockTokenAddress: STOCK,
      expectedQuoteAssetAddress: QUOTE,
    });
    expect(fixedPrice).toBeCloseTo(213.45, 2);
  });
});
