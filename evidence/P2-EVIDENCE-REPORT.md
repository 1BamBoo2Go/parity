# Parity — Slice P2: Dashboard / UI V1

**Baseline: `bcff33803c0d5423fa04a561f6197af963ebca12`. Status: P2 PASSED external live verification on a real VPS (all nine checks). See the final section below. This slice is now eligible for commit.**

---

## Architecture chosen

**A thin Express read-only API + a plain, no-build-step HTML/CSS/vanilla-JS frontend, reading exclusively from the already-persisted, already-tested Slice P1.2b snapshot files.**

### The one real architectural decision worth explaining: current-state views read from the *latest persisted snapshot*, not a fresh live call

The instruction allowed either interpretation ("use existing verified domain functions and snapshot schema"). This slice chose **snapshot-file reads over live recomputation**, for three reasons:

1. **Zero duplicated logic, by construction.** Every number the dashboard shows was already computed by `buildParitySnapshot`/`captureTickerSnapshot` (Slices P0–P1.2b) at capture time. The read model does not call Chainlink, Uniswap, Robinhood, or Blockscout at all — it only reads and relabels what those already-tested functions already produced. There is no second implementation of the parity calculation anywhere in this slice.
2. **One consistent source of truth.** The grid, the detail view, and the history chart all read the same file (`ticker-snapshots.jsonl`), so a ticker's "current" numbers and its most recent history point are always the exact same observation — not two independently-fetched values that could disagree by a few seconds or a rounding step.
3. **No new rate-limit or concurrency surface.** A live-call-per-page-load design would re-introduce every external rate limit (Robinhood's 429s, Blockscout's 403s) on every dashboard refresh, for every concurrent viewer. Reading a file has none of that risk.

The tradeoff, stated plainly: the dashboard is only as fresh as the last `npm run snapshot` run (recommended cadence: every 15 minutes, per Slice P1.2b's own report). This is the correct tradeoff for a monitoring dashboard, and is itself visible to the user via the "Last update" timestamp on every row — the UI never claims to be showing a live-as-of-this-second price.

### Components

- **`src/readmodel/`** — pure, unit-tested view-model construction. `fieldStatus.ts` classifies already-computed `status`/`reason` values into display labels (no new staleness/pause logic — it relabels what P0's `buildParitySnapshot` already decided). `buildViewModels.ts` builds the grid row, detail, and gap-preserving history view models. `snapshotReader.ts` queries the JSONL files (reusing P1.2b's `readJsonLines`, including its malformed-line safety). `dashboardReadModel.ts` composes all of the above and is the only place that decides "which tickers are supported" — by calling P1.2b's `getSupportedSnapshotTickers()`, never a second list.
- **`src/web/server.ts`** — Express app (exported, not started, so tests can drive it directly with `supertest`). Three JSON routes plus static file serving.
- **`scripts/serveDashboard.ts`** — the thin entry point that actually calls `.listen()`.
- **`public/`** — `index.html` + `styles.css` + `app.js`. No build step, no framework, no bundler. Dark theme, dense financial-terminal-style tables, hand-rolled SVG line charts that explicitly break at every `null` value rather than connecting through or interpolating across a gap.

## Routes / pages

| Route | Purpose |
|---|---|
| `GET /` | Serves the dashboard shell (`index.html`) |
| `GET /api/tickers` | Grid summary for all six supported tickers (from each ticker's latest snapshot) |
| `GET /api/tickers/:symbol` | Full detail view model for one ticker; `404 unsupported_ticker` if the symbol isn't in the config-derived supported list |
| `GET /api/tickers/:symbol/history?limit=N` | Gap-preserving historical series (default 500 points, capped at 5000); same 404 behavior for unsupported symbols |

Client-side navigation is a simple hash router (`#/` = grid, `#/AAPL` = detail) — no server-side routing beyond the API/static routes above.

## Data honesty — how each stated requirement was actually enforced, not just intended

- **"No green/healthy state just because a number exists"** — `classifyOverallStatus()` checks staleness, oracle-pause, and trading-halt *before* it ever reaches "healthy_current", using a fixed, tested priority order (`test/fieldStatus.test.ts` has a dedicated test proving stale-reference outranks a plain unavailable field elsewhere).
- **"Never convert null/unavailable to zero"** — enforced mechanically in one place: `toDisplayField()` in `buildViewModels.ts` is the only function that extracts a value from a `SerializedDataPoint`, and it returns `value: null` for every non-`ok` status, full stop. Every view-model builder goes through it. Tested explicitly for `premiumDiscountPct`, holder-concentration percentages, and reference price (`test/buildViewModels.test.ts`).
- **"History gaps preserved, not interpolated"** — `buildTickerHistory()` maps each record's field independently to `null` when unavailable; the frontend's chart renderer (`public/app.js`, `renderChart()`) explicitly breaks the SVG path into separate segments at every `null`, drawing an isolated dot for single-point segments rather than a connecting line. Verified with a real seeded gap in a manual smoke test (see below) — the middle point rendered as a visible break, not a dip to zero or an interpolated line.
- **"Malformed snapshot lines handled safely"** — no new logic needed here; `readJsonLines` (P1.2b) already skips malformed lines, and `test/snapshotReader.test.ts` adds two dedicated tests confirming a truncated trailing write, and a garbage line mid-file, do not affect any other record's readability.
- **"Supported ticker list derived from config/read model"** — `dashboardReadModel.getSupportedTickerSymbols()` calls P1.2b's `getSupportedSnapshotTickers()` directly. `test/dashboardReadModel.test.ts` asserts this matches exactly, and separately asserts MSFT/QQQ/SPY (real tickers in config, not promoted) correctly 404 as `unsupported_ticker` rather than silently appearing.

## Manual smoke test performed in this sandbox (real process, real HTTP, not just unit tests)

Seeded a realistic multi-status snapshot history (30 records: 6 tickers × 5 timestamps, with a deliberately injected stale-reference/pool-failure gap at one timestamp and a holder-concentration failure at another), started the actual server process with `npx tsx scripts/serveDashboard.ts`, and issued real `curl` requests:

- `GET /` returned the real HTML shell.
- `GET /api/tickers` returned live-computed grid rows reflecting the seeded data.
- `GET /api/tickers/AAPL/history` returned 5 points with the deliberately-injected gap showing `referencePrice: null, secondaryPrice: null, premiumDiscountPct: null` at exactly the seeded failure timestamp — not zero, not interpolated.
- `GET /api/tickers/MSFT` returned `404 {"error":"unsupported_ticker","symbol":"MSFT"}`.
- `GET /app.js` (the actual bytes served to a browser) was grepped for secret-like patterns — none found.

This is real evidence the server works end-to-end in this sandbox; it does not substitute for the external checks below (in particular, this sandbox never captured a real live snapshot — the seeded data above is synthetic, used only to exercise the rendering paths).

## Local gates

```
$ npm run typecheck   → clean
$ npm test            → Test Files 15 passed (15); Tests 151 passed (151) [52 new]
$ npx eslint .         → clean (public/app.js is linted too; one real unused-function finding was removed, not suppressed)
$ npm run build        → succeeds, 49 files emitted to dist/
```

New dependencies: `express` (dependency), `@types/express`, `supertest`, `@types/supertest` (devDependencies) — all standard, widely-used, and directly justified by this slice's actual need (an HTTP server and a way to test it without binding a real port).

## Known limitations (stated plainly, not hidden)

- **Freshness is bounded by the snapshot cadence**, not real-time — by design, see above. The "Last update" timestamp is always visible so this is never ambiguous to a viewer.
- **No caching layer** — each API request re-reads and re-parses the full JSONL file. Fine at today's data volume (a handful of captures per hour, six tickers); would need revisiting if capture frequency or ticker count grows substantially. Not addressed in this slice, per scope (no new infrastructure).
- **The chart's Y-axis shows only min/max labels**, not a full tick scale — a deliberate simplicity choice for V1 density over completeness.
- **No auth, no rate limiting on the API itself** — matches the explicit instruction ("no auth/billing yet, keep it read-only").
- **`getSupportedTickerSymbols` takes an unused `options` parameter reserved for future per-environment overrides** — flagged in code with a comment rather than silently removed, in case a later slice needs it; not otherwise acted on now.
- **Provenance-table error detail is visually noisy** — confirmed during external VPS verification against a real Blockscout failure (TSLA): the raw upstream error string is shown as-is in the provenance table rather than a short, user-facing label with an optional expandable technical detail. Explicitly not redesigned in this slice, per instruction; carried forward as a future UI-polish item.

## Local run commands

```bash
npm install
npm run typecheck && npm test && npx eslint . && npm run build

# Populate real data first (or the dashboard will honestly show "No data yet" for all six):
npm run snapshot

# Start the dashboard:
npm run dashboard
# → Parity dashboard listening on http://localhost:3000
```

## Exact external verification commands (VPS)

```bash
npm install
npm run typecheck && npm test && npx eslint . && npm run build
npm run snapshot                     # at least once, to populate real data
npm run dashboard                    # starts on :3000 by default (PORT env var overrides)
```

Then, per the nine-point checklist in the instruction:
1. App starts cleanly — confirm the "Parity dashboard listening..." log line and no crash.
2. Dashboard loads — `curl http://localhost:PORT/` (or a browser) returns the HTML shell.
3. All six supported tickers appear — `curl http://localhost:PORT/api/tickers | jq '.tickers | length'` should be `6`, with symbols `AAPL, GOOGL, USO, SPCX, TSLA, NVDA`.
4. Stale Labor Day data (or whatever the most recent real capture shows) is represented honestly — check that any ticker whose last real capture had `chainlinkReference.status: "unavailable"` renders as `stale_reference`/amber in the grid, not green.
5. No fake premium/discount while reference is stale — for any such ticker, confirm `premiumDiscountPct.value` is `null` in both `/api/tickers` and the detail view.
6. Holder data failures render unavailable, not zero/erroring the page — confirm the page still loads fully even if `holderConcentration.status` is `"unavailable"` for some ticker.
7. Historical snapshot data loads from the real P1.2b files — `curl http://localhost:PORT/api/tickers/AAPL/history` should return real, previously-captured points (not just the single most recent one, if `npm run snapshot` has been run more than once on this VPS already).
8. UI remains usable if one upstream/source is unavailable — this is inherent to the design (the dashboard never calls upstream sources directly; it only reads persisted data), but worth confirming visually that a single ticker's degraded status doesn't blank the whole page.
9. No secrets exposed in browser/client bundle — `curl http://localhost:PORT/app.js` and grep for `BLOCKSCOUT_API_KEY` or any key-shaped string; none should appear (confirmed already in this sandbox, should be re-confirmed on the real served bytes).

No environment variables are required beyond the existing, optional `BLOCKSCOUT_API_KEY` (used only by `npm run snapshot`, never by the dashboard server itself). `PORT` may be set to change the listening port (defaults to `3000`).

## Final result — external live verification PASSED (real VPS, all nine checks)

Full transcript, as reported by the operator, is preserved in `evidence/p2-external-pass-final.txt`. Summary:

- **All four gates re-confirmed externally** against the packaged archive: typecheck, 151/151 tests, lint, build.
- **A real snapshot capture ran successfully** on the VPS (registry, gas, and all 6 ticker snapshots, zero run-level errors), producing live premium/discount values from +0.33% to +1.01% (and one negative: USO at -0.09%) — all comfortably inside the existing sanity bound, and confirming sign preservation end-to-end from capture through the API to the rendered page.
- **The dashboard rendered correctly end-to-end** on the VPS (accessed via SSH tunnel): the grid showed exactly six tickers with real data, statuses, and timestamps; the AAPL detail view rendered every required section (parity, market state, addresses, holder concentration, history, provenance, last snapshot time).
- **The partial-failure design was validated against a real failure, not just a synthetic one:** TSLA's Blockscout holder-concentration call genuinely failed on this run, and the dashboard rendered `unavailable` for top1/top5/top10 — never zero — while every other field on the same page (reference, secondary, premium/discount) remained fully available and correct, and the provenance table preserved the real underlying failure detail. This is the exact behavior `test/server.test.ts` and `test/buildViewModels.test.ts` assert in the sandbox, now confirmed against a genuine live upstream failure.
- **The API was independently inspected** and matched the dashboard's rendered values exactly, including a negative premium/discount (USO) rendering correctly rather than being coerced positive or dropped.

**One non-blocking presentation observation, explicitly carried forward rather than actioned:** the raw Blockscout failure detail shown in the provenance table is visually noisy (a full error string rather than a short label). Per explicit instruction, this was **not** redesigned in this commit — it's recorded here as a future UI-polish item (a concise user-facing message with an optional expandable technical detail), not a defect blocking this slice.

**P2 is complete.** No further live verification is required for this slice's scope.

## Explicitly not built in this slice, per instruction

No new ticker research, no MSFT/SPY/QQQ promotion, no pTokens, no Arcus, no counterfeit/authenticity module, no liquidity scoring, no anomaly detection, no alerts, no webhook changes, no user accounts, no billing, no subscriptions, no trading execution, no recommendations, no portfolio tracking, no new historical analytics beyond what P1.2b already captures, no chain-wide indexing.
