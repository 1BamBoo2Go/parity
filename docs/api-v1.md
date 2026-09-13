# Parity Risk API — v1

Risk / market-integrity intelligence for Robinhood Chain Stock Tokens.

This document describes exactly what is implemented today. It does not describe planned features.

## Base route

```
GET /api/v1/risk/:symbol
```

`:symbol` is a Robinhood Chain Stock Token ticker (e.g. `AAPL`, `NVDA`). Lookup is case-insensitive — `aapl`, `Aapl`, and `AAPL` all resolve to the same ticker — and the `symbol` field in every response is always the canonical uppercase form.

## What this API is — and is not

This endpoint reports **observed market-integrity signals**: on-chain vs. reference price deviation, reference data freshness, and abnormality relative to a ticker's own recent historical baseline. It does not evaluate, and must never be read as evaluating, whether an asset is safe or unsafe to buy, and it makes no investment recommendation of any kind. A `classification` of `NORMAL` is not a buy signal, and a `classification` of `SEVERE` is not a sell signal — both describe statistical distance from a historical baseline, nothing more.

## Successful response

```
GET /api/v1/risk/AAPL
```

```json
{
  "symbol": "AAPL",
  "apiVersion": "v1",
  "capturedAt": "2026-09-12T16:45:03.764Z",
  "referenceStatus": "healthy_current",
  "deviation": {
    "currentPct": -0.3049,
    "direction": "discount",
    "absDeviationPct": 0.3049
  },
  "eligibility": {
    "eligible": true
  },
  "intelligence": {
    "maturity": "DEVELOPING",
    "observationCount": 146,
    "baselinePeriodHours": 145.0,
    "baselineMedianPct": -0.28,
    "baselineDispersionMad": 0.11,
    "madMultiple": null,
    "classification": null,
    "episode": null
  }
}
```

HTTP `200`.

## Field definitions

| Field | Type | Meaning |
|---|---|---|
| `symbol` | string | Canonical uppercase ticker |
| `apiVersion` | string | Always `"v1"` for this contract |
| `capturedAt` | string | ISO-8601 timestamp of the underlying snapshot's own capture time — never a derived or approximated value |
| `referenceStatus` | string | One of: `healthy_current`, `stale_reference`, `oracle_paused`, `trading_halt`, `upstream_unavailable` |
| `deviation.currentPct` | number \| null | Signed current on-chain-vs-reference deviation, in percentage points. `null` means unavailable — see Null semantics below |
| `deviation.direction` | string \| null | `premium`, `discount`, or `flat`. `null` exactly when `currentPct` is `null` |
| `deviation.absDeviationPct` | number \| null | Absolute value of `currentPct`; same nullability |
| `eligibility.eligible` | boolean | Whether the current observation itself is usable for statistical comparison |
| `intelligence.maturity` | string | `INSUFFICIENT_DATA`, `DEVELOPING`, or `MATURE` — see Maturity below |
| `intelligence.observationCount` | number | Count of historical observations behind the baseline |
| `intelligence.baselinePeriodHours` | number \| null | Elapsed hours the baseline spans; `null` when there is no baseline at all (`observationCount` is 0) |
| `intelligence.baselineMedianPct` | number \| null | Historical median deviation |
| `intelligence.baselineDispersionMad` | number \| null | Baseline dispersion — see MAD terminology below |
| `intelligence.madMultiple` | number \| null | See MAD terminology below. Only ever non-null when `maturity` is `MATURE` |
| `intelligence.classification` | string \| null | See Classification below |
| `intelligence.episode` | object \| null | Dislocation episode detail; only ever non-null when `maturity` is `MATURE` |

## Direction is not risk

`premium` and `discount` describe which side of 0.00% parity a reading sits on — nothing more. Neither value carries a positive or negative connotation, and neither should be read as "good" or "bad."

## Null semantics — read carefully

**`null` means unavailable. It never means zero, and zero never means unavailable.** An exact `0.00%` reading is a real, meaningful measurement — it serializes as the number `0`, with `direction: "flat"` and `eligibility.eligible: true`. A `null` reading means there is nothing truthful to report for that field right now (a stale reference, a paused oracle, or the observation not yet being old/plentiful enough to support the statistic in question).

## Maturity

| Value | Meaning |
|---|---|
| `INSUFFICIENT_DATA` | Too little history exists yet for any baseline at all |
| `DEVELOPING` | A baseline exists but has not yet accumulated enough observations and elapsed time to be treated as statistically representative. `deviation.currentPct` may still be genuinely available and eligible at this stage — maturity gates the *baseline statistics* (`madMultiple`, `classification`, `episode`), not the raw current reading |
| `MATURE` | The baseline has enough observations and enough elapsed time to support relative-abnormality classification |

## Classification

Only present (non-null) when `maturity` is `MATURE` **and** the current observation is itself eligible. One of:

- `NORMAL`
- `ELEVATED`
- `DISLOCATED`
- `SEVERE`

**`classification` may legitimately be `null`** — this is not an error condition. It is `null` whenever `maturity` is not yet `MATURE`, or whenever the current observation is ineligible even on a mature ticker. These threshold boundaries are initial operating hypotheses and have not yet been empirically validated against long-run outcome data; treat `classification` as a relative-abnormality signal, not a validated risk boundary.

## MAD terminology

`baselineDispersionMad` is the baseline's dispersion, measured as a **MAD (median absolute deviation)**. `madMultiple` is the current deviation's distance from the baseline median, expressed as a multiple of that MAD — call it the **"MAD multiple"** or **"baseline dispersion multiple."**

Never call this a **z-score** (it is a robust, median-based statistic, not a mean/standard-deviation one) and never describe it with wording like **"x typical [deviation]"** — that phrasing does not appear anywhere in this contract and must not be reintroduced in any documentation or client code built against it.

## Eligibility

`eligibility.eligible` reports one truthful fact: whether the current observation is itself usable. It does **not** carry a `reason` field. The underlying engine computes a more granular reason internally (roughly: "the data was unhealthy" vs. "the reference was too old for statistical purposes specifically") but does not yet preserve that distinction all the way through to this contract — inventing one here would mean guessing rather than reporting a fact this API can actually stand behind. Use `referenceStatus` alongside `eligibility.eligible` for a partial, always-truthful picture: a `referenceStatus` other than `healthy_current` explains the common case; `eligible: false` with `referenceStatus: "healthy_current"` means the reference was fresh enough for ordinary purposes but not fresh enough for this API's own stricter statistical-comparison requirement.

## Error responses

### Unsupported ticker

```
HTTP 404
```
```json
{ "error": "unsupported_ticker", "symbol": "DOGE", "apiVersion": "v1" }
```
The symbol is not a Robinhood Chain Stock Token this API tracks at all.

### No data yet

```
HTTP 404
```
```json
{ "error": "no_data_yet", "symbol": "NVDA", "apiVersion": "v1" }
```
The symbol **is** supported/tracked, but no snapshot has been captured for it yet. This is deliberately a different error code from `unsupported_ticker` — it means "not available yet," never "will never exist here."

### Rate limit exceeded

```
HTTP 429
```
```json
{ "error": "rate_limit_exceeded", "apiVersion": "v1" }
```
See Rate limiting below.

## Rate limiting

The current policy: **60 requests per minute, per client IP**, enforced only on `GET /api/v1/risk/:symbol`. The rest of this application's routes (the internal dashboard) are not subject to this limit.

When the limit is exceeded, the response is `HTTP 429` with the exact JSON body shown above, plus a `Retry-After` header (seconds) telling you exactly how long until the current window resets. Respect it — retrying immediately will continue to return `429` until the window elapses.

This is a simple, single-process, in-memory limiter appropriate for the current deployment. It is not yet backed by API keys, accounts, or per-developer quotas — those are a planned, separate piece of work, not part of this contract today.

## HTTP status summary

| Status | Meaning |
|---|---|
| `200` | Success — body is a `RiskViewModel` |
| `404` | `unsupported_ticker` or `no_data_yet` — see above |
| `429` | Rate limit exceeded — see above |

## Current API version

`v1`. The version appears in every response (success or error) as `apiVersion`. Future breaking changes will ship under a new version path (`/api/v2/...`) rather than changing this contract in place.
