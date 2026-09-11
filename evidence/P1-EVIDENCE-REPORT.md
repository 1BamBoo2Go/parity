# Parity — Slice P1 Evidence Report: Verified Ticker Coverage Expansion

**Baseline: P0 committed clean at `40f08cf6ff41e4cd928a624b0641d7fe8b948979`. Nothing in P0's evidence or code was modified or reinterpreted by this slice — P1 only adds new candidate rows to the same config schema and corrects one predicate (`isKnownUnsupported`) whose old, looser definition would have misclassified the new candidates, not any P0 ticker's actual behavior.**

**Status: P1 PASSED external live verification. See Section G for the final result. This slice is now eligible for commit.**

---

## A. Candidate-by-candidate verification matrix

| Ticker | Token address | Source(s), cross-checked | Chainlink feed address | Source(s) | USDG pool evidence | Verdict going into external run |
|---|---|---|---|---|---|---|
| **TSLA** | `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` | QuickNode official guide + sqd.dev independent table (2 sources agree) | `0x4A1166a659A55625345e9515b32adECea5547C38` | hummusonrails/robinhood-chain-dapp-example (explicit table), endorsed by an official Arbitrum Foundation blog post as tested against live mainnet state | **Strong** — appears in SQD's top-10-by-volume table (real USDG-pool-priced volume) | Strongest P1 candidate — same evidentiary tier as P0's AAPL/SPCX before their own external verification |
| **NVDA** | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | QuickNode + sqd.dev + chainstacklabs/robinhood-chain-sequencer-feed (3 independent sources agree) | `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15` | Same hummusonrails repo as TSLA, same Arbitrum Foundation endorsement; separately, Robinhood's own official docs use NVDA in a worked Chainlink-feed example | **Strong** — appears in SQD's top-10-by-volume table | Strongest P1 candidate, tied with TSLA |
| **MSFT** | `0xe93237C50D904957Cf27E7B1133b510C669c2e74` | QuickNode + sqd.dev (2 sources agree) | **Not found** — a research gap, not a confirmed absence | Robinhood's own docs name MSFT in a worked feed example (qualitative confirmation a feed exists) but no source gives its address | Unconfirmed — not in SQD's top-10 table | Feed-address gap is the blocker; likely to fail Step 4 externally through no fault of the code |
| **SPY** | `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C` | QuickNode + sqd.dev (2 sources agree) | **Not found** — a research gap, not a confirmed absence | — | **Strong** — appears in SQD's top-10-by-volume table | The interesting case: strong pool evidence, missing feed address — informative regardless of outcome |
| **QQQ** | `0xD5f3879160bc7c32ebb4dC785F8a4F505888de68` | sqd.dev only — **single-sourced**, weaker than every other row | **Not found** | PAIR launchpad press release confirms it as a canonical token, but only for memecoin-pairing pools, which this project's own rules treat as insufficient USDG evidence | Unconfirmed — not in SQD's top-10 table | Weakest candidate on every axis; included for honest completeness, expected to be the most likely to fail |

**Method note:** every address above was cross-checked against at least one independent source before inclusion, except QQQ's token address (flagged explicitly above and in `src/config/tickers.ts` as single-sourced). No feed or pool address was ever guessed, interpolated, or filled in without a citation — where a citation doesn't exist (MSFT/SPY/QQQ's feed addresses), the field is `null` and the gap is stated plainly rather than papered over.

## B. Supported vs. unsupported/unverified — expected result, pending external confirmation

This slice does not itself decide who's "supported" — the external live run does, exactly as it did for P0. Based on the evidence gathered:

- **Expected to pass the full gate:** TSLA, NVDA (feed + pool evidence at the same strength that carried AAPL/SPCX through P0's own external verification).
- **Expected to fail specifically at the Chainlink-feed step, through a documented research gap rather than a code defect:** MSFT, SPY, QQQ. Per the explicit instruction, this is an acceptable outcome — "if only 1 or 2 of the five candidates pass the full gate, that is acceptable," and the gate was not weakened to manufacture a better-looking number.
- **HOOD** (from P0) is unaffected and remains a deliberate, confirmed-unsupported negative-test case.

## C. The regression this slice fixes (and why it matters)

The original `isKnownUnsupported()` predicate (P0) inferred "known unsupported" from `chainlinkFeedMainnet === null && poolAddressMainnet === null`. That was safe for P0 because HOOD was the only row where a feed address was absent for a *confirmed* reason. Adding MSFT, SPY, and QQQ — where the feed address is absent because **we haven't found it yet**, not because it doesn't exist — would have silently swept all three into the same "expected gap" bucket as HOOD, meaning a genuine 404 or registry-absence surprise for any of them could have been quietly reclassified as "fine, expected" when it should instead have been investigated as a real failure.

**Fix:** `TickerConfig` now carries an explicit `knownUnsupportedReason: string | null` field. `isKnownUnsupported()` is driven by that field alone — never inferred from which addresses happen to be null. HOOD's row states its reason directly (a live contract's own address table confirms the feed's absence); MSFT/SPY/QQQ's rows leave the field `null`, meaning their registry and price lookups are still held to the same "this should work" standard as any other ticker, and only their feed-specific step is allowed to come back unsupported. `test/tickersP1.test.ts` includes a dedicated regression test (`isKnownUnsupported is driven by the explicit knownUnsupportedReason field, not inferred from null addresses`) against a synthetic fixture, so this distinction can't silently regress again.

Confirmed structurally in this sandbox's own (network-blocked) run: TSLA/NVDA/MSFT/SPY/QQQ's registry-lookup failures all correctly surface as `FAIL`, not `SKIP` — proving the fix behaves as intended even before the external run supplies real data.

## D. Local gates

```
$ npm run typecheck   → clean
$ npm test            → Test Files 5 passed (5); Tests 59 passed (59)  [13 new]
$ npx eslint .         → clean, no errors, no warnings
$ npm run build        → succeeds, 23 files emitted to dist/
```

## E. What still requires the external run

Per the same standard P0 was held to, none of the following can be claimed from this sandbox:

1. Live registry confirmation of TSLA/NVDA/MSFT/SPY/QQQ (status, active multiplier).
2. Live Chainlink feed reads for TSLA and NVDA (answer > 0, decimals, updatedAt, oraclePaused, no double-applied multiplier).
3. Live `factory.getPool()` resolution for TSLA, NVDA, and SPY against USDG at fee 3000 (SPY's pool alone, without its feed, cannot complete Step 6 — that specific gap is expected and informative, not a bug).
4. Live, plausible premium/discount for TSLA and NVDA (the only two candidates with both halves of the gate in place).
5. Confirmation, one way or the other, on whether MSFT and QQQ's tokens even have a stablecoin-quoted pool at all (their config currently has no pool candidate configured, since no fee-tier/quote-asset evidence was found for either).

## F. Exact external proof command

Identical to P0 — no new script, no new command. The same harness (`scripts/proveP0.ts`) already iterates `CANDIDATE_TICKERS` generically, so it automatically covers the five new rows:

```
npm install && npm run prove:p0
```

No new environment variables are required beyond the optional `BLOCKSCOUT_API_KEY` already documented for P0's holder-concentration fallback.

## G. Final result — external live verification PASSED

A final external run on a network-unrestricted VPS reported:

**39 ok / 13 unsupported (expected) / 0 real failures, out of 52 total steps.**

The full transcript, as reported by the operator, is preserved in `evidence/p1-external-pass-final.txt`. Result, ticker by ticker:

- **TSLA — FULL PASS.** Live Chainlink reference 353.98495, live normalized Uniswap V3 secondary 355.46367279607864 USDG, premiumDiscountPct +0.4177% — a real, plausible market observation, comfortably inside the sanity bound. **Promoted to supported coverage.**
- **NVDA — FULL PASS.** Live Chainlink reference 230.23665, live normalized secondary 232.50803644288797 USDG, premiumDiscountPct +0.9865%. **Promoted to supported coverage.**
- **MSFT — NOT PROMOTED.** Registry and Robinhood price both pass (it's a real, live, actively-traded ticker), but no Chainlink feed and no pool were verified. Exactly the outcome predicted from the research-gap noted before this run — remains explicitly unverified/incomplete, `chainlinkFeedMainnet: null`, `poolVerified: false`.
- **SPY — NOT PROMOTED, but informative.** Its Uniswap V3 pool was independently verified live (confirming the strong pool evidence found during research), but no Chainlink feed was verified — so premium/discount was correctly **not computed**, per the hard rule that it requires both halves of the gate. This is the harness behaving exactly as designed under a genuinely mixed evidence case, not a bug.
- **QQQ — NOT PROMOTED.** Neither feed nor pool verified — the weakest-evidenced candidate going in, confirmed to be the weakest coming out.
- **P0 regression check:** AAPL, GOOGL, USO, SPCX, and HOOD all remained healthy — this slice's config and predicate changes did not alter any P0 ticker's live behavior.
- **Holder concentration (AAPL):** top1=40.56% / top5=68.80% / top10=78.97% — close to, but not identical to, P0's own final numbers (40.48%/69.09%/79.03%), consistent with real holder composition shifting slightly between the two external runs rather than a bug in either.
- **Blockscout resolution:** the operator's report states this run "used the documented Blockscout API-key fallback," resolving the ambiguity left open at the end of P0 about which of the two paths (free endpoint vs. key-gated PRO API) had succeeded there. The key's value itself was never shared with or seen by Claude.

**Reconciliation applied:** `src/config/tickers.ts` now marks `poolVerified: true` for TSLA and NVDA only, each with a provenance note citing the exact live reference/secondary/premium-discount values above. Their `poolAddressMainnet` remains `null` — the operator's report did not include the specific resolved pool contract address, and this project's rule against fabricating or backfilling addresses applies here exactly as it did to P0's own tickers. MSFT, SPY, and QQQ are unchanged from their pre-run state: still explicitly unverified, still not promoted, still not weakened into looking more supported than they are.

**P1 is complete.** No further live verification is required for this slice's scope.
