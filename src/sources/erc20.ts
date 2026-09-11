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
