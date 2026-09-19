# Parity — Risk Intelligence for Stock Tokens

**Live production dashboard: [https://parity.nodehq.net](https://parity.nodehq.net)**

Parity continuously observes on-chain and reference data for Robinhood Chain Stock Tokens and reports how closely each one is trading to parity with what it is meant to represent — both right now and relative to its own recent history. It is independent, read-only, and reports observed conditions rather than recommendations: no buy/sell signals, no guaranteed arbitrage, no execution or liquidity scores.

**Core question:** *"Is this Stock Token still trading at parity with what it is supposed to represent?"*

## Current capabilities

- **Dashboard** (`public/`) — a live instrument view of every supported Stock Token's current deviation, classification, and history, reading the same canonical intelligence as the API and alerts (never a separately computed value). Run with `npm run dashboard`.
- **Historical intelligence** (`src/intelligence/`) — a per-token historical baseline (median deviation, MAD dispersion), maturity gating (`INSUFFICIENT_DATA` / `DEVELOPING` / `MATURE`), four-tier classification (`NORMAL` / `ELEVATED` / `DISLOCATED` / `SEVERE`), and persistence-episode tracking. Classification thresholds are current operating hypotheses about relative abnormality, not empirically validated risk boundaries — see `docs/primer/parity-technical-primer.md` for the full model.
- **Risk API** (`GET /api/v1/risk/:symbol`) — a versioned, rate-limited (60 req/min/IP) HTTP endpoint exposing the same canonical intelligence programmatically. Documented in `docs/api-v1.md`. Live example: `https://parity.nodehq.net/api/v1/risk/AAPL`
- **Alert engine** (`src/alerts/`) — a pure consumer of canonical intelligence that detects `new_risk`, `escalation`, and `recovery` classification transitions, with durable, restart-safe deduplication. Delivers to a structured log by default, or optionally to Discord via the `DISCORD_ALERT_WEBHOOK_URL` environment variable.
- **Execution/liquidity telemetry** (P5-C0) — per-snapshot preservation of raw on-chain pool state (`sqrtPriceX96`, `tick`, fee tier, active liquidity, raw token reserve balances). **This is raw historical collection only** — Parity does not currently compute slippage, executable depth, or any liquidity/execution score from this data, and a raw pool balance is not the same thing as executable depth (V3 liquidity is concentrated at specific ticks, not spread evenly). See Section 12 of the Technical Primer for the full caveat.
- **Gas telemetry** — a periodic, ticker-independent sample of block number, block timestamp, and base fee per gas.

## Supported Stock Tokens

AAPL, GOOGL, USO, SPCX, TSLA, NVDA — reflecting which tickers currently have an independently verified on-chain pool Parity trusts as a pricing source. This list grows as more pools are verified; it is not a ceiling on the architecture.

## Documentation

- [`docs/api-v1.md`](docs/api-v1.md) — Risk API v1 contract
- [`docs/manifesto/parity-mini-manifesto.md`](docs/manifesto/parity-mini-manifesto.md) — a short introduction to why Parity exists (also available as a designed PDF)
- [`docs/faq/parity-faq.md`](docs/faq/parity-faq.md) — 64-question FAQ covering the full product (also available as a designed PDF)
- [`docs/primer/parity-technical-primer.md`](docs/primer/parity-technical-primer.md) — the complete technical/philosophical account of the system: data sources, statistical model, alert engine, API, limitations, and future direction (also available as a designed PDF)

## Quickstart

```bash
npm install
npm run typecheck    # clean
npm test              # 400/400 passing
npm run lint           # clean
npm run build           # clean

npm run dashboard       # serves the live dashboard + API on PORT (default 3000)
npm run snapshot        # runs one collection cycle manually (intended cadence: every 15 minutes via cron)
```

No API key is required for core operation. An optional `BLOCKSCOUT_API_KEY` environment variable enables a documented fallback path for holder-concentration data — see `src/sources/blockscoutHolders.ts`. An optional `DISCORD_ALERT_WEBHOOK_URL` environment variable enables Discord alert delivery in place of the default structured log — see `src/alerts/discordAlertDelivery.ts`. Neither is ever hardcoded or committed; both are read only from the environment.

## What's in here

- `src/domain/` — pure calculation logic (premium/discount math, decimals normalization, staleness detection). Fully unit-tested, no I/O.
- `src/sources/` — client code for each upstream data source (Robinhood registry + prices, Chainlink feed reads, Uniswap V3 pool resolution and telemetry, Blockscout holders, ERC-20 reads).
- `src/snapshot/` — periodic capture and durable, append-only historical storage (one record per Stock Token per run; malformed lines never corrupt the rest of the file).
- `src/intelligence/` — the canonical statistical model: baseline, maturity, classification, persistence episodes.
- `src/readmodel/` — projects canonical intelligence into the shapes the dashboard and Risk API each need, without recomputing it.
- `src/alerts/` — the alert decision engine, durable state/deduplication, and delivery (structured log, optional Discord).
- `src/web/` — the Express server: dashboard routes, the Risk API, and rate limiting.
- `src/config/` — network definitions and the candidate ticker registry, with a citation on every field.
- `scripts/` — the real collector (`captureSnapshot.ts`), the dashboard server (`serveDashboard.ts`), the original P0 live-proof CLI (`proveP0.ts`), and independent ABI selector verification tooling.
- `docs/` — the current documentation suite (API contract, manifesto, FAQ, technical primer).
- `evidence/` — the project's original P0–P2 live-verification reports, raw pass/fail run output, and `RECOVERY.md` (repository reconstruction/provenance record), preserved as historical evidence rather than edited away.

## Known limitations

Stated plainly (see `docs/primer/parity-technical-primer.md`, Section 15 for the complete list): only six Stock Tokens are currently supported; pricing is Uniswap V3 only (no V4 support today); classification thresholds are unvalidated operating hypotheses; the Risk API's eligibility field does not yet expose a granular reason; there is no slippage engine, liquidity score, or execution score; alert delivery has no retry/outbox mechanism; historical execution/liquidity telemetry before P5-C0 cannot be reconstructed.

## License

Not yet finalized — no licensing decision has been made pending confirmation of Buildathon submission requirements.
