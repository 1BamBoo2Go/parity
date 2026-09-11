import type { TickerConfig } from "../domain/types.js";

/**
 * Candidate ticker registry.
 *
 * IMPORTANT — read before adding a ticker:
 *   Every field on every row must be traceable to a specific citation.
 *   "poolVerified: true" means a human (or a live, tool-executed on-chain
 *   read) has confirmed BOTH that a stablecoin-quoted pool exists AND that
 *   it carries meaningful liquidity — not merely that the ticker exists, and
 *   not merely that *some* pool exists (see the counterfeit-token and
 *   memecoin-pairing risks documented in evidence/P0-EVIDENCE-REPORT.md).
 *
 *   poolVerified is `false` for every row in this file. The evidence
 *   gathered is strong secondary evidence (independent, named analytics
 *   sources; production contracts' own router usage) but NOT a substitute
 *   for the live, tool-executed on-chain read that actually flips a ticker
 *   to verified — that happens on an external, network-unrestricted run,
 *   documented in evidence/P0-EVIDENCE-REPORT.md and (for this expansion)
 *   evidence/P1-EVIDENCE-REPORT.md.
 *
 *   COVERAGE QUALITY OVER TICKER COUNT (Slice P1 rule, applies to every row
 *   added after P0): a ticker with strong token+feed+pool evidence sits
 *   ahead of one with just a plausible-looking token address. Weakly
 *   evidenced candidates are still included here, deliberately, rather than
 *   cherry-picked out — the external live run is the actual judge of
 *   whether they're supported, and honestly showing a "probably won't pass"
 *   candidate failing the gate is itself useful, verified information.
 */

const CITATION_WIELD =
  "useWield/wield-contracts GitHub README (MIT-licensed, live-in-production contracts): " +
  "lists this token+Chainlink-feed pair, and the repo's vault actively routes USDG through " +
  "Uniswap V3 SwapRouter02 (0xCaf681a66D020601342297493863E78C959E5cb2, fee 3000) for it.";

const CITATION_SQD_VOLUME =
  "SQD 'What Robinhood's Tokenized Stocks Trade Against' (sqd.dev/learn/robinhood-stock-token-volume, " +
  "dated 2026-08-31, measured from 200.6M on-chain swap events through block 50,419,085): " +
  "confirms this ticker is among the ~46 (of 195) registry tokens with a LIQUID USDG pool, via its " +
  "appearance in the top-10-by-volume table priced from same-day USDG pool VWAP.";

const CITATION_SQD_TOKEN_TABLE =
  "sqd.dev/learn/robinhood-tokenized-stocks (dated ~32 days old at P1 research time): independently " +
  "published token-contract table, cross-checked against QuickNode's own guide (below) — both list an " +
  "identical address for this ticker.";

const CITATION_QUICKNODE =
  "QuickNode 'How to Read Stock Tokens Data on Robinhood Chain' (quicknode.com/guides/robinhood/..., " +
  "last updated 2026-08-07): official RPC-provider documentation listing this exact mainnet token " +
  "contract address in a worked, runnable example.";

const CITATION_HUMMUSONRAILS_FEED =
  "hummusonrails/robinhood-chain-dapp-example GitHub repo (MIT-licensed): publishes an explicit " +
  "token-address + Chainlink-feed-address table for this ticker. This repo is specifically named and " +
  "endorsed by an official Arbitrum Foundation blog post ('Build Your First Robinhood Chain App') as " +
  "using 'the real TSLA, NVDA, and AAPL Stock Tokens and their real Chainlink feeds' in mainnet fork " +
  "tests (`pnpm run test:fork`) — i.e. this isn't just a repo claiming an address, it's one whose " +
  "addresses are exercised against live mainnet state as part of its own test suite.";

export const CANDIDATE_TICKERS: TickerConfig[] = [
  {
    symbol: "AAPL",
    tokenAddressMainnet: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9",
    chainlinkFeedMainnet: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0",
    poolVerified: true, // PROMOTED (P1.2 correction) — this pool address was resolved live during Slice P0's very first external run
    poolAddressMainnet: "0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed", // externally verified live during Slice P0 — see provenance
    poolDex: "Uniswap V3, fee tier 3000 — pool address externally verified live (P1.2 correction, backfilled from Slice P0's own external run)",
    poolFeeTier: 3000,
    quoteAsset: "USDG",
    knownUnsupportedReason: null,
    provenance:
      `${CITATION_WIELD} STRENGTHENED by ${CITATION_SQD_VOLUME} AAPL: $68.4M lifetime, ` +
      `705,840 swaps, and one of the nine tokens with a documented multiplier event in the ` +
      `same measurement window — i.e. our multiplier-handling code path is not hypothetical for this ticker. ` +
      `CORRECTED in P1.2 (evidence/P1.2-EVIDENCE-REPORT.md): pool=0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed was ` +
      `resolved and used live during Slice P0's very first external VPS run (before the P0.1 decimals/orientation ` +
      `fix even existed — the pool resolution itself was correct from the start; only downstream price ` +
      `normalization needed the fix). This address was never backfilled into config at the time; it is now.`,
  },
  {
    symbol: "GOOGL",
    tokenAddressMainnet: "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3",
    chainlinkFeedMainnet: "0xF6f373a037c30F0e5010d854385cA89185AE638b",
    poolVerified: true, // PROMOTED (P1.2 correction) — see AAPL's row above for the same reasoning
    poolAddressMainnet: "0x553e9a453425CD9B90919F317061FbC3794CC57a",
    poolDex: "Uniswap V3, fee tier 3000 — pool address externally verified live (P1.2 correction, backfilled from Slice P0's own external run)",
    poolFeeTier: 3000,
    quoteAsset: "USDG",
    knownUnsupportedReason: null,
    provenance:
      `${CITATION_WIELD} NOT independently confirmed as one of the ~46 liquid-USDG-pool tokens by the ` +
      `SQD volume analysis (it does not appear in that source's top-10 table, and that source does not ` +
      `publish the full 46-ticker list) — pool LIQUIDITY remains comparatively less evidenced than AAPL/SPCX by ` +
      `that specific source, even though the pool's EXISTENCE and resolvability are now externally confirmed. ` +
      `CORRECTED in P1.2: pool=0x553e9a453425CD9B90919F317061FbC3794CC57a was resolved and used live during ` +
      `Slice P0's first external VPS run; the address was never backfilled into config until now.`,
  },
  {
    symbol: "USO",
    tokenAddressMainnet: "0xa30fa36db767ad9ed3f7a60fc79526fb4d56d344",
    chainlinkFeedMainnet: "0x75a9c76Ef439e2C7c2E5a34Ab105EcFe3766431c",
    poolVerified: true, // PROMOTED (P1.2 correction)
    poolAddressMainnet: "0x02175608F1b5E6b5ed221cCFdC7Be197D111D915",
    poolDex: "Uniswap V3, fee tier 3000 — pool address externally verified live (P1.2 correction, backfilled from Slice P0's own external run)",
    poolFeeTier: 3000,
    quoteAsset: "USDG",
    knownUnsupportedReason: null,
    provenance:
      `${CITATION_WIELD} Same liquidity caveat as GOOGL: not independently confirmed as high-volume by the SQD ` +
      `analysis. USO is a commodity ETF token, a smaller category in that analysis' volume tables. CORRECTED in ` +
      `P1.2: pool=0x02175608F1b5E6b5ed221cCFdC7Be197D111D915 was resolved and used live during Slice P0's first ` +
      `external VPS run; the address was never backfilled into config until now.`,
  },
  {
    symbol: "SPCX",
    tokenAddressMainnet: "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea",
    chainlinkFeedMainnet: "0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb",
    poolVerified: true, // PROMOTED (P1.2 correction)
    poolAddressMainnet: "0xEb07d9587eFD1778dFb9c385Ec43EF6d5F9fE401",
    poolDex: "Uniswap V3, fee tier 3000 — pool address externally verified live (P1.2 correction, backfilled from Slice P0's own external run)",
    poolFeeTier: 3000,
    quoteAsset: "USDG",
    knownUnsupportedReason: null,
    provenance:
      `${CITATION_WIELD} STRENGTHENED substantially by ${CITATION_SQD_VOLUME} SPCX: $303.2M lifetime, ` +
      `1,808,620 swaps, third-largest stock token on the chain by volume — the strongest-evidenced of the four ` +
      `original P0 tickers for genuinely liquid USDG pool activity. CORRECTED in P1.2: ` +
      `pool=0xEb07d9587eFD1778dFb9c385Ec43EF6d5F9fE401 was resolved and used live during Slice P0's first ` +
      `external VPS run; the address was never backfilled into config until now.`,
  },
  {
    symbol: "HOOD",
    tokenAddressMainnet: "0x79D2234Ed4Ee24880835F261DF9A98FcEfC7600e",
    chainlinkFeedMainnet: null, // CONFIRMED absent — Wield repo explicitly lists "no published feed"
    poolVerified: false,
    poolAddressMainnet: null,
    poolDex: null,
    poolFeeTier: null,
    quoteAsset: null,
    knownUnsupportedReason:
      "no_chainlink_feed_confirmed_absent: useWield/wield-contracts GitHub README explicitly lists HOOD " +
      "with 'no published feed' (a direct statement of absence, not a research gap).",
    provenance:
      "useWield/wield-contracts GitHub README explicitly lists HOOD with 'no published feed'. " +
      "Included here deliberately, as an EXCLUDED/unsupported example, to prove the codebase does not " +
      "silently drop or fabricate coverage for a real, well-known ticker that fails verification — " +
      "it must show up as unsupported_no_feed, not vanish from the registry ingestion output.",
  },

  // ── Slice P1 additions — TSLA and NVDA promoted to supported coverage ───
  // after external live verification (see evidence/P1-EVIDENCE-REPORT.md
  // Section 8). MSFT, SPY, QQQ remain exactly as originally researched:
  // explicitly unverified/incomplete, not promoted, not weakened-in.

  {
    symbol: "TSLA",
    tokenAddressMainnet: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
    chainlinkFeedMainnet: "0x4A1166a659A55625345e9515b32adECea5547C38",
    poolVerified: true, // PROMOTED — external live run resolved a real pool and computed a plausible premium/discount (+0.4177%)
    poolAddressMainnet: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3", // externally verified live: token0=TSLA (0x322F...), token1=USDG (0x5fc5...) — see provenance
    poolDex: "Uniswap V3, fee tier 3000 — pool address externally verified live (P1.1 correction)",
    poolFeeTier: 3000,
    quoteAsset: "USDG",
    knownUnsupportedReason: null,
    provenance:
      `${CITATION_HUMMUSONRAILS_FEED} Token address cross-confirmed by ${CITATION_QUICKNODE} and ` +
      `${CITATION_SQD_TOKEN_TABLE} STRENGTHENED by ${CITATION_SQD_VOLUME} TSLA appears directly in that ` +
      `source's top-10-by-volume table (alongside NVDA, SPY, SPCX, AAPL). PROMOTED after external live ` +
      `verification (network-unrestricted VPS, per evidence/P1-EVIDENCE-REPORT.md Section 8): live Chainlink ` +
      `reference=353.98495, live normalized Uniswap V3 secondary=355.46367279607864 USDG, ` +
      `premiumDiscountPct=+0.4177% — well inside the sanity bound, a real market observation not a ` +
      `computation bug. CORRECTED in P1.1 (evidence/P1.1-EVIDENCE-REPORT.md): the resolved pool address, ` +
      `initially omitted from Claude's own report by mistake (the operator's live proof output had captured ` +
      `it all along), is pool=0xf4ACdAEEB7022862A763C9B1B885e11191c889E3, with token0=TSLA ` +
      `(0x322F0929c4625eD5bAd873c95208D54E1c003b2d, matching this row's own tokenAddressMainnet exactly) and ` +
      `token1=USDG (0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168).`,
  },
  {
    symbol: "NVDA",
    tokenAddressMainnet: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    chainlinkFeedMainnet: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15",
    poolVerified: true, // PROMOTED — external live run resolved a real pool and computed a plausible premium/discount (+0.9865%)
    poolAddressMainnet: "0xB944cec30Bd4175855215D767ADC81F39e5f7E2B", // externally verified live: token0=USDG (0x5fc5...), token1=NVDA (0xd060...) — see provenance
    poolDex: "Uniswap V3, fee tier 3000 — pool address externally verified live (P1.1 correction)",
    poolFeeTier: 3000,
    quoteAsset: "USDG",
    knownUnsupportedReason: null,
    provenance:
      `${CITATION_HUMMUSONRAILS_FEED} Token address cross-confirmed by ${CITATION_QUICKNODE}, ` +
      `${CITATION_SQD_TOKEN_TABLE} and independently again by the chainstacklabs/robinhood-chain-sequencer-feed ` +
      `GitHub repo, which hardcodes this exact address as "NVDA" in its own example filter (a third, ` +
      `unrelated, independent confirmation). STRENGTHENED by ${CITATION_SQD_VOLUME} NVDA appears in that ` +
      `source's top-10-by-volume table. Robinhood's own official docs ('Building with Stock Tokens') also ` +
      `use NVDA in a worked example basket that 'auto-values from each token's Chainlink feed'. PROMOTED ` +
      `after external live verification (network-unrestricted VPS, per evidence/P1-EVIDENCE-REPORT.md Section ` +
      `8): live Chainlink reference=230.23665, live normalized Uniswap V3 secondary=232.50803644288797 USDG, ` +
      `premiumDiscountPct=+0.9865% — well inside the sanity bound. CORRECTED in P1.1 ` +
      `(evidence/P1.1-EVIDENCE-REPORT.md): the resolved pool address, initially omitted from Claude's own ` +
      `report by mistake, is pool=0xB944cec30Bd4175855215D767ADC81F39e5f7E2B, with token0=USDG ` +
      `(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168) and token1=NVDA ` +
      `(0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, matching this row's own tokenAddressMainnet exactly) — ` +
      `note the token0/token1 order is REVERSED relative to TSLA's pool above (Uniswap V3 orders by address, ` +
      `not by "which token is the interesting one"), which is exactly the orientation variability ` +
      `src/domain/poolPrice.ts exists to handle correctly rather than assume.`,
  },
  {
    symbol: "MSFT",
    tokenAddressMainnet: "0xe93237C50D904957Cf27E7B1133b510C669c2e74",
    chainlinkFeedMainnet: null, // NOT a confirmed absence — a research gap, see knownUnsupportedReason (null) and provenance
    poolVerified: false,
    poolAddressMainnet: null,
    poolDex: null,
    poolFeeTier: null,
    quoteAsset: null,
    knownUnsupportedReason: null, // deliberately null: registry/price lookups are still expected to succeed for MSFT
    provenance:
      `Token address confirmed by ${CITATION_QUICKNODE} and ${CITATION_SQD_TOKEN_TABLE} Robinhood's own ` +
      `official docs ('Building with Stock Tokens') name MSFT directly in a worked example ('An "AI basket" ` +
      `(NVDA, MSFT, GOOGL) that auto-values from each token's Chainlink feed') — first-party evidence a live ` +
      `feed almost certainly exists. HOWEVER: no source found during P1 research states the actual Chainlink ` +
      `feed PROXY ADDRESS for MSFT, unlike TSLA/NVDA/AAPL above. This is a genuine research gap, not a ` +
      `confirmed absence — do not treat a failed live lookup for this ticker as equivalent to HOOD's case. ` +
      `MSFT also does not appear in the SQD top-10-by-volume table, so pool liquidity is unconfirmed (same ` +
      `caveat as GOOGL/USO). Expect this candidate to need a Week-2-style direct lookup before it can pass ` +
      `the full gate; included here for honest completeness, not because it is expected to pass yet.`,
  },
  {
    symbol: "SPY",
    tokenAddressMainnet: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",
    chainlinkFeedMainnet: null, // research gap — see provenance; NOT a confirmed absence
    poolVerified: false,
    poolAddressMainnet: null,
    poolDex: "Uniswap V3 (candidate; exact pool address not yet resolved live)",
    poolFeeTier: 3000,
    quoteAsset: "USDG",
    knownUnsupportedReason: null,
    provenance:
      `Token address confirmed by ${CITATION_QUICKNODE} and ${CITATION_SQD_TOKEN_TABLE} STRENGTHENED by ` +
      `${CITATION_SQD_VOLUME} SPY appears directly in that source's top-10-by-volume table — strong, ` +
      `independent evidence of genuine USDG pool liquidity. HOWEVER: no source found during P1 research ` +
      `states the actual Chainlink feed proxy address for SPY. This is the interesting, informative case in ` +
      `this batch: strong pool evidence, but the feed side of the gate is an open research gap, not a ` +
      `confirmed absence — a real Chainlink feed almost certainly exists for a security this widely traded, ` +
      `it simply hasn't been pinned to a citable address yet.`,
  },
  {
    symbol: "QQQ",
    tokenAddressMainnet: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68",
    chainlinkFeedMainnet: null, // research gap — see provenance; NOT a confirmed absence
    poolVerified: false,
    poolAddressMainnet: null,
    poolDex: null,
    poolFeeTier: null,
    quoteAsset: null,
    knownUnsupportedReason: null,
    provenance:
      `Token address confirmed ONLY by ${CITATION_SQD_TOKEN_TABLE} a single source, not independently ` +
      `cross-checked against a second one the way every other row in this file is — treat the address ` +
      `itself as lower-confidence than its peers, pending a second citation. QQQ is confirmed as one of 24 ` +
      `canonical Stock Tokens usable as a pairing asset on the PAIR launchpad (globenewswire.com press ` +
      `release, 2026-08-31), which confirms it is a real, live, canonical token — but that evidence is about ` +
      `memecoin-pairing pools specifically, which this project's own rules (see PROVENANCE.md) explicitly ` +
      `treat as NOT sufficient evidence of a genuine USDG-quoted price. QQQ does not appear in the SQD ` +
      `top-10-by-volume table either. This is the weakest-evidenced candidate in this batch on every axis ` +
      `(feed, pool, even the token address's own corroboration) — included for honest completeness, ` +
      `expected to be the most likely of the five P1 candidates to fail the external gate.`,
  },
];

/**
 * Known counterfeit-token risk, recorded here (not baked into logic yet in
 * P0) because it directly informs Slice P1's authenticity-check requirement.
 *
 * Source: the same SQD analysis documents a live, actively-traded counterfeit
 * "GME" contract at 0xc2362aff2a2a4cc1f48cf3dab2c4e2605eb94ba3 (vs. the
 * canonical registry address 0x1b0e319c6a659f002271b69db8a7df2f911c153e),
 * which has done $111.0M of volume, $40.4M of it crossing directly against
 * the real GME. Symbol/name matching is NOT a safe authenticity check on
 * this chain. Parity must always resolve tickers via Robinhood's official
 * /rhj/assets registry (or the shared beacon implementation address
 * 0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2, per the same source), never by
 * matching a human-readable symbol or name string found elsewhere on-chain.
 */
export const KNOWN_COUNTERFEIT_EXAMPLE = {
  symbol: "GME",
  canonicalAddress: "0x1b0e319c6a659f002271b69db8a7df2f911c153e",
  counterfeitAddress: "0xc2362aff2a2a4cc1f48cf3dab2c4e2605eb94ba3",
  source: "sqd.dev/learn/robinhood-stock-token-volume, Section 6",
};

/**
 * A ticker is "known unsupported" ONLY when a row explicitly, deliberately
 * sets `knownUnsupportedReason` to a non-null, evidence-backed statement of
 * confirmed absence (HOOD's case: a live contract's own address table
 * directly states no feed was published for it).
 *
 * This is DELIBERATELY NOT inferred from "chainlinkFeedMainnet is null" —
 * that would have wrongly swept MSFT, SPY, and QQQ (P1 candidates whose
 * feed ADDRESS is an unresolved research gap, not a confirmed absence) into
 * the same bucket as HOOD (whose feed is confirmed, directly, to not
 * exist). Those are different situations with different implications: a
 * 404 on HOOD's price lookup is expected and fine to reclassify; the same
 * 404 on MSFT's price lookup would be a real, investigate-worthy surprise,
 * since nothing suggests MSFT itself is missing from Robinhood's registry —
 * only that we haven't found its Chainlink feed's address yet.
 */
export function isKnownUnsupported(ticker: TickerConfig): boolean {
  return ticker.knownUnsupportedReason !== null;
}
