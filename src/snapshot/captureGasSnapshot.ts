import type { PublicClient } from "viem";
import type { GasSnapshotRecord } from "./types.js";

/**
 * Capture a cheap, periodic gas/base-fee context sample from the chain's
 * latest block. This is the "before" half of the Sept. 29 gas-subsidy
 * before/after dataset — sampled from the same RPC client already used for
 * every other read in this codebase, at no marginal integration cost.
 */
export async function captureGasSnapshot(client: PublicClient, runId: string): Promise<GasSnapshotRecord> {
  const block = await client.getBlock();
  return {
    recordType: "gas_snapshot",
    runId,
    capturedAt: new Date().toISOString(),
    network: "mainnet",
    blockNumber: block.number.toString(),
    blockTimestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
    baseFeePerGasWei:
      block.baseFeePerGas !== null && block.baseFeePerGas !== undefined ? block.baseFeePerGas.toString() : null,
  };
}
