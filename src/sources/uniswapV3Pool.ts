import type { PublicClient } from "viem";

/**
 * Uniswap V3 Factory + Pool reads on Robinhood Chain.
 *
 * Factory address source: developers.uniswap.org's own official Robinhood
 * Chain deployments page
 * (developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments),
 * cross-checked against the SwapRouter02 address independently published in
 * the live useWield/wield-contracts repo — both sources agree on
 * 0xcaf681a66d020601342297493863e78c959e5cb2 for the router, which is strong
 * corroboration that the whole deployments table (including the factory
 * address below) is genuine and not stale/wrong.
 */
export const UNISWAP_V3_FACTORY_MAINNET = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa" as const;

const FACTORY_ABI = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

const POOL_ABI = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "liquidity",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
  },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Resolve a Uniswap V3 pool address via the AUTHORITATIVE method
 * (factory.getPool), not by offline CREATE2 computation. We deliberately do
 * NOT implement a CREATE2 shortcut here: that would require assuming this
 * chain's factory uses the canonical Uniswap V3 init code hash, which has
 * not been independently confirmed, and the project's rules forbid
 * proceeding on an unverified assumption when an authoritative on-chain
 * call is available instead. Returns null if no pool exists for this pair
 * and fee tier — a null here means "no pool," not "error."
 */
export async function resolvePoolAddress(
  client: PublicClient,
  factoryAddress: `0x${string}`,
  tokenA: `0x${string}`,
  tokenB: `0x${string}`,
  feeTier: number,
): Promise<`0x${string}` | null> {
  const pool = (await client.readContract({
    address: factoryAddress,
    abi: FACTORY_ABI,
    functionName: "getPool",
    args: [tokenA, tokenB, feeTier],
  })) as `0x${string}`;

  if (pool.toLowerCase() === ZERO_ADDRESS) {
    return null;
  }
  return pool;
}

export interface PoolSpotPrice {
  poolAddress: `0x${string}`;
  sqrtPriceX96: bigint;
  /**
   * P5-C0: preserved from the SAME slot0() call above — zero additional
   * RPC calls. Previously fetched and silently discarded (only
   * sqrtPriceX96 was destructured out of the seven-element tuple).
   */
  tick: number;
  token0: `0x${string}`;
  token1: `0x${string}`;
  /**
   * ⚠️ RAW, UN-NORMALIZED ratio (token1 smallest-units per token0
   * smallest-unit) — provided for logging/debugging ONLY. This is exactly
   * the value whose direct use (without a decimals adjustment or
   * orientation check) produced the external P0 run's nonsense
   * premium/discount output (e.g. AAPL +970,533,841.6960%). Do NOT use this
   * field as a price. Use src/domain/poolPrice.ts's
   * computeStockTokenPriceInQuoteAsset(), fed with this pool's raw
   * `sqrtPriceX96` plus each token's real decimals(), instead.
   */
  rawPriceToken1PerToken0: number;
}

/**
 * Read the current spot price from a Uniswap V3 pool's slot0.
 *
 * This is a SPOT price from one pool at one instant — it is more easily
 * manipulated / thinner than a volume-weighted price across all of a
 * token's pools (the method an independent chain-data analysis we reviewed
 * uses for its own price series). Spot price is an acceptable, simple
 * starting point for a Buildathon v0 single-pool read; a production
 * decision to trust it for anything beyond display should not be made
 * without at least a TWAP or liquidity-depth check, which is explicitly out
 * of scope for this slice.
 */
export async function readPoolSpotPrice(
  client: PublicClient,
  poolAddress: `0x${string}`,
): Promise<PoolSpotPrice> {
  const [slot0, token0, token1] = await Promise.all([
    client.readContract({ address: poolAddress, abi: POOL_ABI, functionName: "slot0" }),
    client.readContract({ address: poolAddress, abi: POOL_ABI, functionName: "token0" }),
    client.readContract({ address: poolAddress, abi: POOL_ABI, functionName: "token1" }),
  ]);

  const [sqrtPriceX96, tick] = slot0 as readonly [bigint, number, number, number, number, number, boolean];

  // price = (sqrtPriceX96 / 2^96)^2, giving token1 per token0 in raw (un-decimals-adjusted) units.
  const Q96 = 2 ** 96;
  const sqrtPrice = Number(sqrtPriceX96) / Q96;
  const rawPriceToken1PerToken0 = sqrtPrice * sqrtPrice;

  return {
    poolAddress,
    sqrtPriceX96,
    tick,
    token0: token0 as `0x${string}`,
    token1: token1 as `0x${string}`,
    rawPriceToken1PerToken0,
  };
}

/**
 * P5-C0: read a V3 pool's current in-range active liquidity (the standard
 * `liquidity()` view function on every V3 pool). This is NOT the same as
 * total reserves — it is the liquidity currently active at the pool's
 * current tick, per Uniswap V3's concentrated-liquidity design. One
 * additional RPC call per resolved pool; no new external provider.
 */
export async function readPoolLiquidity(client: PublicClient, poolAddress: `0x${string}`): Promise<bigint> {
  const liquidity = await client.readContract({
    address: poolAddress,
    abi: POOL_ABI,
    functionName: "liquidity",
  });
  return liquidity as bigint;
}
