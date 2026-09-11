import type { DataPoint, ParitySnapshot, TickerConfig } from "../domain/types.js";
import { computePremiumDiscountPct, isStale, assertPlausiblePremiumDiscountPct } from "../domain/calc.js";

export interface ParityInputs {
  /** Chainlink-sourced reference price, already multiplier-adjusted, or an explicit unavailable reason. */
  chainlinkReference: DataPoint<number>;
  /** Secondary-market price from a verified pool, or an explicit unavailable reason. */
  secondaryMarket: DataPoint<number>;
  tradingHalt: DataPoint<boolean>;
  oraclePaused: DataPoint<boolean>;
}

const DEFAULT_MAX_REFERENCE_AGE_SECONDS = 172_800; // 48h — see calc.ts doc comment on where this number comes from

/**
 * Build a ParitySnapshot from already-fetched inputs. This function is pure
 * (no I/O) and therefore fully unit-testable without a network or an RPC —
 * see test/buildParitySnapshot.test.ts for the exhaustive case list this is
 * required to handle, including the "unsupported ticker" and
 * "missing/malformed upstream data" paths.
 *
 * Hard rule enforced here: premiumDiscountPct is `ok` ONLY when both
 * chainlinkReference and secondaryMarket are `ok`. There is no code path
 * that lets a missing side become a zero.
 */
export function buildParitySnapshot(
  ticker: TickerConfig,
  inputs: ParityInputs,
  now: Date = new Date(),
  maxReferenceAgeSeconds: number = DEFAULT_MAX_REFERENCE_AGE_SECONDS,
): ParitySnapshot {
  let reference = inputs.chainlinkReference;

  // Staleness is enforced HERE, centrally, regardless of what the source
  // claimed — a source reporting `ok` with an old `asOf` gets downgraded.
  if (reference.status === "ok" && isStale(reference.asOf, now, maxReferenceAgeSeconds)) {
    reference = {
      status: "unavailable",
      reason: "stale",
      detail: `Reference price asOf=${reference.asOf.toISOString()} exceeds max age ${maxReferenceAgeSeconds}s`,
      source: reference.source,
    };
  }

  const secondary = inputs.secondaryMarket;

  let premiumDiscountPct: DataPoint<number>;
  if (reference.status === "ok" && secondary.status === "ok") {
    try {
      const pct = computePremiumDiscountPct(secondary.value, reference.value);
      // Circuit breaker: a value this implausible is almost certainly a
      // decimals/orientation bug upstream, not a real market observation.
      // See the external-P0-run incident in evidence/P0-EVIDENCE-REPORT.md.
      assertPlausiblePremiumDiscountPct(pct);
      premiumDiscountPct = { status: "ok", value: pct, asOf: now, source: "computed" };
    } catch (err) {
      premiumDiscountPct = {
        status: "unavailable",
        reason: "implausible_result",
        detail: err instanceof Error ? err.message : String(err),
        source: "computed",
      };
    }
  } else {
    const reasons: string[] = [];
    if (reference.status !== "ok") reasons.push(`reference:${reference.reason}`);
    if (secondary.status !== "ok") reasons.push(`secondary:${secondary.reason}`);
    premiumDiscountPct = {
      status: "unavailable",
      reason: reference.status !== "ok" ? reference.reason : (secondary as Extract<typeof secondary, { status: "unavailable" }>).reason,
      detail: `Cannot compute premium/discount: ${reasons.join(", ")}`,
      source: "computed",
    };
  }

  const tradingHaltActive = inputs.tradingHalt.status === "ok" && inputs.tradingHalt.value === true;
  const oraclePausedActive = inputs.oraclePaused.status === "ok" && inputs.oraclePaused.value === true;

  let supportStatus: ParitySnapshot["supportStatus"];
  if (reference.status !== "ok" || secondary.status !== "ok") {
    supportStatus = "unsupported";
  } else if (tradingHaltActive || oraclePausedActive) {
    supportStatus = "degraded";
  } else {
    supportStatus = "ok";
  }

  return {
    symbol: ticker.symbol,
    referencePrice: reference,
    secondaryPrice: secondary,
    premiumDiscountPct,
    tradingHalt: inputs.tradingHalt,
    oraclePaused: inputs.oraclePaused,
    supportStatus,
    generatedAt: now,
  };
}

/** Convenience constructor for a ticker that fails verification entirely (e.g. no feed, no pool). Never silently omitted from output. */
export function unsupportedSnapshot(ticker: TickerConfig, reason: string, now: Date = new Date()): ParitySnapshot {
  const unavailable = (detail: string): DataPoint<never> => ({
    status: "unavailable",
    reason: "not_yet_verified",
    detail,
    source: "config",
  });
  return {
    symbol: ticker.symbol,
    referencePrice: unavailable(reason) as DataPoint<number>,
    secondaryPrice: unavailable(reason) as DataPoint<number>,
    premiumDiscountPct: unavailable(reason) as DataPoint<number>,
    tradingHalt: unavailable(reason) as DataPoint<boolean>,
    oraclePaused: unavailable(reason) as DataPoint<boolean>,
    supportStatus: "unsupported",
    generatedAt: now,
  };
}
