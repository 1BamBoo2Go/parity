import type { TickerSnapshotRecord } from "../snapshot/types.js";
import { computeHistoricalBaseline } from "./baseline.js";
import { classifyMaturity } from "./maturity.js";
import { classifyCurrentDislocation } from "./classification.js";
import { computePersistenceEpisode } from "./persistence.js";
import { evaluateIntelligenceEligibility } from "./eligibility.js";
import type { IntelligenceSummary, TickerIntelligence } from "./types.js";

/**
 * Build the full TickerIntelligence object for one ticker from its
 * complete snapshot history. This is the ONLY place intelligence is
 * computed — both the detail view and the overview grid summary are pure
 * projections of this same object (see toIntelligenceSummary below),
 * never a second, duplicated statistical computation.
 *
 * `history` should be the ticker's full, chronologically-ordered
 * TickerSnapshotRecord[] (not pre-filtered) — every module in
 * src/intelligence/ does its own eligibility filtering internally.
 */
export function buildTickerIntelligence(symbol: string, history: TickerSnapshotRecord[]): TickerIntelligence {
  const sorted = [...history].sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
  const baseline = computeHistoricalBaseline(sorted);
  const maturity = classifyMaturity(baseline);

  // Current-observation eligibility and its raw value are computed
  // UNCONDITIONALLY, before any maturity branching. This is deliberate:
  // currentPremiumDiscountPct/currentAbsDeviationFromParityPct are plain
  // facts about the current record (the same category of number P0's
  // buildParitySnapshot has always reported with no history requirement
  // at all), not statistical claims about the baseline's representativeness
  // — they must not be gated by how much history exists. Only
  // relativeDeviationMultiple/classification/episode depend on trusting
  // the baseline as representative, and those remain MATURE-gated below.
  const currentRecord = sorted[sorted.length - 1] ?? null;
  const currentEligibility = currentRecord ? evaluateIntelligenceEligibility(currentRecord) : { eligible: false as const };
  const currentIsUsable = currentRecord !== null && currentEligibility.eligible && currentRecord.premiumDiscountPct.status === "ok";
  const currentPremiumDiscountPct = currentIsUsable
    ? (currentRecord!.premiumDiscountPct as { status: "ok"; value: number }).value
    : null;
  const currentAbsDeviationFromParityPct = currentPremiumDiscountPct !== null ? Math.abs(currentPremiumDiscountPct) : null;

  if (maturity !== "MATURE") {
    return { symbol, maturity, baseline, currentPremiumDiscountPct, currentAbsDeviationFromParityPct };
  }

  if (!currentIsUsable) {
    return {
      symbol,
      maturity: "MATURE",
      baseline,
      currentPremiumDiscountPct: null,
      currentAbsDeviationFromParityPct: null,
      relativeDeviationMultiple: null,
      classification: null,
      episode: { state: "current_observation_unavailable" },
    };
  }

  // currentIsUsable narrows currentRecord to non-null for TypeScript.
  const current = currentRecord!;
  const currentPct = (current.premiumDiscountPct as { status: "ok"; value: number }).value;
  const result = classifyCurrentDislocation(currentPct, baseline);
  const episode = computePersistenceEpisode(sorted, baseline);

  return {
    symbol,
    maturity: "MATURE",
    baseline,
    currentPremiumDiscountPct: currentPct,
    currentAbsDeviationFromParityPct: result.currentAbsDeviationFromParityPct,
    relativeDeviationMultiple: result.relativeDeviationMultiple,
    classification: result.classification,
    episode,
  };
}

function formatLabel(intelligence: TickerIntelligence): string {
  if (intelligence.maturity === "INSUFFICIENT_DATA") {
    return "Insufficient data";
  }
  if (intelligence.maturity === "DEVELOPING") {
    return `Developing (${intelligence.baseline.observationCount} observations)`;
  }
  // MATURE
  if (intelligence.classification === null) {
    return "Current reading unavailable";
  }
  const multipleStr = intelligence.relativeDeviationMultiple !== null ? `${intelligence.relativeDeviationMultiple.toFixed(1)}x typical` : "";
  if (intelligence.classification === "NORMAL") {
    return `Normal — ${multipleStr}`;
  }
  const durationStr =
    intelligence.episode.state === "active" ? `, persisting ${Math.round(intelligence.episode.durationMinutes)}m` : "";
  return `${intelligence.classification} — ${multipleStr}${durationStr}`;
}

/**
 * Compact projection for the overview grid (GET /api/tickers). Pure
 * function over the SAME TickerIntelligence object the detail endpoint
 * uses — no statistical recomputation happens here, only field selection
 * and a pre-rendered label so the frontend needs no client-side logic.
 */
export function toIntelligenceSummary(intelligence: TickerIntelligence): IntelligenceSummary {
  const episodeDurationMinutes =
    intelligence.maturity === "MATURE" && intelligence.episode.state === "active" ? intelligence.episode.durationMinutes : null;

  return {
    maturity: intelligence.maturity,
    observationCount: intelligence.baseline.observationCount,
    classification: intelligence.maturity === "MATURE" ? intelligence.classification : null,
    relativeDeviationMultiple: intelligence.maturity === "MATURE" ? intelligence.relativeDeviationMultiple : null,
    episodeDurationMinutes,
    label: formatLabel(intelligence),
  };
}
