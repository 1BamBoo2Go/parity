import type { TickerSnapshotRecord } from "../../src/snapshot/types.js";

export interface FixtureOptions {
  capturedAt: string; // ISO
  premiumDiscountPct?: number; // if provided, produces a fully healthy_current record with this pct
  referenceUpdatedAt?: string; // ISO — defaults to capturedAt (fresh) if not provided
  chainlinkStale?: boolean; // if true, chainlinkReference.status = unavailable/stale (P2-invalid)
  oraclePaused?: boolean; // if true, oraclePaused.value = true (P2-invalid via classifyOverallStatus)
  tradingHalt?: boolean; // if true, robinhoodPrice.value.isTradingHalt = true (P2-invalid)
  secondaryUnavailable?: boolean;
}

/**
 * Build a synthetic TickerSnapshotRecord for deterministic P3 tests. By
 * default (just `capturedAt` + `premiumDiscountPct`), produces a fully
 * "healthy_current" (P2) AND fresh-enough (P3) record. Flags let tests
 * construct specific P2-invalid or P3-stale-only scenarios without
 * repeating the full record shape everywhere.
 */
export function fixtureRecord(opts: FixtureOptions): TickerSnapshotRecord {
  const { capturedAt, premiumDiscountPct = 0, referenceUpdatedAt, chainlinkStale = false, oraclePaused = false, tradingHalt = false, secondaryUnavailable = false } = opts;

  const effectiveUpdatedAt = referenceUpdatedAt ?? capturedAt;

  return {
    recordType: "ticker_snapshot",
    runId: "fixture-run",
    capturedAt,
    ticker: "AAPL",
    canonicalTokenAddress: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9",
    configuredPoolAddress: "0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed",
    robinhoodAssetStatus: { status: "ok", value: "ACTIVE", asOf: capturedAt, source: "fixture" },
    robinhoodPrice: {
      status: "ok",
      value: { bid: "213.40", ask: "213.50", mid: 213.45, isTradingHalt: tradingHalt, generatedAt: capturedAt },
      asOf: capturedAt,
      source: "fixture",
    },
    chainlinkReference: chainlinkStale
      ? { status: "unavailable", reason: "stale", detail: "fixture: stale", source: "fixture" }
      : { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: effectiveUpdatedAt }, asOf: capturedAt, source: "fixture" },
    oraclePaused: { status: "ok", value: oraclePaused, asOf: capturedAt, source: "fixture" },
    secondaryPrice: secondaryUnavailable
      ? { status: "unavailable", reason: "upstream_error", detail: "fixture: pool failure", source: "fixture" }
      : { status: "ok", value: 214.0, asOf: capturedAt, source: "fixture" },
    premiumDiscountPct:
      chainlinkStale || secondaryUnavailable
        ? { status: "unavailable", reason: "upstream_error", detail: "fixture: cannot compute", source: "fixture" }
        : { status: "ok", value: premiumDiscountPct, asOf: capturedAt, source: "fixture" },
    holderConcentration: { status: "ok", value: { holderRows: 10, top1Pct: 40, top5Pct: 68, top10Pct: 79 }, asOf: capturedAt, source: "fixture" },
  };
}

/** Generate a series of records at a fixed cadence (minutes) starting at `startIso`, with a value per point from `pcts`. */
export function fixtureSeries(startIso: string, cadenceMinutes: number, pcts: number[]): TickerSnapshotRecord[] {
  const start = new Date(startIso).getTime();
  return pcts.map((pct, i) => fixtureRecord({ capturedAt: new Date(start + i * cadenceMinutes * 60000).toISOString(), premiumDiscountPct: pct }));
}
