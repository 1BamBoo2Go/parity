import { toFunctionSelector } from "viem";
import { SELECTORS } from "../src/abi/selectors.js";

const pairs: [string, string][] = [
  ["latestRoundData()", SELECTORS.latestRoundData],
  ["decimals()", SELECTORS.decimals],
  ["uiMultiplier()", SELECTORS.uiMultiplier],
  ["oraclePaused()", SELECTORS.oraclePaused],
  ["newUIMultiplier()", SELECTORS.newUIMultiplier],
  ["effectiveAt()", SELECTORS.effectiveAt],
  ["getPool(address,address,uint24)", SELECTORS.getPool],
  ["slot0()", SELECTORS.slot0],
  ["token0()", SELECTORS.token0],
  ["token1()", SELECTORS.token1],
  ["totalSupply()", SELECTORS.totalSupply],
  ["balanceOf(address)", SELECTORS.balanceOf],
];

let allMatch = true;
for (const [sig, ours] of pairs) {
  const viemSelector = toFunctionSelector(sig);
  const match = viemSelector.toLowerCase() === ours.toLowerCase();
  if (!match) allMatch = false;
  console.log(`${match ? "MATCH" : "MISMATCH!!"}  ${sig.padEnd(38)} ours=${ours} viem=${viemSelector}`);
}

if (!allMatch) {
  console.error("\nSelector mismatch detected — do not trust src/abi/selectors.ts until resolved.");
  process.exit(1);
}
console.log("\nAll selectors independently agree between js-sha3 and viem.");
