import type { TickerConfig } from "../domain/types.js";
import { CANDIDATE_TICKERS } from "../config/tickers.js";

/**
 * The tickers authorized for Slice P1.2 snapshot capture.
 *
 * REVISION (P1.2 correction): this list is now DERIVED from config
 * (`poolVerified === true`) rather than hardcoded, per instruction —
 * "prefer deriving the six supported snapshot tickers from the corrected
 * authoritative config instead of maintaining a separate hardcoded symbol
 * list, IF this can be done cleanly without weakening the invariant."
 *
 * This became possible only after backfilling AAPL/GOOGL/USO/SPCX's
 * already-externally-verified pool addresses (they passed live
 * verification in Slice P0 itself, but — unlike TSLA/NVDA's P1.1
 * correction — were never promoted to `poolVerified: true` in config until
 * now). Before that fix, deriving from `poolVerified` would have silently
 * returned only TSLA and NVDA, missing four of the six tickers this
 * project actually calls supported — which is exactly why the previous
 * revision of this file used a hardcoded list instead of trusting the
 * flag. Now that the flag is accurate for all six, deriving from it is the
 * more honest choice: a ticker is "supported for snapshot capture" if and
 * only if it has actually been promoted, full stop, with no second list to
 * fall out of sync with the first.
 *
 * THE INVARIANT THIS MUST NEVER VIOLATE (loud, not just tested): a
 * promoted (`poolVerified: true`) ticker can never have a null Chainlink
 * feed or a null pool address — `getSupportedSnapshotTickers()` asserts
 * this at call time and throws immediately if config ever regresses,
 * in addition to the dedicated tests in test/supportedTickers.test.ts and
 * test/buildParitySnapshot.test.ts.
 */
export function assertPromotedTickersHaveAddresses(tickers: TickerConfig[]): void {
  for (const t of tickers.filter((c) => c.poolVerified === true)) {
    if (!t.chainlinkFeedMainnet || !t.poolAddressMainnet) {
      throw new Error(
        `Config invariant violated: ${t.symbol} is marked poolVerified=true but has ` +
          `chainlinkFeedMainnet=${t.chainlinkFeedMainnet} and poolAddressMainnet=${t.poolAddressMainnet}. ` +
          `A promoted/supported ticker must never have a null verified feed or pool address.`,
      );
    }
  }
}

export function getSupportedSnapshotTickers(): TickerConfig[] {
  assertPromotedTickersHaveAddresses(CANDIDATE_TICKERS);
  return CANDIDATE_TICKERS.filter((t) => t.poolVerified === true);
}

/** Convenience symbol list, derived — never hand-maintained separately from the config it reflects. */
export function getSupportedSnapshotTickerSymbols(): string[] {
  return getSupportedSnapshotTickers().map((t) => t.symbol);
}
