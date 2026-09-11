import type { BaselineMaturity, DislocationClassification, TickerIntelligence } from "../intelligence/types.js";

/** JSON-safe (Date -> ISO string) mirror of HistoricalBaseline. */
export interface HistoricalBaselineViewModel {
  observationCount: number;
  baselineStartAt: string | null;
  baselineEndAt: string | null;
  medianPct: number | null;
  typicalAbsDeviationFromParityPct: number | null;
  dispersionMad: number | null;
  elapsedHours: number;
  excludedByFreshnessCount: number;
}

export type DislocationEpisodeViewModel =
  | { state: "no_active_episode" }
  | { state: "current_observation_unavailable" }
  | {
      state: "active";
      dislocationStartedAt: string;
      durationMinutes: number;
      consecutiveAbnormalObservations: number;
      peakAbsoluteDeviationPct: number;
    };

export interface IntelligenceDetailViewModel {
  maturity: BaselineMaturity;
  baseline: HistoricalBaselineViewModel;
  currentPremiumDiscountPct: number | null;
  currentAbsDeviationFromParityPct: number | null;
  relativeDeviationMultiple: number | null;
  classification: DislocationClassification | null;
  /** null exactly when maturity !== "MATURE" — no episode can be evaluated without a mature baseline. */
  episode: DislocationEpisodeViewModel | null;
}

/**
 * Convert the domain TickerIntelligence (which uses real `Date` objects)
 * into a JSON-safe view model for the API response. Pure relabeling/
 * serialization — no statistical logic lives here, matching the same
 * convention src/snapshot/serialize.ts already established for DataPoint.
 */
export function toIntelligenceDetailViewModel(intelligence: TickerIntelligence): IntelligenceDetailViewModel {
  const baseline: HistoricalBaselineViewModel = {
    observationCount: intelligence.baseline.observationCount,
    baselineStartAt: intelligence.baseline.baselineStartAt ? intelligence.baseline.baselineStartAt.toISOString() : null,
    baselineEndAt: intelligence.baseline.baselineEndAt ? intelligence.baseline.baselineEndAt.toISOString() : null,
    medianPct: intelligence.baseline.medianPct,
    typicalAbsDeviationFromParityPct: intelligence.baseline.typicalAbsDeviationFromParityPct,
    dispersionMad: intelligence.baseline.dispersionMad,
    elapsedHours: intelligence.baseline.elapsedHours,
    excludedByFreshnessCount: intelligence.baseline.excludedByFreshnessCount,
  };

  if (intelligence.maturity !== "MATURE") {
    return {
      maturity: intelligence.maturity,
      baseline,
      currentPremiumDiscountPct: intelligence.currentPremiumDiscountPct,
      currentAbsDeviationFromParityPct: intelligence.currentAbsDeviationFromParityPct,
      relativeDeviationMultiple: null,
      classification: null,
      episode: null,
    };
  }

  const episode: DislocationEpisodeViewModel =
    intelligence.episode.state === "active"
      ? {
          state: "active",
          dislocationStartedAt: intelligence.episode.dislocationStartedAt.toISOString(),
          durationMinutes: intelligence.episode.durationMinutes,
          consecutiveAbnormalObservations: intelligence.episode.consecutiveAbnormalObservations,
          peakAbsoluteDeviationPct: intelligence.episode.peakAbsoluteDeviationPct,
        }
      : { state: intelligence.episode.state };

  return {
    maturity: "MATURE",
    baseline,
    currentPremiumDiscountPct: intelligence.currentPremiumDiscountPct,
    currentAbsDeviationFromParityPct: intelligence.currentAbsDeviationFromParityPct,
    relativeDeviationMultiple: intelligence.relativeDeviationMultiple,
    classification: intelligence.classification,
    episode,
  };
}
