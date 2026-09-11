/**
 * Typed domain output for Slice P3 (Historical Baseline + Dislocation
 * Intelligence). Deliberately a discriminated union on `maturity` rather
 * than a single flat object with many nullable fields — the same
 * "the type system won't let you read a value that isn't there" discipline
 * src/domain/types.ts's DataPoint<T> already applies to individual fields,
 * applied here at the whole-object level.
 */

export type BaselineMaturity = "INSUFFICIENT_DATA" | "DEVELOPING" | "MATURE";

export type DislocationClassification = "NORMAL" | "ELEVATED" | "DISLOCATED" | "SEVERE";

export interface HistoricalBaseline {
  /** Count of observations that passed the FULL intelligence eligibility predicate (P2 healthy_current AND P3's <=360-minute freshness rule). This is the denominator behind every statistic below. */
  observationCount: number;
  baselineStartAt: Date | null; // null only when observationCount === 0
  baselineEndAt: Date | null;
  medianPct: number | null;
  typicalAbsDeviationFromParityPct: number | null;
  dispersionMad: number | null;
  elapsedHours: number; // 0 when observationCount === 0
  /**
   * DIAGNOSTIC ONLY — never used in classification/maturity logic itself.
   * Count of records that passed P2's healthy_current requirement but were
   * excluded ONLY because they failed P3's own, stricter reference-age
   * rule. Exists so a consumer investigating "why is this ticker stuck in
   * INSUFFICIENT_DATA/DEVELOPING" can tell whether it's short on raw valid
   * data (P2-side) or specifically losing otherwise-good points to P3's
   * additional freshness filter. Does NOT count records P2 already
   * considered unhealthy for other reasons (stale/paused/halted/
   * unavailable) — those were never eligible in the first place and are
   * not "excluded by freshness."
   */
  excludedByFreshnessCount: number;
}

export type DislocationEpisode =
  | { state: "no_active_episode" }
  | { state: "current_observation_unavailable" }
  | {
      state: "active";
      dislocationStartedAt: Date;
      durationMinutes: number;
      consecutiveAbnormalObservations: number;
      peakAbsoluteDeviationPct: number;
    };

/** The full, P4-facing intelligence object for one ticker. */
export type TickerIntelligence =
  | {
      symbol: string;
      maturity: "INSUFFICIENT_DATA";
      baseline: HistoricalBaseline;
      /** Exposed regardless of maturity — a raw fact about the current record, not a statistical claim about the baseline. Null exactly when the current observation is itself individually ineligible (see src/intelligence/eligibility.ts). */
      currentPremiumDiscountPct: number | null;
      currentAbsDeviationFromParityPct: number | null;
    }
  | {
      symbol: string;
      maturity: "DEVELOPING";
      baseline: HistoricalBaseline;
      currentPremiumDiscountPct: number | null;
      currentAbsDeviationFromParityPct: number | null;
    }
  | {
      symbol: string;
      maturity: "MATURE";
      baseline: HistoricalBaseline;
      currentPremiumDiscountPct: number | null; // null if current observation unavailable
      currentAbsDeviationFromParityPct: number | null;
      relativeDeviationMultiple: number | null;
      classification: DislocationClassification | null; // null exactly when currentPremiumDiscountPct is null
      episode: DislocationEpisode;
    };

/**
 * Compact projection of TickerIntelligence for the overview grid
 * (GET /api/tickers) — computed from the SAME TickerIntelligence object the
 * detail endpoint uses (see buildTickerIntelligence.ts / intelligenceSummary.ts),
 * never a second, duplicated statistical computation.
 */
export interface IntelligenceSummary {
  maturity: BaselineMaturity;
  observationCount: number;
  classification: DislocationClassification | null;
  relativeDeviationMultiple: number | null;
  episodeDurationMinutes: number | null;
  /** Pre-rendered, ready-to-display text, e.g. "SEVERE — 5.2x typical, persisting 45m", "Developing (42 observations)", "Insufficient data" — exists so the frontend needs no client-side logic beyond printing a string. */
  label: string;
}
