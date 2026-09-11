import type { SerializedDataPoint } from "./serialize.js";

/** Every capture invocation shares one runId across all records it writes — makes retries/reruns attributable without requiring exact-timestamp deduplication downstream. */
export type RunId = string;

export interface RobinhoodPriceSnapshotValue {
  bid: string;
  ask: string;
  mid: number;
  isTradingHalt: boolean;
  generatedAt: string; // Robinhood's own ISO-8601 quote-generation timestamp
}

export interface ChainlinkReferenceSnapshotValue {
  normalizedPrice: number;
  decimals: number;
  updatedAt: string; // ISO-8601
}

export interface HolderConcentrationSnapshotValue {
  holderRows: number;
  top1Pct: number;
  top5Pct: number;
  top10Pct: number;
}

/** One ticker's full observation at one point in time. This is the main time-series record. */
export interface TickerSnapshotRecord {
  recordType: "ticker_snapshot";
  runId: RunId;
  capturedAt: string; // ISO-8601, when THIS ticker's capture completed
  ticker: string;
  canonicalTokenAddress: string | null;
  configuredPoolAddress: string | null; // from config, NOT independently re-verified every run — see evidence doc
  robinhoodAssetStatus: SerializedDataPoint<string>;
  robinhoodPrice: SerializedDataPoint<RobinhoodPriceSnapshotValue>;
  chainlinkReference: SerializedDataPoint<ChainlinkReferenceSnapshotValue>;
  oraclePaused: SerializedDataPoint<boolean>;
  secondaryPrice: SerializedDataPoint<number>; // normalized, USDG per 1 stock token
  premiumDiscountPct: SerializedDataPoint<number>;
  holderConcentration: SerializedDataPoint<HolderConcentrationSnapshotValue>;
}

/** One full run's raw registry response, archived verbatim (no analysis, no diffing — just data preserved for possible future use). */
export interface RegistrySnapshotRecord {
  recordType: "registry_snapshot";
  runId: RunId;
  capturedAt: string;
  assetCount: number;
  assets: unknown[]; // raw RobinhoodAsset[] from the live registry response, stored as-is
}

/** One full run's gas/base-fee context, sampled from the chain's latest block. */
export interface GasSnapshotRecord {
  recordType: "gas_snapshot";
  runId: RunId;
  capturedAt: string;
  network: "mainnet";
  blockNumber: string; // bigint serialized as a string — JSON has no bigint type
  blockTimestamp: string; // ISO-8601, converted from the block's unix-seconds timestamp
  baseFeePerGasWei: string | null; // null if the field was unavailable on this block/chain
}
