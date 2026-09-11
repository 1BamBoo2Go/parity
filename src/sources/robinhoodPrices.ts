import { ROBINHOOD_STOCK_TOKEN_API_BASE } from "../config/chain.js";
import { UpstreamFetchError, type FetchLike } from "./robinhoodRegistry.js";
import { fetchWithRateLimitRetry } from "./httpRetry.js";

/**
 * Client for Robinhood's official Stock Token price/market-state endpoint.
 * Source: docs.robinhood.com/chain/stock-token-apis
 *
 * Endpoint: GET https://api.robinhood.com/rhj/prices/{symbol}
 *
 * Field semantics, exactly as documented (do not embellish):
 *   - bid/ask: RAW underlying-equity bid/ask, NOT multiplier-adjusted.
 *   - isTradingHalt: true when the asset has an active trading halt.
 *   - generatedAt: server time the quote was generated (ISO-8601).
 * We do NOT infer any field this endpoint does not actually document
 * returning (e.g. there is no documented "staleness heartbeat" field here —
 * `generatedAt` age is the only freshness signal Robinhood publishes on this
 * endpoint, and callers should treat that as the whole story, not assume
 * more).
 *
 * LIVE VERIFICATION STATUS: same caveat as robinhoodRegistry.ts — not
 * executed live in this sandbox; see evidence/P0-EVIDENCE-REPORT.md.
 */

export interface RobinhoodPriceQuote {
  tokenSymbol: string;
  deployments: { contractAddress: string; chainId: number }[];
  bid: string;
  ask: string;
  currency: string;
  dailyTradingVolume: string;
  isTradingHalt: boolean;
  generatedAt: string; // ISO-8601
}

export interface RobinhoodPricesResponse {
  quotes: RobinhoodPriceQuote[];
}

export async function fetchRobinhoodPrice(
  symbol: string,
  fetchImpl: FetchLike = fetch,
): Promise<RobinhoodPriceQuote> {
  const url = `${ROBINHOOD_STOCK_TOKEN_API_BASE}/prices/${encodeURIComponent(symbol)}`;
  let res: Response;
  try {
    // The external live P0 run hit real HTTP 429s here for USO and SPCX.
    // Retry conservatively on 429 only; any other status (or network error)
    // surfaces immediately as a real failure, not a retry loop.
    res = await fetchWithRateLimitRetry(() => fetchImpl(url, { headers: { accept: "application/json" } }));
  } catch (err) {
    throw new UpstreamFetchError(`Network error calling Robinhood prices API for ${symbol}`, url, err);
  }
  if (res.status === 429) {
    throw new UpstreamFetchError(`Robinhood prices API rate-limited (429) for ${symbol} after retries`, url, undefined, 429);
  }
  if (!res.ok) {
    throw new UpstreamFetchError(`Robinhood prices API returned HTTP ${res.status} for ${symbol}`, url, undefined, res.status);
  }
  const body = (await res.json()) as RobinhoodPricesResponse;
  const quote = body?.quotes?.[0];
  if (!quote) {
    throw new UpstreamFetchError(`Robinhood prices API returned no quote for ${symbol}`, url);
  }
  return quote;
}
