# PARITY — FAQ

Canonical answers to common questions about Parity. If anything here ever conflicts with Parity's actual behavior, the running product is correct and this document is due for an update.

---

## 01 — Understanding Parity

**What does Parity do?**
Parity continuously observes on-chain and reference data for Robinhood Chain Stock Tokens and reports how closely each one is trading to parity with what it is meant to represent — both right now and relative to its own recent history.

**What problem is Parity solving?**
A raw price difference on its own carries no context. Parity's job is to turn "the price is different" into "here is what that difference looks like relative to this Stock Token's own recent behavior, and for how long it has looked that way."

**What is parity?**
Parity is the point of exact correspondence between a Stock Token's on-chain price and its reference price — the 0.00% line. Everything Parity reports is a statement about distance from that line.

**What is a Stock Token?**
A Stock Token is Robinhood Chain's on-chain representation of an equity or other reference asset. Its on-chain price is not the same thing as its reference price, and the two are not required to move together at every moment.

**Is Parity affiliated with Robinhood?**
No. Parity is independent. It observes public, verifiable on-chain and reference data and reports what it finds; it is not built or operated by Robinhood.

**Which Stock Tokens does Parity currently support?**
AAPL, GOOGL, USO, SPCX, TSLA, and NVDA. This list reflects which tokens currently have an independently verified on-chain pool Parity trusts as a pricing source — it will grow as more pools are verified.

---

## 02 — Premium, Discount & the Parity Line

**What does premium mean?**
A premium means a Stock Token's on-chain price is currently *above* its reference price.

**What does discount mean?**
A discount means a Stock Token's on-chain price is currently *below* its reference price.

**Is premium good and discount bad?**
No. Premium and discount describe direction only — which side of parity a price currently sits on. Neither one is a positive or negative signal on its own, and neither should be read as encouragement or discouragement to do anything.

**What does the 0.00% Parity Line represent?**
It represents exact correspondence between the on-chain price and the reference price. A reading of exactly 0.00% is a real, meaningful measurement — not a placeholder and not the same thing as "no data."

**Why can an on-chain price differ from its reference price?**
The on-chain price is set by trading activity in a specific on-chain market; the reference price is observed separately and updates on its own schedule. Nothing forces the two to move in lockstep at every instant, and short-lived differences between them are ordinary.

---

## 03 — Classifications & Historical Intelligence

**What does NORMAL mean?**
The current deviation is consistent with this specific Stock Token's own recent historical baseline.

**What does ELEVATED mean?**
The current deviation is meaningfully outside this Stock Token's own typical range. Precisely: it is at least **2.0×** the token's own baseline dispersion, **and** at least **0.10%** in absolute terms — both conditions are required together.

**What does DISLOCATED mean?**
More outside the token's own typical range than ELEVATED: at least **3.5×** baseline dispersion **and** at least **0.25%** absolute deviation.

**What does SEVERE mean?**
The most extreme tier: at least **5.0×** baseline dispersion **and** at least **0.50%** absolute deviation.

**Does SEVERE mean I should sell?**
> **SEVERE ≠ SELL SIGNAL**
No. SEVERE describes how far today's reading sits from this Stock Token's own recent history — nothing more. It is not a prediction, and it is not an instruction to take any action.

**Does NORMAL mean I should buy?**
No, for the same reason. NORMAL means the current reading is consistent with recent history — it is not a recommendation.

**What is a historical baseline?**
A baseline is what Parity builds from a Stock Token's own accumulated observations: a historical median for its own deviation, and a baseline dispersion describing how much that deviation has varied around the median.

**What is MAD?**
MAD is the **median absolute deviation** — the statistic Parity uses to measure baseline dispersion. It describes how spread out a Stock Token's historical deviations typically are around their own median.

**What is a MAD multiple?**
A MAD multiple measures how far the current deviation sits from the historical median, relative to the baseline dispersion. It is the number classification thresholds are actually measured against.

**Why use median/MAD instead of mean/standard deviation?**
Median and MAD are deliberately resistant to distortion by a small number of extreme readings, which makes them a more stable choice for a baseline that needs to describe "typical" behavior even when a handful of unusual observations exist in the history.

**What does maturity mean?**
Maturity describes whether a Stock Token's baseline has accumulated enough observations and enough elapsed time to be trusted for classification. A young or thin baseline is reported honestly as still developing rather than forced into a premature classification.

**What are INSUFFICIENT_DATA, DEVELOPING, and MATURE?**
`INSUFFICIENT_DATA` means fewer than 20 observations or less than 24 elapsed hours of baseline history exist — no baseline yet. `DEVELOPING` means a baseline exists but hasn't yet reached MATURE's bar. `MATURE` requires at least 200 observations **and** at least 96 elapsed hours; only a MATURE baseline produces a classification.

**What is an episode?**
An episode is a continuous run of non-NORMAL classification. Parity tracks how long an abnormal condition has persisted, not just that it occurred once.

**Why does persistence matter?**
A single abnormal reading and a sustained abnormal condition are genuinely different situations. Collapsing that distinction would throw away one of the more useful parts of the signal — episodes let a reader see duration, not just a momentary snapshot.

> **CLASSIFICATION THRESHOLDS ARE INITIAL OPERATING HYPOTHESES**
The exact numbers above (2.0×/0.10%, 3.5×/0.25%, 5.0×/0.50%) are current operating hypotheses about relative abnormality — not empirically validated risk boundaries. They describe distance from a Stock Token's own history, not a proven measure of danger.

---

## 04 — Data Health & Availability

**Where does Parity's data come from?**
Robinhood's own published price and registry data, an on-chain Chainlink reference feed, and an independently verified Uniswap V3 pool for each supported Stock Token's on-chain price.

**Where does the reference price come from?**
From a Chainlink price feed on Robinhood Chain. Parity treats this as *a* reference for comparison, not as "the real price" — it is one verifiable, independently-updated data point Parity compares the on-chain price against.

**What does unavailable mean?**
It means Parity does not currently have a trustworthy value for that specific field — a stale reference, a paused oracle, an upstream source that failed to respond, or similar. It is a distinct, honest state.

> **UNAVAILABLE ≠ ZERO**
Unavailable never means zero, and an exact 0.00% is never a stand-in for "no data." The two are always reported separately, and Parity never silently substitutes one for the other.

**Why doesn't Parity substitute zero when data is missing?**
Because a real zero (no deviation at all) and a missing measurement are completely different facts, and treating them the same would actively mislead anyone reading the data. Parity would rather show "unavailable" than a number that might be wrong.

**What does stale reference mean?**
It means the reference price Parity has on file for a Stock Token is older than the freshness rule allows, so it is no longer treated as current.

**What's the difference between raw data health and statistical eligibility?**
These are two separate checks. Raw data health (Parity calls this P2) asks whether the underlying reading itself is currently healthy — fresh, not paused, not halted. Statistical eligibility (P3) is a stricter, separate rule layered on top: it additionally requires the reference to be no older than 360 minutes before it is trusted for baseline/classification comparison. A reading can pass the first check while failing the second.

**Why can a deviation be visible while classification is unavailable?**
Because the current deviation only depends on P2-level data health, while classification additionally requires P3 statistical eligibility *and* a MATURE baseline. It is entirely possible, and expected, to see a real current deviation with no classification alongside it.

**Why might there be a gap in historical data?**
A collection run can occasionally fail for a given Stock Token. Rather than invent or interpolate a value to fill the gap, Parity records it as a real, honest gap in the historical record — including in how episode continuity is tracked, so a genuine collection gap is never silently smoothed over.

**Does Parity work 24/7?**
Parity's own collection process runs continuously. Whether a given underlying data source updates outside traditional market hours depends on that source, not on Parity — an on-chain reference feed, for example, can update at any time, including hours when a traditional stock exchange is closed.

---

## 05 — Alerts

**What causes a Parity alert?**
A change in a Stock Token's classification, evaluated against its immediately preceding classification. Not every classification value change produces an alert — only three specific kinds of transitions do (see below).

**What is a New Risk Condition alert?**
Fired when a Stock Token moves from NORMAL to any abnormal classification (ELEVATED, DISLOCATED, or SEVERE).

**What is an Escalation alert?**
Fired when a Stock Token's classification becomes more severe than its immediately preceding classification (for example, ELEVATED to DISLOCATED, or DISLOCATED to SEVERE).

**What is a Recovery alert?**
Fired when a Stock Token moves from any abnormal classification back to NORMAL.

**Does Recovery mean the Stock Token is now safe?**
> **RECOVERY ≠ "SAFE"**
No. Recovery describes a classification change only — the current reading is once again consistent with the Stock Token's own recent baseline. It is not a statement about safety, and it is not investment guidance.

**Why doesn't Parity alert on every price movement?**
Because most movement is ordinary. Alerts exist specifically for classification *transitions* that matter — a new abnormal condition appearing, an abnormal condition getting worse, or a return to NORMAL — not for every fluctuation within an already-known state.

**Why might a classification move lower without generating an alert?**
A downgrade between two abnormal tiers (for example, SEVERE easing to DISLOCATED, or DISLOCATED easing to ELEVATED) does not currently generate an alert. This is a deliberate choice: rather than invent a new kind of "partial improvement" alert, Parity stays silent on this specific transition until that behavior is explicitly designed and validated.

**How does Parity avoid duplicate alerts?**
Parity durably records the timestamp of the last snapshot it evaluated for each Stock Token. A snapshot at or before that recorded timestamp is treated as already-processed and never re-evaluated — including across a restart, so an already-emitted alert cannot fire a second time for the same underlying observation.

---

## 06 — Liquidity, Execution & Gas Telemetry

> **RAW TELEMETRY COLLECTION ONLY — NO SCORING YET**

**What execution/liquidity data does Parity currently collect?**
For each supported Stock Token, Parity now preserves execution/liquidity telemetry: the pool's price state (`sqrtPriceX96` and `tick`), its configured fee tier, its active in-range liquidity, and the pool contract's raw token balances. This is raw historical preservation — nothing is scored or interpreted from it yet.

**What does pool liquidity mean?**
It refers to the Uniswap V3 pool's active liquidity at its current price tick — a raw on-chain measurement of how much liquidity is positioned near the current price right now, not a summary of the whole pool's total activity.

**Are pool balances the same as executable liquidity?**
> **POOL BALANCE ≠ EXECUTABLE DEPTH**
No. A Uniswap V3 pool's liquidity is concentrated at specific price ticks, not spread evenly across all prices. A raw token balance is the pool's total reserve across every tick, which can substantially overstate what is actually tradeable near the current price. Parity does not currently convert either figure into a claim about executable depth.

**Does Parity currently calculate slippage?**
No. Slippage estimation is not implemented today. The raw observations being preserved now are exactly what a future, separately-designed capability would need — they are not yet used to produce any slippage figure.

**Does Parity currently provide an execution score?**
No. No execution score, liquidity score, or similar computed rating exists in the product today.

**Why is Parity collecting this data now?**
Because pool liquidity, tick, and balance state cannot be reconstructed retroactively — if this data isn't captured as it happens, that specific historical record is permanently lost. Collecting it now preserves the option to build on it later without pretending that option already exists today.

**What gas information does Parity preserve?**
A periodic sample of the chain's block number, block timestamp, and base fee per gas — general network-fee context, sampled independently of any specific Stock Token.

---

## 07 — Product Boundaries

**Does Parity execute trades?**
No. Parity is read-only. It does not place, route, or execute any trade.

**Does Parity custody funds?**
No. Parity does not hold, custody, or have control over any user's assets.

**Is Parity an arbitrage bot?**
No. Parity does not identify or act on arbitrage opportunities, and it does not claim that any observed deviation represents a safe or profitable trade.

**Is Parity financial advice?**
No. Parity reports observed market data and statistical context about it. Nothing Parity produces is a recommendation to buy, sell, or hold anything.

**Is Parity a buy/sell signal service?**
No. Classifications, deviations, and alerts describe observed conditions relative to history — not instructions to act.

**Does Parity guarantee that a Stock Token will return to parity?**
No. Parity makes no prediction and no guarantee about future price behavior. It reports what has already happened and how the current reading compares to that history.

---

## 08 — API

**Does Parity have an API?**
Yes — the Parity Risk API, a read-only HTTP endpoint for programmatic access to the same canonical intelligence the dashboard uses.

**What does the Risk API provide?**
Per Stock Token: current deviation and direction, reference status, eligibility, maturity, baseline statistics (historical median, baseline dispersion, MAD multiple), classification, and active episode detail where available.

**What is the current API version?**
`v1`. Every response — success or error — includes `apiVersion: "v1"`.

**What is the endpoint?**
`GET /api/v1/risk/:symbol`

**What is the rate limit?**
60 requests per minute per client IP, enforced only on the Risk API surface. Exceeding it returns HTTP 429 with a truthful `Retry-After` header.

**What does eligibility.eligible mean?**
It reports one fact: whether the current observation is itself usable for statistical comparison. `true` means eligible; `false` means it is not.

**Why doesn't eligibility currently include a detailed reason?**
Because the underlying engine does not yet preserve a granular reason (the specific distinction between a raw-data-health failure and a statistical-eligibility failure) all the way through to this API. Rather than invent a plausible-sounding reason the product cannot actually stand behind, the field is deliberately left as a plain boolean today.

**What happens if a ticker is unsupported?**
HTTP 404 with `{"error": "unsupported_ticker", ...}` — the symbol is not one Parity tracks at all.

**What happens if a supported ticker has no captured data yet?**
HTTP 404 with `{"error": "no_data_yet", ...}` — a deliberately different code from `unsupported_ticker`. It means the symbol is tracked, but no snapshot has been captured for it yet; this is "not available yet," never "will never exist here."

---

*PARITY &middot; Read-only intelligence over verified on-chain data*
