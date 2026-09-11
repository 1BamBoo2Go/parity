import { MIN_OBSERVATIONS_FOR_ANY_BASELINE, MIN_ELAPSED_HOURS_FOR_ANY_BASELINE, MATURE_MIN_OBSERVATIONS, MATURE_MIN_ELAPSED_HOURS } from "./thresholds.js";
import type { BaselineMaturity, HistoricalBaseline } from "./types.js";

/**
 * Three-tier maturity gate. See thresholds.ts for the full justification
 * of each number. Both observation count and elapsed hours must
 * independently clear the relevant floor at every tier — a burst of
 * closely-clustered observations should not count as "mature" by volume
 * alone, and a long elapsed span with too few observations should not
 * count either.
 */
export function classifyMaturity(baseline: HistoricalBaseline): BaselineMaturity {
  if (baseline.observationCount < MIN_OBSERVATIONS_FOR_ANY_BASELINE || baseline.elapsedHours < MIN_ELAPSED_HOURS_FOR_ANY_BASELINE) {
    return "INSUFFICIENT_DATA";
  }
  if (baseline.observationCount >= MATURE_MIN_OBSERVATIONS && baseline.elapsedHours >= MATURE_MIN_ELAPSED_HOURS) {
    return "MATURE";
  }
  return "DEVELOPING";
}
