/**
 * Uniswap V3 spot-price normalization.
 *
 * BACKGROUND — the bug this file exists to fix:
 * The first external live P0 run against real infrastructure produced
 * nonsense premium/discount values (e.g. AAPL +970,533,841.6960%, GOOGL
 * -100.0000%). The root cause was using the raw sqrtPriceX96-derived ratio
 * directly as if it were already a human-scale, correctly-oriented USD
 * price. It is neither:
 *   1. It is NOT decimals-adjusted — Uniswap V3 pools quote price in raw
 *      smallest-unit terms, so a Stock Token (18 decimals) paired against
 *      USDG (6 decimals, per Robinhood-Chain on-chain analysis) has a raw
 *      ratio off by a factor of 10^12 from the human-readable price, in one
 *      direction or the other depending on which token is token0.
 *   2. It is NOT orientation-normalized — Uniswap V3 always orders
 *      token0/token1 by contract address, not by "which one is the
 *      interesting one," so whether the Stock Token is token0 or token1
 *      varies pool by pool and must never be assumed.
 *
 * This module fixes both, and refuses to guess: it requires the caller's
 * OWN already-trusted addresses for the Stock Token and the quote asset
 * (never inferred from pool metadata, symbol, or name — see the
 * counterfeit-token risk documented in evidence/PROVENANCE.md), and throws
 * loudly if the pool's actual token0/token1 don't match that expected pair.
 */

export interface PoolPriceInputs {
  sqrtPriceX96: bigint;
  token0: string;
  token1: string;
  decimals0: number;
  decimals1: number;
  /** The Stock Token address we asked for this pool BECAUSE OF — from our own trusted config, never from pool metadata. */
  expectedStockTokenAddress: string;
  /** The quote asset (e.g. USDG) address we expect on the other side — from our own trusted config. */
  expectedQuoteAssetAddress: string;
}

/**
 * Returns the price of 1 Stock Token, denominated in the quote asset
 * (e.g. "USDG per 1 AAPL token"), correctly decimals-adjusted and
 * orientation-corrected.
 *
 * Throws if:
 *   - the pool's token0/token1 do not match the expected (stock, quote) pair
 *     at all (wrong pool was resolved, or addresses were mistyped in config)
 *   - the resulting price is non-positive or non-finite
 *
 * NOTE ON PRECISION: sqrtPriceX96 is a uint160 and is converted to a JS
 * `Number` here, which loses precision below ~53 bits. For realistic token
 * prices this loses accuracy far beyond what's needed for a displayed
 * price (the error is many orders of magnitude smaller than the ~1% moves
 * this product cares about) — it is NOT the source of the bug described
 * above, which was a missing decimals adjustment (a 10^12 factor), not a
 * floating-point rounding error. This function is display-grade, not
 * settlement-grade; do not use it to size an actual on-chain trade.
 */
export function computeStockTokenPriceInQuoteAsset(inputs: PoolPriceInputs): number {
  const {
    sqrtPriceX96,
    token0,
    token1,
    decimals0,
    decimals1,
    expectedStockTokenAddress,
    expectedQuoteAssetAddress,
  } = inputs;

  const t0 = token0.toLowerCase();
  const t1 = token1.toLowerCase();
  const stock = expectedStockTokenAddress.toLowerCase();
  const quote = expectedQuoteAssetAddress.toLowerCase();

  const stockIsToken0 = t0 === stock;
  const stockIsToken1 = t1 === stock;
  const quoteIsToken0 = t0 === quote;
  const quoteIsToken1 = t1 === quote;

  const validPair = (stockIsToken0 && quoteIsToken1) || (stockIsToken1 && quoteIsToken0);
  if (!validPair) {
    throw new Error(
      `Pool token pair does not match the expected (stock=${expectedStockTokenAddress}, quote=${expectedQuoteAssetAddress}) ` +
        `pair — pool has token0=${token0} token1=${token1}. Refusing to guess orientation; this pool must not be used.`,
    );
  }

  const Q96 = 2 ** 96;
  const sqrtPrice = Number(sqrtPriceX96) / Q96;
  const rawPriceToken1PerToken0 = sqrtPrice * sqrtPrice;

  // Decimals adjustment: raw price is in smallest-unit terms; scale to human units.
  const humanPriceToken1PerToken0 = rawPriceToken1PerToken0 * 10 ** (decimals0 - decimals1);

  let quotePerStock: number;
  if (stockIsToken0) {
    // humanPriceToken1PerToken0 is already "quote per stock" — exactly what we want.
    quotePerStock = humanPriceToken1PerToken0;
  } else {
    // humanPriceToken1PerToken0 is "stock per quote" — invert it.
    if (!(humanPriceToken1PerToken0 > 0) || !Number.isFinite(humanPriceToken1PerToken0)) {
      throw new Error(
        `Refusing to invert a non-positive/non-finite intermediate price=${humanPriceToken1PerToken0}`,
      );
    }
    quotePerStock = 1 / humanPriceToken1PerToken0;
  }

  if (!Number.isFinite(quotePerStock) || !(quotePerStock > 0)) {
    throw new Error(`Computed non-finite or non-positive secondary price=${quotePerStock}`);
  }

  return quotePerStock;
}
