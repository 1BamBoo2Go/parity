import type {
  BaselineMaturity,
  DislocationClassification,
  TickerIntelligence,
} from "../intelligence/types.js";
import type { OverallTickerStatus } from "./fieldStatus.js";

/**
 * P5-A1 — the smallest stable, JSON-safe, machine-readable external Risk
 * API contract.
 *
 * ARCHITECTURAL RULE: this file computes NOTHING. It is a pure projection
 * of two already-computed inputs:
 *   - TickerIntelligence, the ONE canonical statistical computation
 *     (src/intelligence/buildTickerIntelligence.ts) — never recomputed
 *     here, and this module has no dependency on src/intelligence/'s
 *     internal building blocks (baseline/classification/eligibility/
 *     persistence) beyond the already-finished TickerIntelligence object.
 *   - an already-computed OverallTickerStatus (classifyOverallStatus(),
 *     src/readmodel/fieldStatus.ts) and the record's own capturedAt
 *     timestamp, both supplied by the CALLER (a future P5-A2 route/service
 *     layer) exactly the way buildViewModels.ts already composes
 *     classifyOverallStatus(record) alongside intelligence data today —
 *     not recomputed or re-derived inside this file either.
 *
 * TERMINOLOGY / TRUTH RULES enforced by construction, not by convention:
 *   - Never imports or calls formatLabel() / toIntelligenceSummary()'s
 *     pre-rendered `label` field. No UI presentation string of any kind
 *     is read from or written into this contract.
 *   - "madMultiple" / "baselineDispersionMad" are the only accepted names
 *     for the MAD-derived statistic — never "typical", never z-score.
 *   - direction describes ONLY which side of 0.00% parity a reading sits
 *     on (premium/discount/flat). It is never a synonym for risk, and
 *     "flat" is a distinct value from null — an exact 0% reading is a
 *     real, known measurement, not an absence of one.
 *   - Every "unavailable" case in TickerIntelligence maps to `null` in
 *     this contract, never to 0 or an omitted key.
 */

// ---------------------------------------------------------------------
// AUDIT FINDING (see P5-A1 report) — do not "fix" this by recomputing.
//
// src/intelligence/eligibility.ts's evaluateIntelligenceEligibility()
// produces a genuinely richer, discriminated result than what survives
// into TickerIntelligence: { eligible: true } | { eligible: false,
// reason: "p2_unhealthy" } | { eligible: false, reason:
// "p3_reference_too_old", ageMinutes }. buildTickerIntelligence() calls
// it internally to decide `currentIsUsable`, then DISCARDS the specific
// reason — the returned TickerIntelligence object never stores it, on
// any of its three maturity variants.
//
// The only truthful signal p5-A1 can honestly expose from
// TickerIntelligence ALONE is the boolean fact "is the current
// observation usable" (currentPremiumDiscountPct !== null — verified
// against every return branch in buildTickerIntelligence.ts to be exactly
// this consistent, in all three maturity variants). A granular
// "p2_unhealthy" vs "p3_reference_too_old" reason code CANNOT be
// produced here without either (a) recomputing eligibility from the raw
// TickerSnapshotRecord — forbidden, would duplicate the one canonical
// computation and could drift from it — or (b) extending
// TickerIntelligence itself to preserve the discriminated result, which
// is a src/intelligence/ change explicitly out of scope for P5-A1.
//
// Rather than invent a reason taxonomy this layer cannot actually stand
// behind, this contract deliberately omits `eligibility.reason` and
// instead exposes the already-existing, separately-computed
// OverallTickerStatus enum as `referenceStatus` — a real, closed,
// already-tested P2-level enum that DOES explain the common
// "p2_unhealthy" case truthfully (e.g. "stale_reference") without
// inventing anything. The P3-specific "reference technically fresh
// enough for P2 but too old for P3's stricter 360-minute statistical
// rule" case remains distinguishable only as eligible:false with
// referenceStatus:"healthy_current" — a real, honest, if less granular,
// signal. Closing this gap with real per-record reason granularity is a
// separate, explicitly out-of-scope future slice (extend
// TickerIntelligence in src/intelligence/, under its own review).
// ---------------------------------------------------------------------

export type RiskDirection = "premium" | "discount" | "flat";

export interface RiskDeviationViewModel {
  currentPct: number | null;
  direction: RiskDirection | null;
  absDeviationPct: number | null;
}

export interface RiskEligibilityViewModel {
  eligible: boolean;
}

export interface RiskEpisodeViewModel {
  state: "no_active_episode" | "current_observation_unavailable" | "active";
  startedAt: string | null;
  durationMinutes: number | null;
  consecutiveObservations: number | null;
  peakAbsDeviationPct: number | null;
}

export interface RiskIntelligenceViewModel {
  maturity: BaselineMaturity;
  observationCount: number;
  baselinePeriodHours: number | null;
  baselineMedianPct: number | null;
  baselineDispersionMad: number | null;
  madMultiple: number | null;
  classification: DislocationClassification | null;
  episode: RiskEpisodeViewModel | null;
}

export interface RiskViewModel {
  symbol: string;
  apiVersion: "v1";
  capturedAt: string;
  referenceStatus: OverallTickerStatus;
  deviation: RiskDeviationViewModel;
  eligibility: RiskEligibilityViewModel;
  intelligence: RiskIntelligenceViewModel;
}

function toDirection(currentPct: number | null): RiskDirection | null {
  if (currentPct === null) return null;
  if (currentPct > 0) return "premium";
  if (currentPct < 0) return "discount";
  return "flat"; // exactly 0 is a real, known reading — never confused with null
}

function toRiskEpisode(intelligence: TickerIntelligence): RiskEpisodeViewModel | null {
  if (intelligence.maturity !== "MATURE") return null; // no episode concept below MATURE
  const e = intelligence.episode;
  if (e.state === "active") {
    return {
      state: "active",
      startedAt: e.dislocationStartedAt.toISOString(),
      durationMinutes: e.durationMinutes,
      consecutiveObservations: e.consecutiveAbnormalObservations,
      peakAbsDeviationPct: e.peakAbsoluteDeviationPct,
    };
  }
  return { state: e.state, startedAt: null, durationMinutes: null, consecutiveObservations: null, peakAbsDeviationPct: null };
}

/**
 * Pure projection. Takes the already-computed TickerIntelligence plus two
 * already-computed pieces of caller-supplied context (capturedAt,
 * referenceStatus) — recomputes nothing, reads no raw snapshot records.
 */
/**
 * Pure projection. The ONLY canonical intelligence input is
 * `intelligence` (TickerIntelligence — the one, already-finished
 * computation from src/intelligence/buildTickerIntelligence.ts).
 * `capturedAt` and `referenceStatus` are already-computed context
 * SUPPLIED BY THE CALLER — a future P5-A2 route/service layer, reading
 * from the same record/history it already has on hand — never derived,
 * recomputed, or fabricated inside this function. All three top-level
 * fields sit in one flat input object specifically so a call site cannot
 * silently swap positional arguments and specifically so it is visible,
 * at every call, which values are canonical vs. caller-supplied context.
 *
 * `capturedAt` is accepted as a real `Date` (matching how the rest of
 * this codebase already treats timestamps — see HistoricalBaseline's
 * baselineStartAt/baselineEndAt and DislocationEpisode's
 * dislocationStartedAt) and converted to an unambiguous ISO-8601 string
 * HERE, the same `.toISOString()` convention intelligenceViewModel.ts
 * already uses for its own Date fields. This is a pure, deterministic
 * re-serialization step, not a computation of anything intelligence- or
 * eligibility-related.
 */
export function toRiskProjection(input: {
  symbol: string;
  intelligence: TickerIntelligence;
  capturedAt: Date;
  referenceStatus: OverallTickerStatus;
}): RiskViewModel {
  const { symbol, intelligence, capturedAt, referenceStatus } = input;
  const currentPct = intelligence.currentPremiumDiscountPct;
  const eligible = currentPct !== null;

  const b = intelligence.baseline;
  const baselinePeriodHours = b.observationCount > 0 ? b.elapsedHours : null;

  const isMature = intelligence.maturity === "MATURE";

  return {
    symbol,
    apiVersion: "v1",
    capturedAt: capturedAt.toISOString(),
    referenceStatus,
    deviation: {
      currentPct,
      direction: toDirection(currentPct),
      absDeviationPct: intelligence.currentAbsDeviationFromParityPct,
    },
    eligibility: {
      eligible,
    },
    intelligence: {
      maturity: intelligence.maturity,
      observationCount: b.observationCount,
      baselinePeriodHours,
      baselineMedianPct: b.medianPct,
      baselineDispersionMad: b.dispersionMad,
      madMultiple: isMature ? intelligence.relativeDeviationMultiple : null,
      classification: isMature ? intelligence.classification : null,
      episode: toRiskEpisode(intelligence),
    },
  };
}
