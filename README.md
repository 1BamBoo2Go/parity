# Parity (Buildathon v0 — Slices P0 + P1)

Independent Robinhood Stock Token parity intelligence: is a token still trading at parity with the reference value it's supposed to represent?

**Status: Slice P0 (bootstrap + live ground-truth proof) and Slice P1 (verified ticker coverage expansion) are both complete, live-network-verified, and committed.** See `evidence/P0-EVIDENCE-REPORT.md` and `evidence/P1-EVIDENCE-REPORT.md` for the full history — including the real bugs found and fixed along the way — and the corresponding `evidence/p*-external-pass-final.txt` files for the final passing runs.

## Supported ticker coverage (as of Slice P1)

| Ticker | Status |
|---|---|
| AAPL, GOOGL, USO, SPCX | Supported (Slice P0) |
| TSLA, NVDA | Supported (Slice P1) |
| MSFT, SPY, QQQ | Explicitly unverified/incomplete — real, live tickers, but missing a verified Chainlink feed (and, for MSFT/QQQ, also a verified pool). See `evidence/P1-EVIDENCE-REPORT.md` for exactly what's missing and why. |
| HOOD | Confirmed unsupported (no published Chainlink feed) — kept as a deliberate negative test case. |

## What P0 proved

Every P0 data path has been proven against real, live infrastructure: Robinhood's registry and price APIs, Robinhood Chain's public RPC, Chainlink's on-chain feeds, live Uniswap V3 pool resolution with correct decimals/orientation normalization, and real holder-concentration data via Blockscout. The full incident history — including a genuine decimals/orientation bug the first external run caught, and how it was diagnosed and fixed — is preserved in `evidence/P0-EVIDENCE-REPORT.md` rather than quietly edited away, because that history is itself part of this project's evidence trail.

## Quickstart (from a normal, internet-connected machine)

```bash
npm install
npm run typecheck   # should be clean
npm test            # 29/29 should pass
npx eslint .         # should be clean
npm run build        # should succeed

npm run prove:p0     # THE live ground-truth proof — see evidence/P0-EVIDENCE-REPORT.md
                      # for what success looks like and what would still block P0
```

No API key is required to run P0 end to end (confirmed live). An optional `BLOCKSCOUT_API_KEY` environment variable enables a documented fallback path for holder-concentration data if Blockscout's free per-instance endpoint is unavailable in your environment — see `src/sources/blockscoutHolders.ts` and `evidence/PROVENANCE.md` for details. Never hardcode this key; it is read only from the environment and is never committed to this repository.

## What's in here

- `src/domain/` — pure calculation logic (premium/discount math, decimals normalization, the Chainlink-multiplier double-application guard, staleness detection). Fully unit-tested, no I/O.
- `src/sources/` — real client code for each upstream data source (Robinhood registry + prices, Chainlink feed reads, Uniswap V3 pool resolution, Blockscout holders, plain ERC-20 reads).
- `src/parity/` — the orchestrator that safely composes a `ParitySnapshot`, enforcing "missing data never becomes zero," "stale data is never presented as current," and "unsupported is never presented as healthy."
- `src/config/` — network definitions and the candidate ticker registry, with a citation on every field.
- `scripts/proveP0.ts` — the actual live-proof CLI (see Quickstart above).
- `scripts/computeSelectors.ts` / `scripts/crossCheckSelectors.ts` — independent, from-scratch verification of every non-standard ABI function selector this project relies on.
- `evidence/` — `PROVENANCE.md` (what every number means and where it comes from) and `P0-EVIDENCE-REPORT.md` (exactly what has and hasn't been live-verified).

## Explicitly out of scope for this slice

No dashboard/UI, no Arcus/pToken integration, no liquidation heatmaps, no cross-protocol modeling, no automated execution or recommendations, no universal ticker coverage, no full historical charting. See the project brief for the frozen v0 scope.
