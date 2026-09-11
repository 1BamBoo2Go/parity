import { createPublicClient, http, type PublicClient } from "viem";
import { resolveChain, type NetworkName } from "../config/chain.js";

/**
 * Create a read-only EVM client for Robinhood Chain, parameterized by
 * network so mainnet/testnet share one code path (per Buildathon
 * requirement: "Do NOT duplicate application logic between networks").
 *
 * We use viem rather than hand-rolled JSON-RPC + ABI encoding. Financial
 * data correctness depends on getting multi-value ABI decoding (e.g.
 * latestRoundData's five return values, slot0's seven) exactly right, and a
 * widely-used, independently-audited library is a more "boring, dependable"
 * choice here than bespoke hex slicing.
 *
 * LIVE VERIFICATION STATUS: creating this client does not itself make a
 * network call. The first real eth_call through it, in this sandbox,
 * against rpc.mainnet.chain.robinhood.com, will fail with the sandbox's
 * `host_not_allowed` policy — see evidence/P0-EVIDENCE-REPORT.md for the
 * captured error and what to do about it.
 */
export function createRobinhoodChainClient(network: NetworkName): PublicClient {
  const chain = resolveChain(network);
  return createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0]),
  }) as PublicClient;
}
