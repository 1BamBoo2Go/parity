# Parity — Data Provenance

This document explains, in plain language, where every number Parity shows comes from, what it means, and where it can go wrong. It is written to be handed to a Buildathon judge or a prospective B2B customer as-is.

## 1. Sources

### Robinhood registry (canonical ticker → contract address)
- **What:** `GET https://api.robinhood.com/rhj/assets`
- **Owner:** Robinhood, official and documented at `docs.robinhood.com/chain/stock-token-apis`.
- **What we use it for:** the authoritative symbol → contract address mapping, current/pending corporate-action multiplier, and asset status (active/inactive).
- **Why it's the source of truth, not a third-party list:** Robinhood is the issuer. Any other list (a block explorer's token search, a symbol match found in a random pool) can be spoofed — see "Counterfeit-token risk" below.

### Robinhood price / market-state
- **What:** `GET https://api.robinhood.com/rhj/prices/{symbol}`
- **What we use it for:** the raw underlying-equity bid/ask (NOT multiplier-adjusted — see "Multiplier semantics"), the `isTradingHalt` flag, and a `generatedAt` timestamp. Used as a cross-check against the Chainlink feed, and as our only source for trading-halt state.

### Chainlink on-chain reference feed
- **What:** `latestRoundData()` and `decimals()` on each ticker's Chainlink `AggregatorV3Interface` feed proxy, read directly from Robinhood Chain via RPC.
- **Owner:** Chainlink, documented at `docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood`.
- **What it returns:** the *Total Return Value* — underlying equity market price × the token's own corporate-action multiplier — already combined. **This is our primary reference price.**
- **Coverage:** NOT universal. At least one real, well-known ticker (HOOD) has no published feed, per direct confirmation in a live, in-production contract repository (see Section 3). Parity must never assume a feed exists; every ticker's feed address is configured individually with a citation, or explicitly marked absent.

### Secondary-market price
- **What:** the spot price (`slot0()`) of a specific, individually-identified Uniswap V3 pool pairing the Stock Token against USDG, resolved via `UniswapV3Factory.getPool(token, USDG, fee)` — never assumed, never guessed via offline address computation.
- **Owner of the infrastructure:** Uniswap (factory address confirmed via Uniswap Labs' own official Robinhood Chain deployments documentation, and independently re-confirmed by a live, external `factory.getPool()` call for all four v0 candidates).
- **Critical rule:** Parity only treats a pool as a valid secondary-price source once a human (or a live, tool-executed on-chain read) has confirmed both that the pool exists for that exact pair and fee, and that it carries genuine, non-trivial liquidity — not merely that *some* pool with that token exists. A large share of Stock-Token pool activity on this chain pairs a stock token against a speculative memecoin, not a stablecoin; that kind of pool tells you nothing about the stock token's USD value and must never be substituted in.
- **Normalization is mandatory and non-obvious.** A Uniswap V3 pool's raw `sqrtPriceX96` is neither decimals-adjusted nor consistently oriented (Uniswap orders `token0`/`token1` by contract address, not by which one is "the interesting one"). Both must be corrected before the number means anything:
  - **Decimals:** Stock Tokens use 18 decimals; USDG uses 6. A raw ratio is off from a true human price by a factor of 10^12 in one direction or the other if this is skipped.
  - **Orientation:** whether the Stock Token is `token0` or `token1` varies pool by pool and must be determined by comparing the pool's actual tokens against our own already-trusted addresses — never guessed from pool metadata, symbol, or name.
  - Skipping either step is not a cosmetic error: an external live test run against real infrastructure produced values like "AAPL +970,533,841.6960%" and "GOOGL -100.0000%" from exactly this mistake. See `evidence/P0-EVIDENCE-REPORT.md` for the full incident and fix, and `src/domain/poolPrice.ts` for the corrected, tested implementation.
  - As a second line of defense, every computed premium/discount value is checked against a generous ±50% sanity bound before it can be marked `ok` (`assertPlausiblePremiumDiscountPct` in `src/domain/calc.ts`) — a bug-detector, not a claim about real market limits.

### Holder concentration
- **What:** primarily `GET https://robinhoodchain.blockscout.com/api/v2/tokens/{address}/holders` (Blockscout's free, per-instance REST v2 API) with a realistic browser `User-Agent` header, combined with a direct `totalSupply()` read; falling back to Blockscout's official, free-tier PRO API (`https://api.blockscout.com`, documented specifically for Robinhood Chain at `docs.blockscout.com/robinhood-api`) if the free path fails and a `BLOCKSCOUT_API_KEY` environment variable has been supplied.
- **Owner:** Blockscout, confirmed as Robinhood Chain's official block explorer.
- **A real, reported external dependency:** the PRO API fallback requires a free (not paid) API key obtained from `dev.blockscout.com`. Parity never assumes this key is present, never hardcodes one, and fails with a clear, actionable message naming exactly what's missing if both the free path and the key-gated fallback are unavailable. See `evidence/P0-EVIDENCE-REPORT.md` Section 7 for the full investigation into why the free per-instance endpoint has returned HTTP 403 on two different URL patterns so far.
- Reports top-1, top-5, and top-10 concentration in one pass (`computeConcentrationBands`).

## 2. The premium/discount formula

```
premium_discount_pct = ((secondary_price - reference_price) / reference_price) * 100
```

- `reference_price` is the Chainlink Total Return Value (already multiplier-adjusted) — or, as a cross-check path, the Robinhood REST mid-price with the current multiplier applied exactly once (see below).
- `secondary_price` is the token's observed price in its verified USDG pool, decimals- and orientation-adjusted.
- A positive number means the token is trading **above** its reference value (premium); negative means **below** (discount); zero is exact parity.
- **This number is only ever computed when both sides are freshly available.** If either side is missing, stale, or unverified, Parity reports that explicitly — it never substitutes a zero, a cached value, or an estimate in its place.

## 3. Multiplier semantics — read this before touching either price path

Robinhood's tokenized-equity contracts carry a `uiMultiplier()` that accounts for corporate actions (dividend reinvestment, splits, reverse splits). There are **two independent price paths, and the multiplier must be applied in exactly one of them:**

1. **Chainlink path:** `latestRoundData()` already returns the multiplier-adjusted Total Return Value. **Do not multiply by `uiMultiplier()` again.**
2. **Robinhood REST path:** `/rhj/prices/{symbol}` returns the RAW underlying bid/ask. If this path is used as a reference (e.g. as a cross-check when a Chainlink feed is stale or absent), the multiplier from `/rhj/assets`' `currentMultiplier` field must be applied exactly once, via `applyMultiplierOnce()` (`src/domain/calc.ts`), and nowhere else downstream.

Getting this wrong in either direction silently produces a systematically wrong premium/discount number that looks plausible — this is exactly the kind of bug the project's "evidence before assumption" rule exists to prevent. `applyMultiplierOnce()`'s unit tests reproduce Chainlink's own documented 10:1-split worked example exactly, as a standing regression check.

## 4. Counterfeit-token risk

Stock Tokens are ordinary ERC-20 contracts. **Anyone can deploy a token with the same symbol and display name as a real Stock Token.** This is not a theoretical risk: an independent on-chain analysis (SQD, "What Robinhood's Tokenized Stocks Trade Against," 2026-08-31) documents a live, actively-traded counterfeit "GME" contract (`0xc2362aff2a2a4cc1f48cf3dab2c4e2605eb94ba3`) that has done **$111.0M** of volume against the real GME (`0x1b0e319c6a659f002271b69db8a7df2f911c153e`), $40.4M of it crossing directly against the genuine token.

**Parity's rule:** every ticker is resolved through Robinhood's official `/rhj/assets` registry by contract address, never by matching a symbol or display name found elsewhere on-chain. `src/config/tickers.ts` records this specific example (`KNOWN_COUNTERFEIT_EXAMPLE`) as a standing reminder and a test fixture for Slice P1's planned on-chain authenticity check (verifying against the shared `Stock` beacon implementation, not just the registry API, as defense in depth).

## 5. Unsupported-ticker behavior

A ticker can fail verification for several independent reasons: no published Chainlink feed (HOOD, confirmed), no verified liquid secondary pool (most of the 195-token universe — see Section 6), a stale reference price, or an active oracle pause / trading halt. In every case:

- The ticker is **never silently dropped** from output.
- It is returned with an explicit `unavailable` status and a specific `reason` (`no_chainlink_feed`, `no_verified_pool`, `stale`, `oracle_paused`, `trading_halt`, `rpc_unreachable`, `upstream_error`, or `not_yet_verified`).
- Its `premiumDiscountPct` is never computed from a partial pair — see Section 2.
- Its overall `supportStatus` is `unsupported`, never `ok`, and never silently coerced to look healthy.

## 6. Known current evidence limitations (as of this P0 slice)

- Of the ~195 Stock Tokens Robinhood has issued, independent on-chain volume analysis indicates only **~46** have a genuinely liquid USDG-quoted pool. Parity's v0 candidate list (AAPL, GOOGL, USO, SPCX) was chosen because each has at least one independent piece of evidence for a real stablecoin pool — but as of this slice, **none has been confirmed by a live, tool-executed on-chain read.** AAPL and SPCX have the strongest evidence (both are top-10-by-volume in the independent analysis, priced via USDG pool VWAP); GOOGL and USO are comparatively weaker-evidenced and should be treated as lower-confidence until directly confirmed.
- No ticker in this repository has `poolVerified: true`. That flag is reserved for a state this slice has not yet reached: a live, successful `factory.getPool()` read followed by a real liquidity check.
- See `evidence/P0-EVIDENCE-REPORT.md` for the full, itemized account of what has and has not been live-verified, and exactly what live result is still required before this changes.
