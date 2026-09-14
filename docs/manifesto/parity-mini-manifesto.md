# PARITY
### Risk Intelligence for Robinhood Chain Stock Tokens

**Is this Stock Token still trading at parity with what it is supposed to represent?**

---

## The Problem

Robinhood Chain Stock Tokens create an on-chain market for assets whose value is meant to track something else — a reference price, observed elsewhere, updated on its own schedule. The two do not have to move in lockstep. An on-chain price can drift above its reference (a **premium**) or below it (a **discount**), and the distance between them is a Stock Token's **deviation from parity**.

Seeing that a deviation exists is easy — read two numbers, subtract. Understanding what the deviation *means* is harder. A small premium that appears and disappears within an hour is not the same condition as a discount that persists for a day. A deviation that is unremarkable for one Stock Token may be extreme for another. A single percentage, on its own, carries no history and no context.

```
        DISCOUNT   ←──────────────   0.00% PARITY   ──────────────→   PREMIUM
```

This is the line Parity watches: the point of exact correspondence between what a Stock Token is trading for on-chain and what it is meant to represent. Everything Parity reports is a statement about distance from that line — and about what that distance has looked like over time.

## The Intelligence Layer

Parity continuously observes verified on-chain and reference data for each supported Stock Token and accumulates a historical record. From that record it builds a **baseline**: a historical median for the token's own deviation, and a baseline dispersion — measured as a **MAD (median absolute deviation)** — describing how much that deviation has varied around its median, deliberately chosen for being resistant to distortion by a handful of extreme readings.

A current deviation is then measured against that baseline as a **MAD multiple**: how far the current deviation sits from the historical median, relative to the baseline dispersion. The result is a relative-abnormality condition:

**NORMAL — ELEVATED — DISLOCATED — SEVERE**

Read that scale for what it says and no more: a statement about how far today's reading sits from this Stock Token's own recent history, not a verdict, not a prediction, and not an instruction. Two further things matter as much as the classification itself. First, **maturity** — a baseline needs enough observations and enough elapsed time before it is trusted to mean anything, and a young Stock Token is honestly reported as still developing rather than forced into a premature verdict. Second, **persistence** — Parity distinguishes a momentary blip from a sustained **episode**, because a single abnormal reading and an abnormal condition that holds for hours are genuinely different situations, and collapsing that distinction would throw away the most useful part of the signal.

## Principles

**Independent.** Parity is not affiliated with Robinhood. It observes public, verifiable data and reports what it finds.

**Read-only.** Parity does not execute trades, custody assets, or take any action on a user's behalf. It is an instrument, not an intermediary.

**Data-honest.** When a reading is unavailable — a stale reference, a paused oracle, an upstream source that failed to respond — Parity reports it as unavailable. It is never silently treated as zero, and it is never quietly filled in with a guess.

**Not advice.** A classification of SEVERE is not a sell signal. A classification of NORMAL is not a buy signal. Parity's thresholds are current operating hypotheses about relative abnormality, not validated boundaries of risk, and no reading Parity produces should be read as a recommendation to act.

## What Comes Next

Robinhood Chain Stock Token markets are early. As they grow, the questions worth asking about them will grow too — not only *is this trading at parity*, but *how deep is this market, and under what conditions can it actually be traded*. Parity has already begun preserving the raw on-chain observations — pool liquidity, reserve balances, tick and price state — that this next layer of questions will eventually depend on. That work today is deliberately limited to honest collection, not interpretation: no execution score exists yet, and no claim is made that a raw balance is the same thing as tradeable depth. The instrument is built to grow carefully, one verified layer at a time.

---

*PARITY · Read-only intelligence over verified on-chain data*
