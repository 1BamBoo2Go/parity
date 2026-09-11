/**
 * Core domain types for Parity.
 *
 * Design rule (non-negotiable, per project instructions):
 *   - Missing data must never become zero.
 *   - Stale data must never be presented as current.
 *   - Unsupported must never be presented as healthy/parity.
 *
 * We enforce this by making every price-bearing type a discriminated union
 * keyed on `status`. There is no code path in this module that lets a
 * "number" escape without one of these statuses attached — a consumer must
 * explicitly handle the non-`ok` cases, the type system will not let them
 * quietly read `.value` off a status they haven't checked.
 */

/** Why a given data point is not a clean, current, trustworthy number. */
export type UnavailableReason =
  | "no_chainlink_feed" // ticker has no published Chainlink feed at all (e.g. HOOD, per Wield repo evidence)
  | "no_verified_pool" // no independently-verified stablecoin-quoted secondary pool
  | "stale" // updatedAt is older than the configured max age
  | "oracle_paused" // oraclePaused() == true on the token contract
  | "trading_halt" // isTradingHalt == true from Robinhood's /rhj/prices
  | "rpc_unreachable" // the eth_call could not be made at all (e.g. network policy blocked the host)
  | "upstream_error" // the upstream API returned an error / malformed response
  | "rate_limited" // upstream returned 429 and retries were exhausted
  | "implausible_result" // computed value failed a sanity-bound circuit breaker (e.g. a decimals/orientation bug)
  | "not_yet_verified"; // ticker has not passed the Week 1 human verification step

export type DataPoint<T> =
  | { status: "ok"; value: T; asOf: Date; source: string }
  | { status: "unavailable"; reason: UnavailableReason; detail: string; source: string };

export function isOk<T>(dp: DataPoint<T>): dp is { status: "ok"; value: T; asOf: Date; source: string } {
  return dp.status === "ok";
}

export interface TickerConfig {
  symbol: string;
  /** Robinhood Chain mainnet contract address for the Stock Token itself. */
  tokenAddressMainnet: string | null;
  /** Chainlink feed proxy address on Robinhood Chain mainnet, or null if none is published OR not yet identified in available sources — see provenance for which. */
  chainlinkFeedMainnet: string | null;
  /**
   * Whether a stablecoin-quoted secondary pool for this ticker has been
   * individually, humanly verified (per the Week 0 gate + Week 1 follow-up),
   * as opposed to merely assumed because *a* pool exists somewhere.
   */
  poolVerified: boolean;
  poolAddressMainnet: string | null;
  poolDex: string | null; // e.g. "Uniswap V3"
  poolFeeTier: number | null; // e.g. 3000 for 0.3%
  quoteAsset: string | null; // e.g. "USDG"
  /** Free-text citation of where this row's facts came from. Required — no row ships without one. */
  provenance: string;
  /**
   * Non-null ONLY when this ticker is CONFIRMED, by direct evidence (not
   * absence-of-evidence), to permanently lack support — e.g. HOOD's
   * Chainlink feed is explicitly documented as absent by a live production
   * contract's own address table. A ticker whose feed address we simply
   * haven't found yet (a research gap, not a confirmed absence) must leave
   * this `null` — its registry and price lookups are still expected to
   * succeed, and a narrow-unsupported-reclassification rule (see
   * isKnownUnsupported below) must not accidentally swallow a real failure
   * for it.
   */
  knownUnsupportedReason: string | null;
}

export interface ParitySnapshot {
  symbol: string;
  referencePrice: DataPoint<number>;
  secondaryPrice: DataPoint<number>;
  /** Only computed when BOTH reference and secondary are `ok`. Otherwise `unavailable`. */
  premiumDiscountPct: DataPoint<number>;
  tradingHalt: DataPoint<boolean>;
  oraclePaused: DataPoint<boolean>;
  /** Overall traffic-light for UI purposes. Never "healthy" unless every input is `ok`. */
  supportStatus: "ok" | "degraded" | "unsupported";
  generatedAt: Date;
}

export interface HolderConcentration {
  symbol: string;
  tokenAddress: string;
  totalSupply: DataPoint<string>; // kept as a raw decimal string; never coerced to a JS number that could lose precision
  top10HolderSharePct: DataPoint<number>;
  source: string;
}
