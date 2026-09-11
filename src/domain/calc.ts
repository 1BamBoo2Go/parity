/**
 * Pure calculation functions. No I/O. No network. Fully unit-testable.
 *
 * These encode the semantics we verified during reconnaissance:
 *   - Chainlink's Robinhood tokenized-equity feed ALREADY returns
 *     (underlying market price × uiMultiplier). Do not multiply again.
 *   - Robinhood's own REST /rhj/prices endpoint returns the RAW
 *     underlying bid/ask, which is NOT multiplier-adjusted. To compare it
 *     against a token-denominated secondary price, the multiplier must be
 *     applied exactly once, here, and nowhere else downstream.
 */

/** Scale a raw integer on-chain answer (e.g. from latestRoundData) by its decimals. */
export function normalizeOnchainAnswer(rawAnswer: bigint, decimals: number): number {
  if (decimals < 0 || decimals > 36) {
    throw new Error(`Refusing to normalize with implausible decimals=${decimals}`);
  }
  // Use string-based division to avoid float precision loss for large integers,
  // then parse — acceptable for display-grade precision (not for settlement).
  const divisor = 10n ** BigInt(decimals);
  const whole = rawAnswer / divisor;
  const remainder = rawAnswer % divisor;
  const fractionStr = remainder.toString().padStart(decimals, "0");
  return Number(`${whole}.${fractionStr}`);
}

/**
 * Convert Robinhood's raw REST underlying-equity price into the same
 * "token value" terms the Chainlink feed reports, by applying the
 * corporate-action multiplier EXACTLY ONCE.
 *
 * This function is the single, explicit place in the codebase where the
 * REST-path multiplier application happens. Any code that already has a
 * Chainlink-sourced reference price must NOT call this — see the
 * `MultiplierAlreadyAppliedError` guard in buildParitySnapshot.ts.
 */
export function applyMultiplierOnce(rawUnderlyingPrice: number, currentMultiplier: string): number {
  const multiplier = Number(currentMultiplier);
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error(`Refusing to apply implausible multiplier="${currentMultiplier}"`);
  }
  return rawUnderlyingPrice * multiplier;
}

export function computePremiumDiscountPct(secondaryPrice: number, referencePrice: number): number {
  if (!(referencePrice > 0)) {
    throw new Error(`Refusing to compute premium/discount against non-positive reference=${referencePrice}`);
  }
  return ((secondaryPrice - referencePrice) / referencePrice) * 100;
}

/**
 * Staleness check. `maxAgeSeconds` should be supplied by config, not hardcoded
 * here — different tickers/venues may warrant different thresholds (e.g. the
 * 48h / 172800s value observed in the live Wield vault contracts is a
 * reasonable default for RTH-only-updating equity feeds, but is that
 * project's choice, not an official Chainlink-mandated number).
 */
export function isStale(updatedAt: Date, now: Date, maxAgeSeconds: number): boolean {
  const ageSeconds = (now.getTime() - updatedAt.getTime()) / 1000;
  return ageSeconds > maxAgeSeconds;
}

/**
 * Circuit breaker against decimals/orientation bugs.
 *
 * The first external live P0 run produced values like +970,533,841.6960%
 * and -100.0000% from a real decimals/orientation bug in secondary-price
 * computation (see src/domain/poolPrice.ts for the fix). This function
 * exists purely to make sure a bug like that can never again be reported to
 * a user as a valid market observation — it is a bug-detector, NOT a claim
 * about what premium/discount magnitude is realistically possible in the
 * market. The default bound (±50%) is deliberately generous for that
 * reason; tighten it only with real calibration data, not a guess.
 */
export function assertPlausiblePremiumDiscountPct(pct: number, maxAbsPct = 50): void {
  if (!Number.isFinite(pct)) {
    throw new Error(`Refusing to accept a non-finite premium/discount pct=${pct}`);
  }
  if (Math.abs(pct) > maxAbsPct) {
    throw new Error(
      `Refusing to accept an implausible premium/discount pct=${pct.toFixed(4)}% ` +
        `(exceeds sanity bound of \u00b1${maxAbsPct}%). This is far more likely to be a ` +
        `decimals/orientation computation bug than a real market dislocation — see ` +
        `src/domain/poolPrice.ts and the external-P0-run incident in evidence/P0-EVIDENCE-REPORT.md.`,
    );
  }
}

/** Mid price from a bid/ask pair, with explicit validation — never silently NaN. */
export function midPrice(bid: number, ask: number): number {
  if (!(bid > 0) || !(ask > 0) || ask < bid) {
    throw new Error(`Refusing to compute mid price from implausible bid=${bid} ask=${ask}`);
  }
  return (bid + ask) / 2;
}
