/**
 * 4-byte function selectors used for read-only eth_call requests.
 *
 * These are NOT trusted-from-memory constants. Every value here was
 * independently computed via a real Keccak-256 implementation in
 * scripts/computeSelectors.ts, and that script's actual output is recorded
 * verbatim in evidence/P0-EVIDENCE-REPORT.md. If you change a signature below,
 * re-run that script and update the evidence file — do not hand-edit a
 * selector without re-deriving it.
 */
export const SELECTORS = {
  // Chainlink AggregatorV3Interface (standard)
  latestRoundData: "0xfeaf968c",
  decimals: "0x313ce567",

  // Robinhood Stock Token contract. Function names are taken from Chainlink's
  // own "Robinhood Tokenized Equities" documentation
  // (docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood), which names
  // uiMultiplier(), oraclePaused(), newUIMultiplier(), and effectiveAt()
  // explicitly as the integration points issuers use to manage corporate
  // actions. Selectors below are independently derived, not copied from a
  // third party.
  uiMultiplier: "0xa60bf13d",
  oraclePaused: "0x7706ba52",
  newUIMultiplier: "0xdc767007",
  effectiveAt: "0x97a4064f",

  // Uniswap V3 factory / pool (standard)
  getPool: "0x1698ee82", // getPool(address,address,uint24)
  slot0: "0x3850c7bd",
  token0: "0x0dfe1681",
  token1: "0xd21220a7",

  // Plain ERC-20 (standard)
  totalSupply: "0x18160ddd",
  balanceOf: "0x70a08231", // balanceOf(address) — needs a padded address argument appended
} as const;
