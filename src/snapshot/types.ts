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

  // ---- P5-C0: raw execution/liquidity telemetry ----------------------
  // Additive only, OPTIONAL so historical records written before this
  // slice (which lack these fields entirely) remain valid TickerSnapshotRecord
  // values. Every NEW record written after this slice populates all six,
  // either with a real observation or an explicit `unavailable` status —
  // never silently omitted. These are RAW OBSERVATIONS ONLY: no slippage
  // estimate, execution score, or liquidity classification is computed
  // anywhere from them in this slice.
  //
  // IMPORTANT — a raw pool token balance is NOT the same thing as safely
  // executable liquidity. A Uniswap V3 pool's liquidity is distributed
  // across discrete price ticks, not spread evenly; poolLiquidity (the
  // pool's active liquidity AT THE CURRENT TICK) determines how much can
  // be traded near the current price before crossing into a range with
  // different (possibly zero) liquidity. poolToken0Balance/
  // poolToken1Balance are the pool contract's raw total reserves across
  // ALL ticks, which can substantially overstate what is safely tradeable
  // near the current price. Estimating actual slippage/executable depth
  // from these raw values is explicitly deferred to a later, separately
  // authorized slice.
  /** Preserved from the same slot0() read secondaryPrice already uses — zero additional RPC calls. */
  poolSqrtPriceX96?: SerializedDataPoint<string>; // bigint serialized as string, same convention as blockNumber
  /** Preserved from the same slot0() read — previously fetched and discarded. Zero additional RPC calls. */
  poolTick?: SerializedDataPoint<number>;
  /** The configured V3 fee tier in basis-point-hundredths (e.g. 3000 = 0.30%) — a known config constant, never a live read, so it has no failure mode and is not a DataPoint. `null` when no pool fee tier is configured for this ticker. */
  poolFeeTierBps?: number | null;
  /** Pool's active in-range liquidity via the standard liquidity() view function. One additional RPC call. */
  poolLiquidity?: SerializedDataPoint<string>; // bigint serialized as string
  /** token0.balanceOf(pool) — the pool's raw token0 reserve. One additional RPC call. See the AMM-mechanics note above before treating this as executable depth. */
  poolToken0Balance?: SerializedDataPoint<string>; // bigint serialized as string
  /** token1.balanceOf(pool) — the pool's raw token1 reserve. One additional RPC call. */
  poolToken1Balance?: SerializedDataPoint<string>; // bigint serialized as string

  // ---- P6-A0: pool token identity + decimals metadata ----------------
  // Closes a historical-interpretation gap: poolToken0Balance/
  // poolToken1Balance are raw smallest-unit integers with no persisted
  // record of WHICH token address they belong to or how many decimals to
  // apply — a future reader had no way to interpret them correctly in
  // isolation. These four fields are the AUTHORITATIVE, live-resolved
  // values for the pool actually used THIS run (from the same token0()/
  // token1() reads already made when resolving the pool's spot price —
  // never inferred from static config), so historical correctness does
  // not depend on assuming today's config always matched the past.
  // Zero additional RPC calls: both addresses and both decimals values
  // were already being fetched for the existing secondaryPrice
  // computation; this only persists them alongside the balances they
  // describe. poolToken0Decimals/poolToken1Decimals share the same
  // underlying read as secondaryPrice's own decimals lookup, so a failure
  // there affects both — see captureTickerSnapshot.ts section 4/7 for the
  // exact coupling.
  /** The pool's token0 address, live-resolved this run (not from config). Same underlying read as poolSqrtPriceX96/poolTick. */
  poolToken0Address?: SerializedDataPoint<string>;
  /** The pool's token1 address, live-resolved this run (not from config). Same underlying read as poolSqrtPriceX96/poolTick. */
  poolToken1Address?: SerializedDataPoint<string>;
  /** decimals() for poolToken0Address, read during this run's secondaryPrice computation. Needed to interpret poolToken0Balance's raw smallest-unit integer. */
  poolToken0Decimals?: SerializedDataPoint<number>;
  /** decimals() for poolToken1Address, read during this run's secondaryPrice computation. Needed to interpret poolToken1Balance's raw smallest-unit integer. */
  poolToken1Decimals?: SerializedDataPoint<number>;
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
