import type { PublicClient } from "viem";
import type { TickerConfig, DataPoint } from "../domain/types.js";
import type { RobinhoodAssetsResponse } from "../sources/robinhoodRegistry.js";
import { findDeploymentOnChain } from "../sources/robinhoodRegistry.js";
import { fetchRobinhoodPrice, type RobinhoodPriceQuote } from "../sources/robinhoodPrices.js";
import { readChainlinkFeed, readStockTokenMultiplierState, type ChainlinkReading, type StockTokenMultiplierState } from "../sources/chainlinkFeed.js";
import { resolvePoolAddress, readPoolSpotPrice, readPoolLiquidity, UNISWAP_V3_FACTORY_MAINNET, type PoolSpotPrice } from "../sources/uniswapV3Pool.js";
import { readErc20Decimals, readTotalSupply, readErc20BalanceOf } from "../sources/erc20.js";
import { fetchTopHolders, computeConcentrationBands, type TokenHolder } from "../sources/blockscoutHolders.js";
import { computeStockTokenPriceInQuoteAsset } from "../domain/poolPrice.js";
import { buildParitySnapshot } from "../parity/buildParitySnapshot.js";
import { serializeDataPoint } from "./serialize.js";
import type { TickerSnapshotRecord, RobinhoodPriceSnapshotValue, ChainlinkReferenceSnapshotValue, HolderConcentrationSnapshotValue } from "./types.js";

const USDG_MAINNET = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const; // source: useWield/wield-contracts README, cross-confirmed multiple times — see PROVENANCE.md

/**
 * Every network call this module makes is injectable, so orchestration
 * logic (this file) can be unit-tested with fakes, independent of the
 * already-tested real implementations in src/sources/. Defaults are the
 * real, live implementations.
 */
export interface CaptureDeps {
  fetchPrice: (symbol: string) => Promise<RobinhoodPriceQuote>;
  readFeed: (client: PublicClient, feedAddress: `0x${string}`) => Promise<ChainlinkReading>;
  readMultiplierState: (client: PublicClient, tokenAddress: `0x${string}`) => Promise<StockTokenMultiplierState>;
  resolvePool: (
    client: PublicClient,
    factory: `0x${string}`,
    tokenA: `0x${string}`,
    tokenB: `0x${string}`,
    feeTier: number,
  ) => Promise<`0x${string}` | null>;
  readSpotPrice: (client: PublicClient, poolAddress: `0x${string}`) => Promise<PoolSpotPrice>;
  readDecimals: (client: PublicClient, tokenAddress: `0x${string}`) => Promise<number>;
  fetchHolders: (tokenAddress: string) => Promise<TokenHolder[]>;
  readSupply: (client: PublicClient, tokenAddress: `0x${string}`) => Promise<bigint>;
  /** P5-C0: pool's active in-range liquidity. */
  readLiquidity: (client: PublicClient, poolAddress: `0x${string}`) => Promise<bigint>;
  /** P5-C0: ERC20 balanceOf(owner), used to observe a pool's raw token reserves. */
  readBalanceOf: (client: PublicClient, tokenAddress: `0x${string}`, owner: `0x${string}`) => Promise<bigint>;
}

export const defaultCaptureDeps: CaptureDeps = {
  fetchPrice: fetchRobinhoodPrice,
  readFeed: readChainlinkFeed,
  readMultiplierState: readStockTokenMultiplierState,
  resolvePool: resolvePoolAddress,
  readSpotPrice: readPoolSpotPrice,
  readDecimals: readErc20Decimals,
  fetchHolders: fetchTopHolders,
  readSupply: readTotalSupply,
  readLiquidity: readPoolLiquidity,
  readBalanceOf: readErc20BalanceOf,
};

function unavailable<T>(reason: DataPoint<T> extends never ? never : string, detail: string, source: string): DataPoint<T> {
  return { status: "unavailable", reason: reason as never, detail, source } as DataPoint<T>;
}

/**
 * Capture one ticker's full snapshot. Every field is fetched and converted
 * to a DataPoint independently — a failure in one field (e.g. Blockscout
 * being down) cannot prevent any other field from being recorded. This
 * mirrors, and for the reference/secondary/premium-discount fields directly
 * reuses, buildParitySnapshot()'s already-tested composition logic rather
 * than re-implementing it.
 */
export async function captureTickerSnapshot(
  ticker: TickerConfig,
  registry: RobinhoodAssetsResponse | null,
  client: PublicClient,
  runId: string,
  deps: CaptureDeps = defaultCaptureDeps,
): Promise<TickerSnapshotRecord> {
  const now = new Date();

  // 1. Registry status — independent of everything else below.
  let robinhoodAssetStatus: DataPoint<string>;
  const asset = registry?.assets.find((a) => a.tokenSymbol === ticker.symbol);
  if (asset) {
    const deployment = findDeploymentOnChain(asset, 4663);
    robinhoodAssetStatus = {
      status: "ok",
      value: `${asset.status} (multiplier=${asset.currentMultiplier}, mainnetDeployment=${deployment?.contractAddress ?? "none"})`,
      asOf: now,
      source: "docs.robinhood.com/chain/stock-token-apis (/rhj/assets)",
    };
  } else {
    robinhoodAssetStatus = unavailable(
      "upstream_error",
      registry ? `${ticker.symbol} not found in live registry response` : "registry fetch failed for this run",
      "docs.robinhood.com/chain/stock-token-apis (/rhj/assets)",
    );
  }

  // 2. Robinhood price/state.
  let robinhoodPrice: DataPoint<RobinhoodPriceSnapshotValue>;
  try {
    const quote = await deps.fetchPrice(ticker.symbol);
    const mid = (Number(quote.bid) + Number(quote.ask)) / 2;
    robinhoodPrice = {
      status: "ok",
      value: { bid: quote.bid, ask: quote.ask, mid, isTradingHalt: quote.isTradingHalt, generatedAt: quote.generatedAt },
      asOf: now,
      source: "docs.robinhood.com/chain/stock-token-apis (/rhj/prices)",
    };
  } catch (err) {
    robinhoodPrice = unavailable("upstream_error", err instanceof Error ? err.message : String(err), "/rhj/prices");
  }

  // 3. Chainlink reference + oraclePaused.
  let chainlinkReference: DataPoint<ChainlinkReferenceSnapshotValue>;
  let oraclePaused: DataPoint<boolean>;
  let referenceForCalc: DataPoint<number> = unavailable("no_chainlink_feed", "no feed configured", "chainlink");
  if (!ticker.chainlinkFeedMainnet) {
    chainlinkReference = unavailable("no_chainlink_feed", "no feed configured for this ticker", "chainlink");
    oraclePaused = unavailable("no_chainlink_feed", "no feed configured for this ticker", "chainlink");
  } else {
    try {
      const reading = await deps.readFeed(client, ticker.chainlinkFeedMainnet as `0x${string}`);
      chainlinkReference = {
        status: "ok",
        value: { normalizedPrice: reading.normalizedPrice, decimals: reading.decimals, updatedAt: reading.updatedAt.toISOString() },
        asOf: now,
        source: "Chainlink AggregatorV3 (Robinhood Chain mainnet)",
      };
      referenceForCalc = { status: "ok", value: reading.normalizedPrice, asOf: reading.updatedAt, source: "chainlink" };
      try {
        const multState = await deps.readMultiplierState(client, ticker.tokenAddressMainnet as `0x${string}`);
        oraclePaused = { status: "ok", value: multState.oraclePaused, asOf: now, source: "Stock Token contract oraclePaused()" };
      } catch (err) {
        oraclePaused = unavailable("upstream_error", err instanceof Error ? err.message : String(err), "oraclePaused()");
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      chainlinkReference = unavailable("rpc_unreachable", detail, "chainlink");
      oraclePaused = unavailable("rpc_unreachable", detail, "chainlink");
      referenceForCalc = unavailable("rpc_unreachable", detail, "chainlink");
    }
  }

  // 4. Secondary price (pool resolution + decimals/orientation normalization).
  let secondaryForCalc: DataPoint<number> = unavailable("no_verified_pool", "no pool candidate configured", "uniswap_v3");
  // P5-C0: captured alongside secondaryForCalc purely so section 7 below can
  // REUSE this run's already-resolved pool address and already-fetched
  // slot0() data — zero additional RPC calls for reuse. Does not change
  // secondaryForCalc's own computation/control-flow at all.
  let resolvedPoolAddressForTelemetry: `0x${string}` | null = null;
  let spotForTelemetry: PoolSpotPrice | null = null;
  if (ticker.tokenAddressMainnet && ticker.poolFeeTier && ticker.quoteAsset === "USDG") {
    try {
      const poolAddress = await deps.resolvePool(
        client,
        UNISWAP_V3_FACTORY_MAINNET,
        ticker.tokenAddressMainnet as `0x${string}`,
        USDG_MAINNET,
        ticker.poolFeeTier,
      );
      if (!poolAddress) {
        secondaryForCalc = unavailable("no_verified_pool", `factory.getPool returned no pool for ${ticker.symbol}/USDG`, "uniswap_v3");
      } else {
        resolvedPoolAddressForTelemetry = poolAddress;
        const spot = await deps.readSpotPrice(client, poolAddress);
        spotForTelemetry = spot;
        const [decimals0, decimals1] = await Promise.all([
          deps.readDecimals(client, spot.token0),
          deps.readDecimals(client, spot.token1),
        ]);
        const normalizedPrice = computeStockTokenPriceInQuoteAsset({
          sqrtPriceX96: spot.sqrtPriceX96,
          token0: spot.token0,
          token1: spot.token1,
          decimals0,
          decimals1,
          expectedStockTokenAddress: ticker.tokenAddressMainnet,
          expectedQuoteAssetAddress: USDG_MAINNET,
        });
        secondaryForCalc = { status: "ok", value: normalizedPrice, asOf: now, source: `Uniswap V3 pool ${poolAddress}` };
      }
    } catch (err) {
      secondaryForCalc = unavailable("upstream_error", err instanceof Error ? err.message : String(err), "uniswap_v3");
    }
  }

  // 5. Compose reference/secondary/premium-discount/trading-halt via the
  // already-tested buildParitySnapshot — no reimplementation of that logic.
  const tradingHalt: DataPoint<boolean> =
    robinhoodPrice.status === "ok"
      ? { status: "ok", value: robinhoodPrice.value.isTradingHalt, asOf: now, source: "/rhj/prices" }
      : unavailable("upstream_error", "robinhood price unavailable, trading-halt state unknown", "/rhj/prices");

  const composed = buildParitySnapshot(ticker, {
    chainlinkReference: referenceForCalc,
    secondaryMarket: secondaryForCalc,
    tradingHalt,
    oraclePaused,
  }, now);

  // 6. Holder concentration — best-effort, never blocks anything above.
  let holderConcentration: DataPoint<HolderConcentrationSnapshotValue>;
  if (!ticker.tokenAddressMainnet) {
    holderConcentration = unavailable("upstream_error", "no token address configured", "blockscout");
  } else {
    try {
      const [holders, totalSupply] = await Promise.all([
        deps.fetchHolders(ticker.tokenAddressMainnet),
        deps.readSupply(client, ticker.tokenAddressMainnet as `0x${string}`),
      ]);
      const bands = computeConcentrationBands(holders, totalSupply);
      holderConcentration = {
        status: "ok",
        value: { holderRows: holders.length, ...bands },
        asOf: now,
        source: "Blockscout (robinhoodchain.blockscout.com)",
      };
    } catch (err) {
      // Per explicit instruction: a temporary Blockscout failure must not
      // invalidate the rest of this otherwise-valid market snapshot — it is
      // recorded as unavailable here, and every other field above is
      // entirely unaffected by this catch block.
      holderConcentration = unavailable("upstream_error", err instanceof Error ? err.message : String(err), "blockscout");
    }
  }

  // 7. P5-C0: raw execution/liquidity telemetry — ADDITIVE ONLY, and
  // deliberately isolated from everything above. Nothing in this section
  // can affect robinhoodAssetStatus, robinhoodPrice, chainlinkReference,
  // oraclePaused, secondaryPrice, premiumDiscountPct, or holderConcentration
  // — all of those are already fully computed by this point. The whole
  // section is wrapped in its own outer try/catch as a final defensive
  // layer, so even a genuinely unexpected error here cannot prevent this
  // function from returning a valid TickerSnapshotRecord.
  let poolSqrtPriceX96: DataPoint<string> = unavailable("no_verified_pool", "no pool resolved this run", "uniswap_v3");
  let poolTick: DataPoint<number> = unavailable("no_verified_pool", "no pool resolved this run", "uniswap_v3");
  let poolLiquidity: DataPoint<string> = unavailable("no_verified_pool", "no pool resolved this run", "uniswap_v3");
  let poolToken0Balance: DataPoint<string> = unavailable("no_verified_pool", "no pool resolved this run", "uniswap_v3");
  let poolToken1Balance: DataPoint<string> = unavailable("no_verified_pool", "no pool resolved this run", "uniswap_v3");
  const poolFeeTierBps: number | null = ticker.poolFeeTier ?? null;

  try {
    if (spotForTelemetry) {
      // Preserved from the slot0() read secondaryPrice already made above —
      // zero additional RPC calls, purely reading already-fetched values.
      poolSqrtPriceX96 = { status: "ok", value: spotForTelemetry.sqrtPriceX96.toString(), asOf: now, source: "uniswap_v3 slot0()" };
      poolTick = { status: "ok", value: spotForTelemetry.tick, asOf: now, source: "uniswap_v3 slot0()" };
    }

    if (resolvedPoolAddressForTelemetry) {
      const poolAddress = resolvedPoolAddressForTelemetry;

      try {
        const liquidity = await deps.readLiquidity(client, poolAddress);
        poolLiquidity = { status: "ok", value: liquidity.toString(), asOf: now, source: `Uniswap V3 pool ${poolAddress} liquidity()` };
      } catch (err) {
        poolLiquidity = unavailable("upstream_error", err instanceof Error ? err.message : String(err), "uniswap_v3");
      }

      if (spotForTelemetry) {
        try {
          const balance0 = await deps.readBalanceOf(client, spotForTelemetry.token0, poolAddress);
          poolToken0Balance = { status: "ok", value: balance0.toString(), asOf: now, source: `${spotForTelemetry.token0} balanceOf(${poolAddress})` };
        } catch (err) {
          poolToken0Balance = unavailable("upstream_error", err instanceof Error ? err.message : String(err), "uniswap_v3");
        }

        try {
          const balance1 = await deps.readBalanceOf(client, spotForTelemetry.token1, poolAddress);
          poolToken1Balance = { status: "ok", value: balance1.toString(), asOf: now, source: `${spotForTelemetry.token1} balanceOf(${poolAddress})` };
        } catch (err) {
          poolToken1Balance = unavailable("upstream_error", err instanceof Error ? err.message : String(err), "uniswap_v3");
        }
      } else {
        poolToken0Balance = unavailable("upstream_error", "pool resolved but spot-price token0/token1 unavailable this run", "uniswap_v3");
        poolToken1Balance = unavailable("upstream_error", "pool resolved but spot-price token0/token1 unavailable this run", "uniswap_v3");
      }
    }
  } catch (err) {
    // Genuinely unexpected failure inside the telemetry section itself —
    // recorded honestly, never allowed to propagate. Canonical price
    // fields above are entirely unaffected regardless.
    const detail = err instanceof Error ? err.message : String(err);
    poolLiquidity = unavailable("upstream_error", detail, "uniswap_v3");
    poolToken0Balance = unavailable("upstream_error", detail, "uniswap_v3");
    poolToken1Balance = unavailable("upstream_error", detail, "uniswap_v3");
  }

  return {
    recordType: "ticker_snapshot",
    runId,
    capturedAt: new Date().toISOString(),
    ticker: ticker.symbol,
    canonicalTokenAddress: ticker.tokenAddressMainnet,
    configuredPoolAddress: ticker.poolAddressMainnet,
    robinhoodAssetStatus: serializeDataPoint(robinhoodAssetStatus),
    robinhoodPrice: serializeDataPoint(robinhoodPrice),
    chainlinkReference: serializeDataPoint(chainlinkReference),
    oraclePaused: serializeDataPoint(oraclePaused),
    secondaryPrice: serializeDataPoint(composed.secondaryPrice),
    premiumDiscountPct: serializeDataPoint(composed.premiumDiscountPct),
    holderConcentration: serializeDataPoint(holderConcentration),
    poolSqrtPriceX96: serializeDataPoint(poolSqrtPriceX96),
    poolTick: serializeDataPoint(poolTick),
    poolFeeTierBps,
    poolLiquidity: serializeDataPoint(poolLiquidity),
    poolToken0Balance: serializeDataPoint(poolToken0Balance),
    poolToken1Balance: serializeDataPoint(poolToken1Balance),
  };
}
