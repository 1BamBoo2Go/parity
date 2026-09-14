import type { PublicClient } from "viem";

const ERC20_ABI = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Read raw totalSupply() from any ERC-20 contract. Returns a BigInt — never coerced to a JS number. */
export async function readTotalSupply(client: PublicClient, tokenAddress: `0x${string}`): Promise<bigint> {
  const supply = await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "totalSupply",
  });
  return supply as bigint;
}

/**
 * Read decimals() from any ERC-20 contract. This is REQUIRED before treating
 * a Uniswap V3 pool's raw price ratio as a human-readable number — omitting
 * this step was the exact cause of the external P0 run's nonsense
 * premium/discount values (e.g. AAPL +970,533,841.6960%). Never assume 18.
 */
export async function readErc20Decimals(client: PublicClient, tokenAddress: `0x${string}`): Promise<number> {
  const decimals = await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "decimals",
  });
  return decimals as number;
}

/**
 * P5-C0: read balanceOf(owner) on any ERC-20 contract. Used to observe a
 * Uniswap V3 pool's raw token reserves (owner = the pool address). This is
 * a RAW OBSERVATION ONLY — see src/snapshot/types.ts's poolToken0Balance/
 * poolToken1Balance doc for why a raw balance must not be read as
 * "executable liquidity" without understanding V3's concentrated-liquidity
 * mechanics.
 */
export async function readErc20BalanceOf(client: PublicClient, tokenAddress: `0x${string}`, owner: `0x${string}`): Promise<bigint> {
  const balance = await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
  return balance as bigint;
}
