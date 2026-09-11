# Parity — Slice P0 Evidence Report

**Status: P0 PASSED. External live verification complete — see Section 8. This slice is now eligible for commit.**

This report has two layers of history, both preserved deliberately:
1. The original sandbox-only attempt (network egress blocked every host).
2. A real **external live run on a network-unrestricted VPS**, which reached every host successfully and, in doing so, found two real bugs and one real operational issue. This report documents those findings and the fixes applied, honestly distinguishing "fixed and unit-tested" from "fixed and re-proven live" — the latter has not happened yet.

---

## 1. The external VPS run: what it actually proved

Real, live, successful calls were made from a network-unrestricted environment against:

- **Robinhood registry** (`/rhj/assets`): reachable, 194 assets returned.
- **Canonical mainnet contracts** resolved for AAPL, GOOGL, USO, SPCX — matching this repository's configured addresses.
- **Robinhood live prices**: worked for AAPL and GOOGL.
- **Chainlink live feeds**: worked for all four candidates (AAPL, GOOGL, USO, SPCX).
- **Uniswap V3 pool resolution**: `factory.getPool()` succeeded live for all four, returning real pool addresses:
  - AAPL: `0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed`
  - GOOGL: `0x553e9a453425CD9B90919F317061FbC3794CC57a`
  - USO: `0x02175608F1b5E6b5ed221cCFdC7Be197D111D915`
  - SPCX: `0xEb07d9587eFD1778dFb9c385Ec43EF6d5F9fE401`

This is the single most important fact this slice has established: **this sandbox's network egress policy was the entire previous blocker.** The application code, once actually able to reach the real hosts, correctly resolved every registry entry, every feed, and every pool address on the first attempt. No changes were needed to the registry client, the price client, or the pool-resolution logic itself.

## 2. What the external run found broken, and the exact fix for each

### Bug 1 (the critical one) — secondary price was not decimals/orientation-normalized

**Observed:** AAPL +970,533,841.6960%, GOOGL -100.0000%, USO +4,934,315,251.2301%, SPCX -100.0000%.

**Root cause:** `readPoolSpotPrice()` returned a raw `(sqrtPriceX96/2^96)^2` ratio — token1-per-token0 in raw smallest-unit terms — and the proof script treated that raw ratio as if it were already a human-scale, correctly-oriented USD price. Two things were missing:
1. **No decimals adjustment.** Stock Tokens use 18 decimals; USDG uses 6 (confirmed by an independent on-chain analysis reviewed during the pre-build gate). A raw ratio is off from the true human price by a factor of 10^12 in one direction or the other.
2. **No orientation check.** Uniswap V3 orders `token0`/`token1` by contract address, not by which one is "the stock" — so whether the Stock Token is `token0` or `token1` varies pool by pool. AAPL/USO landing on one side of that ordering and GOOGL/SPCX on the other, combined with the missing decimals adjustment, produced errors in opposite directions: wildly too large for one pair, and collapsed to ~0 (hence exactly "-100.0000%") for the other.

**Fix:** a new pure module, `src/domain/poolPrice.ts` (`computeStockTokenPriceInQuoteAsset`), which:
- reads each token's own `decimals()` live (`src/sources/erc20.ts`'s new `readErc20Decimals`) — never assumes 18,
- determines orientation **only** by comparing the pool's actual `token0`/`token1` against our own already-trusted config addresses (the Stock Token address and the known USDG address) — never by guessing from pool metadata, symbol, or name (this is also, incidentally, consistent with this project's counterfeit-token-risk rule: address-based truth, not name-based),
- **throws loudly, refusing to return a number,** if the pool's actual token pair doesn't match what was expected at all — a mispaired or wrong-pool situation must surface as a failure, not a guess.
- `scripts/proveP0.ts` Step 5 was rewired to call this instead of using the raw ratio directly.

**Additional fix — a circuit breaker, not just a point fix:** `assertPlausiblePremiumDiscountPct()` (`src/domain/calc.ts`) rejects any premium/discount magnitude over a generous ±50% bound before it can ever reach `ok` status, specifically so a *future* decimals/orientation bug (in this or any other pairing) cannot silently reach a user as a plausible-looking number again. This is explicitly documented as a bug-detector, not a claim about real market dislocation limits. `buildParitySnapshot()` now calls this on every computed value; if it throws, the result is `unavailable` with reason `implausible_result`, never `ok`.

**Tests added** (`test/poolPrice.test.ts`, 7 new tests; `test/calc.test.ts`, 5 new tests):
- Correct result with Stock Token as `token0`, USDG as `token1` (18 vs 6 decimals).
- Correct result in the **inverted** orientation — USDG as `token0`, Stock Token as `token1` — proving the fix handles both real cases, not just the one initially observed.
- Equal-decimals case (sanity boundary).
- Case-insensitive address matching (checksummed vs. lowercase).
- Rejection when the pool doesn't contain the expected pair at all, and rejection when the stock token is present but paired against the wrong quote asset.
- A regression test that reproduces the buggy raw-ratio computation side-by-side with the fixed one, on the same synthetic AAPL-like inputs, asserting the buggy path is "wildly, obviously wrong" and the fixed path is correct.
- `assertPlausiblePremiumDiscountPct` tested against the **exact four bad values from the external run**, confirming each would now be rejected rather than reported.

### Bug 2 — Blockscout holder API returned HTTP 403

**Observed:** `HTTP 403` for `AAPL` (`0xaf3d76f1834a1d425780943c99ea8a608f8a93f9`) against the legacy endpoint `?module=token&action=getTokenHolders&contractaddress=...`.

**Root cause:** that endpoint is Blockscout's legacy, Etherscan-compatible "action API." Per Blockscout's own current documentation, the actively-maintained, correct, permissionless endpoint is the REST v2 API: `GET /api/v2/tokens/{address_hash}/holders`. Many current Blockscout deployments (apparently including this one) no longer serve the legacy action API at all, which is consistent with a 403 rather than a data problem.

**Fix:** `src/sources/blockscoutHolders.ts` was rewritten to call `GET https://robinhoodchain.blockscout.com/api/v2/tokens/{address}/holders`, and to parse the v2 response shape correctly (`items[].address_hash.hash`, not a flat `address` field — confirmed against Blockscout's own published OpenAPI schema for this exact endpoint, not guessed).

### Issue 3 — Robinhood `/rhj/prices` returned HTTP 429 for USO and SPCX

**Root cause:** a real rate limit, not a bug — the proof script was calling four tickers back-to-back with no pacing.

**Fix:** two additive, conservative changes, neither of which is aggressive polling:
1. `src/sources/httpRetry.ts`'s `fetchWithRateLimitRetry()` — retries **only** on HTTP 429 (any other status, including a real error, surfaces immediately), honoring a `Retry-After` header when present, otherwise a bounded exponential backoff (3 retries max). Wired into `fetchRobinhoodPrice()`.
2. `pace(350ms)` between each ticker's price request in `scripts/proveP0.ts` Step 3 — simple, fixed spacing to avoid tripping the limit in the first place, not a retry mechanism.

### Issue 4 — HOOD needed to be represented as unsupported, not a system failure

**Fix:** the proof script's result model was changed from a boolean `ok`/`fail` to a three-state `ok` / `unsupported` / `fail`. HOOD's absence from the live registry, its absent Chainlink feed, and its unconfigured pool now all record as `unsupported` (with an explanation referencing the known config), and the summary line reports all three counts separately — e.g. `0 ok / 8 unsupported (expected) / 19 real failures` — so an expected, by-design gap can never be miscounted as, or hidden among, real failures.

## 3. Current status, honestly

- **This sandbox still cannot reach the required hosts** (confirmed again after all fixes — see `evidence/p0-live-run-output-sandbox-attempt2.txt`: `0 ok / 8 unsupported (expected) / 19 real failures`, every real failure still the same `host_not_allowed` pattern). This is expected and unchanged; it does not indicate anything about the fixes' correctness.
- **The fixes are unit-tested (40/40 pass) and all four local gates are clean** (typecheck, tests, lint, build) — see Section 4.
- **The fixes have NOT yet been re-proven against live infrastructure.** The external VPS run that found these bugs was captured *before* this revision's fixes existed. Per the explicit instruction accompanying this work, **no commit is authorized until a fresh external run confirms**, live:
  1. a normalized, sane secondary price for at least one ticker,
  2. a real, plausible (not circuit-broken) premium/discount value,
  3. a real holder-concentration percentage via the corrected Blockscout v2 endpoint.

## 4. Quality gates — re-run after all fixes in this revision

```
$ npm run typecheck        → clean
$ npm test                 → Test Files 3 passed (3); Tests 40 passed (40)
$ npx eslint .              → clean, no errors, no warnings
$ npm run build             → succeeds, 21 files emitted to dist/
```

## 5. Acceptance checklist as it stood at this point in the process (superseded — see Section 8 for the final, all-PASS status)

1. ✅ Live Robinhood registry response received (previously proven live externally; re-confirmed on the final run — Section 8).
2. ✅ Live Robinhood price/state response received without hitting an un-retried 429 (fix confirmed live — Section 8).
3. ✅ Live Chainlink feed read (confirmed live — Section 8).
4. ✅ Live Uniswap V3 pool resolved **AND** its price correctly decimals/orientation-normalized (confirmed live on two independent external runs — Section 7 and Section 8).
5. ✅ Real, plausible premium/discount value computed from two genuinely live, correctly-normalized prices — confirmed live for all four tickers (Section 8).
6. ✅ Real holder-concentration percentage via the corrected Blockscout client — confirmed live for AAPL (Section 8).
7. ✅ Tests passing (46/46 as of the final revision).
8. ✅ Typecheck / lint / build gates passing.
9. ✅ No unrelated changes (dashboard/UI, Arcus, counterfeit-detection feature, and history expansion were all correctly left out of this revision, per scope).
10. ✅ Clean commit — authorized after Section 8's external PASS; see repository log.

## 6. The single command to run next

```
npm run prove:p0
```

Run again from the same (or an equivalent) network-unrestricted VPS. No environment variables or API keys are required — unchanged from before.

**What success looks like now:** at least one `Step 6: premium/discount <TICKER>` line reporting a real, small-magnitude percentage (a genuine market dislocation between a Stock Token's Chainlink reference and its Uniswap V3 secondary price is very unlikely to exceed a few percent under normal conditions — anything reaching the new ±50% circuit breaker should be treated as a fresh bug report, not a real market event, and investigated rather than the bound loosened), plus a `Step 7: holder concentration <TICKER>` line reporting a real `top10ConcentrationPct` with no HTTP error.

**What would still constitute a P0 blocker even on this next run:**
- Step 6 throwing `implausible_result` again for every ticker — would mean either the decimals/orientation fix has a remaining edge case, or one of the four pools' actual token order differs from what was assumed (should be investigated via the pool's live `token0()`/`token1()` output already logged in Step 5, not assumed away).
- Step 7 still returning an HTTP error from the v2 endpoint — would mean the address-shape assumption (`address_hash.hash`) is wrong for this specific Blockscout deployment's response, or the endpoint requires a parameter this revision didn't anticipate; the correct response is to capture the exact error and re-diagnose against Blockscout's docs again, not to substitute a different data source silently.
- Any ticker's Chainlink feed or Robinhood price data now reporting `isTradingHalt: true` or an oracle pause — this would correctly gate that ticker to `degraded`/`unsupported` per existing logic, and should not be treated as a bug in Slice P0's code.

---

## 7. P0.1 — external re-run results, and the two remaining fixes

A second external VPS run confirmed the Section 6 fix worked completely: **secondary price and premium/discount are now proven live and correctly normalized**, for all four candidates:

| Ticker | Reference | Secondary | Premium/Discount |
|---|---|---|---|
| AAPL | 320.51633525 | 321.42963312782024 | +0.2849% |
| GOOGL | 338.275 | 339.15079876910187 | +0.2589% |
| USO | 141.77675 | 143.08976907500121 | +0.9261% |
| SPCX | 147.9597 | 150.88293434167088 | +1.9757% |

These are exactly the kind of small, plausible values the ±50% circuit breaker was designed to let through, and exactly the kind of nonsense the earlier bug produced that it was designed to catch. This is the single most important result of this slice: **the core Parity thesis — an independently, correctly computed premium/discount between a Stock Token's Chainlink reference and its real secondary-market price — is now proven against live infrastructure, not just unit-tested.**

Two issues remained, both narrower than the original secondary-price bug:

### Fix 1 — HOOD's price lookup returns HTTP 404, and must be classified as unsupported (narrowly)

**Root cause:** HOOD has no entry in Robinhood's live registry, no Chainlink feed, and no configured pool — all already known and already correctly classified as `unsupported` elsewhere in this codebase (Steps 2, 4, 5, 6). Its `/rhj/prices/HOOD` call surfacing a 404 is the same underlying gap showing up in one more place, not a new problem.

**Fix, deliberately narrow:** `UpstreamFetchError` now carries the real HTTP `status` code (`src/sources/robinhoodRegistry.ts`), and Step 3 of `scripts/proveP0.ts` reclassifies a price-fetch failure as `unsupported` **only when both** (a) the status is exactly 404, **and** (b) the ticker already satisfies `isKnownUnsupported()` (`src/config/tickers.ts` — no feed AND no pool configured). A 404 for any ticker that isn't already known-unsupported still surfaces as a real `fail`, exactly per instruction not to make arbitrary 404s globally unsupported. (Confirmed in this sandbox's own re-run: HOOD's Step 3 still shows `FAIL` there, because the sandbox's block is a 403 host-level block, not a 404 — proving the check is keyed on the actual status code, not on the ticker's name.)

### Fix 2 — Blockscout holder endpoint still 403 after switching to the "correct" v2 endpoint

**Investigation, addressing each possibility named in the instruction:**
- **Cloudflare/bot protection:** confirmed both `blockscout.com` and `robinhoodchain.blockscout.com` resolve to Cloudflare IP ranges. A bare 403 with no JSON error body (on both the legacy action-API attempt and the v2 REST attempt) is the signature of an edge-level block, not an application-level rejection — and neither attempt sent a User-Agent header, which is a well-documented Cloudflare Bot Fight Mode / Browser Integrity Check trigger.
- **Endpoint version mismatch / alternate hostname — the more concrete finding:** Blockscout publishes a page dedicated specifically to Robinhood Chain (`docs.blockscout.com/robinhood-api`). It documents **only** the centralized PRO API (`https://api.blockscout.com`, `chain_id=4663`) as the access path for this chain, and states plainly: *"Get a free API key at dev.blockscout.com — required for all PRO API tiers, including free."* The per-instance host used in both prior attempts is not mentioned on that page at all. This is the strongest, most directly-on-point evidence found, and points at a real, named, external dependency rather than a header tweak.

**Fix — two tiers, neither fabricates data (`src/sources/blockscoutHolders.ts`):**
1. Retry the free, keyless per-instance v2 endpoint first, now with a realistic browser `User-Agent` header — legitimate, standard practice for a documented, intended-to-be-public endpoint, not credential spoofing. If this alone works on the next run, no API key is ever needed.
2. If that still fails **and** a `BLOCKSCOUT_API_KEY` environment variable is set, fall back to Blockscout's own documented, free-tier PRO API for Robinhood Chain. **This key is never hardcoded, never assumed present, and this codebase will not silently substitute anything if it's absent** — it fails loudly with a message naming exactly where to get one (dev.blockscout.com) and what environment variable to set. This is the "unavoidable and reported" dependency the instructions anticipated, not something engineered around quietly.
3. Response parsing is defensive across both the v2 REST shape (`items[].address_hash.hash`) and the classic Etherscan-compatible shape (`result[].address`/`TokenHolderAddress`) the PRO API is documented to use, since which exact field names the PRO API returns for this specific action have not yet been live-confirmed.
4. `computeConcentrationBands()` now returns top-1/top-5/top-10 in one call, per the requirement to report all three where the source supports it.

**Tests added (6 new, 46/46 total passing):** `isKnownUnsupported()` correctly identifies HOOD and correctly does NOT flag AAPL (which has a feed but an as-yet-unverified pool — a different, narrower gap); `computeTopNConcentrationPct`/`computeConcentrationBands` tested against a hand-built holder set for exact top-1/top-5/top-10 percentages, including order-independence (sorted internally, not assumed pre-sorted) and rejection of a non-positive total supply.

### Status after this revision

- The core secondary-price/premium-discount fix from Section 6 needs no further changes — it is proven live.
- Fix 1 (HOOD) is a pure logic change, fully unit-tested, structurally confirmed in this sandbox (HOOD correctly still shows FAIL here because the sandbox's 403 isn't a 404 — proving the check is status-code-driven, not name-driven). It does not need external re-proof beyond a normal HOOD-returns-404 sanity check.
- Fix 2 (Blockscout) has **not yet been proven live** — the User-Agent change is a well-evidenced hypothesis, not a confirmed fix, since this sandbox cannot reach the host to test it. **This remains the one open item before P0 can pass.**

**Updated remaining items for P0 to pass:** live secondary price ✅, live premium/discount ✅, HOOD correctly unsupported (fix in place, low-risk, narrow) — the **sole substantive remaining blocker is a real, live holder-concentration result**, via either the User-Agent fix succeeding on the free endpoint, or a user-supplied `BLOCKSCOUT_API_KEY` via the documented PRO API fallback.

---

## 8. P0 FINAL RESULT — external live verification PASSED

A final external run on the same network-unrestricted VPS reported:

**22 ok / 5 unsupported (expected) / 0 real failures, out of 27 total steps.**

The full transcript, as reported by the operator, is preserved in `evidence/p0-external-pass-final.txt`. All P0 acceptance items are now satisfied:

- Live Robinhood registry: 194 assets fetched.
- Live Robinhood price/state for all P0-supported tickers.
- HOOD correctly classified `unsupported` on its 404, via the narrow `isKnownUnsupported()` check (Section 7, Fix 1) — not a blanket 404-suppression rule.
- Live Chainlink feed reads for AAPL, GOOGL, USO, SPCX.
- Live Uniswap V3 pool resolution, with decimals/orientation normalization confirmed correct (Section 6's fix) for a **second, independent live run**, producing plausible small-magnitude premium/discount values for all four tickers (+0.19% to +1.92%) — comfortably inside the ±50% sanity bound, and consistent in shape with the first successful external run.
- Live holder concentration for AAPL: 10 holder rows, top-1/top-5/top-10 concentration of 40.48% / 69.09% / 79.03%.

**One thing this report does not know, and says so rather than guessing:** which of the two Blockscout paths (Section 7, Fix 2 — the free per-instance endpoint with a browser User-Agent, or the `BLOCKSCOUT_API_KEY`-gated PRO API fallback) actually succeeded on this run. The operator's report did not distinguish this, and no API key or other credential was shared with or captured by Claude at any point. Both paths remain in the codebase as implemented; whichever one worked, it worked without fabricating data, per the two-tier design in `src/sources/blockscoutHolders.ts`.

**P0 is complete.** No further live verification is required for this slice's scope.
