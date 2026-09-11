import { defineChain } from "viem";

/**
 * Robinhood Chain network definitions.
 *
 * We are NOT assuming which network the Buildathon requires — the organizer
 * question is still open (see evidence/P0-EVIDENCE-REPORT.md, Section 3).
 * Application code is written once and parameterized by network, per the
 * instruction not to duplicate logic between mainnet and testnet.
 *
 * Sources:
 *   - Chain IDs, RPC URLs, explorer: docs.robinhood.com/chain (multiple pages,
 *     cross-checked against Chainstack's and QuickNode's independent docs).
 */
export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" },
  },
});

export type NetworkName = "mainnet" | "testnet";

export function resolveChain(network: NetworkName) {
  return network === "mainnet" ? robinhoodMainnet : robinhoodTestnet;
}

/** Robinhood's official read-only REST API base, per docs.robinhood.com/chain/stock-token-apis. */
export const ROBINHOOD_STOCK_TOKEN_API_BASE = "https://api.robinhood.com/rhj";

/** Robinhood Chain's official Blockscout explorer API base. */
export const BLOCKSCOUT_API_BASE_MAINNET = "https://robinhoodchain.blockscout.com/api";
