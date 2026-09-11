/**
 * computeSelectors.ts
 *
 * We do not trust memorized/recalled 4-byte function selectors for on-chain
 * calls. This script independently computes them via a real Keccak-256
 * implementation (js-sha3), per the project's "evidence before assumption"
 * rule applied to our own ABI encoding, not just to third-party data.
 *
 * Run: npx tsx scripts/computeSelectors.ts
 */
import { keccak256 } from "js-sha3";

function selector(signature: string): string {
  // keccak256 of the ABI function signature string, first 4 bytes, 0x-prefixed.
  const hashHex = keccak256(signature);
  return "0x" + hashHex.slice(0, 8);
}

const signatures = [
  // Chainlink AggregatorV3Interface (standard)
  "latestRoundData()",
  "decimals()",
  // Robinhood Stock Token contract (per Chainlink's own Robinhood tokenized-equity
  // feed docs, which name these functions explicitly: uiMultiplier(), oraclePaused(),
  // newUIMultiplier(), effectiveAt())
  "uiMultiplier()",
  "oraclePaused()",
  "newUIMultiplier()",
  "effectiveAt()",
  // Uniswap V3 factory / pool (standard)
  "getPool(address,address,uint24)",
  "slot0()",
  "token0()",
  "token1()",
  // Plain ERC-20 (standard)
  "decimals()",
  "totalSupply()",
  "balanceOf(address)",
];

console.log("signature -> 4-byte selector (independently computed via js-sha3 keccak256)");
console.log("-".repeat(80));
for (const sig of signatures) {
  console.log(`${sig.padEnd(40)} ${selector(sig)}`);
}
