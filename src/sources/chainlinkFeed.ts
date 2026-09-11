import type { PublicClient } from "viem";
import { normalizeOnchainAnswer } from "../domain/calc.js";

/**
 * Minimal ABIs — only the functions we actually call, per the "do not
 * over-architect" instruction. Selectors for these signatures were
 * independently verified in scripts/computeSelectors.ts; viem derives its
 * own selectors from these same signatures internally, so if our
 * independently-computed selector and viem's ever disagreed for the same
 * signature, that would itself be a bug worth stopping for. (They agree —
 * see evidence/P0-EVIDENCE-REPORT.md.)
 */
const AGGREGATOR_V3_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

/**
 * Function names (uiMultiplier, oraclePaused) are taken verbatim from
 * Chainlink's own "Robinhood Tokenized Equities" docs
 * (docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood), which name
 * these as the issuer's integration points for corporate-action handling.
 */
const ROBINHOOD_STOCK_TOKEN_ABI = [
  {
    type: "function",
    name: "uiMultiplier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "oraclePaused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export interface ChainlinkReading {
  rawAnswer: bigint;
  decimals: number;
  /** Multiplier-adjusted Total Return Value, per Chainlink's documented Robinhood feed semantics. Do NOT re-apply uiMultiplier to this. */
  normalizedPrice: number;
  updatedAt: Date;
  roundId: bigint;
}

/**
 * Read a Robinhood tokenized-equity Chainlink feed. Returns the
 * ALREADY-multiplier-adjusted Total Return Value — per Chainlink's own
 * documentation, this feed type folds the Robinhood token's uiMultiplier()
 * into the published answer. Callers must not multiply again.
 */
export async function readChainlinkFeed(
  client: PublicClient,
  feedAddress: `0x${string}`,
): Promise<ChainlinkReading> {
  const [roundData, decimals] = await Promise.all([
    client.readContract({
      address: feedAddress,
      abi: AGGREGATOR_V3_ABI,
      functionName: "latestRoundData",
    }),
    client.readContract({
      address: feedAddress,
      abi: AGGREGATOR_V3_ABI,
      functionName: "decimals",
    }),
  ]);

  const [roundId, answer, , updatedAt] = roundData as readonly [bigint, bigint, bigint, bigint, bigint];

  if (answer <= 0n) {
    throw new Error(`Chainlink feed ${feedAddress} returned non-positive answer=${answer}`);
  }
  if (updatedAt === 0n) {
    throw new Error(`Chainlink feed ${feedAddress} reports round not complete (updatedAt=0)`);
  }

  return {
    rawAnswer: answer,
    decimals,
    normalizedPrice: normalizeOnchainAnswer(answer, decimals),
    updatedAt: new Date(Number(updatedAt) * 1000),
    roundId,
  };
}

export interface StockTokenMultiplierState {
  uiMultiplier: bigint; // 1e18-scaled, per docs.robinhood.com/chain/oracles-and-price-feeds
  oraclePaused: boolean;
}

export async function readStockTokenMultiplierState(
  client: PublicClient,
  tokenAddress: `0x${string}`,
): Promise<StockTokenMultiplierState> {
  const [uiMultiplier, oraclePaused] = await Promise.all([
    client.readContract({
      address: tokenAddress,
      abi: ROBINHOOD_STOCK_TOKEN_ABI,
      functionName: "uiMultiplier",
    }),
    client.readContract({
      address: tokenAddress,
      abi: ROBINHOOD_STOCK_TOKEN_ABI,
      functionName: "oraclePaused",
    }),
  ]);
  return { uiMultiplier: uiMultiplier as bigint, oraclePaused: oraclePaused as boolean };
}
