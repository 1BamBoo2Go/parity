import { relativeDeviationMultiple as computeRelativeDeviationMultiple } from "./robustStats.js";
import { CLASSIFICATION_THRESHOLDS, MAD_FLOOR_PCT } from "./thresholds.js";
import type { DislocationClassification, HistoricalBaseline } from "./types.js";

export interface ClassificationResult {
  currentAbsDeviationFromParityPct: number;
  relativeDeviationMultiple: number;
  classification: DislocationClassification;
}

/**
 * Floating-point tolerance for threshold comparisons. Real division of
 * real decimal percentages (e.g. 0.35 / 0.1) does not always land on the
 * exact IEEE754 value you'd expect — 0.35/0.1 evaluates to
 * 3.4999999999999996 in standard double-precision arithmetic, not 3.5.
 * Without this tolerance, a genuinely-at-the-boundary observation could be
 * placed one tier lower than it should be, purely due to floating-point
 * representation error, not any real economic difference. This is a
 * numerical-robustness fix, not a threshold change.
 */
const COMPARISON_EPSILON = 1e-9;

function meetsOrExceeds(value: number, threshold: number): boolean {
  return value >= threshold - COMPARISON_EPSILON;
}

/**
 * Classify one current premium/discount reading against a MATURE baseline.
 * Callers are responsible for checking maturity themselves — this function
 * assumes `baseline.medianPct`/`dispersionMad` are non-null (guaranteed
 * true whenever observationCount > 0, which MATURE implies).
 *
 * Both the relative multiple AND the absolute floor must clear a tier's
 * threshold for that tier to apply — see thresholds.ts for the full
 * justification. Evaluated top-down (SEVERE first). Uses absolute values
 * throughout, so a positive premium and a negative discount of the same
 * magnitude classify identically (required sign symmetry) — the signed
 * value is preserved separately by the caller for presentation.
 */
export function classifyCurrentDislocation(currentPct: number, baseline: HistoricalBaseline): ClassificationResult {
  if (baseline.medianPct === null || baseline.dispersionMad === null) {
    throw new Error("Refusing to classify against a baseline with no computed median/MAD (observationCount === 0)");
  }

  const currentAbsDeviationFromParityPct = Math.abs(currentPct);
  const multiple = computeRelativeDeviationMultiple(currentPct, baseline.medianPct, baseline.dispersionMad, MAD_FLOOR_PCT);

  let classification: DislocationClassification = "NORMAL";
  if (meetsOrExceeds(multiple, CLASSIFICATION_THRESHOLDS.SEVERE.relativeMultiple) && meetsOrExceeds(currentAbsDeviationFromParityPct, CLASSIFICATION_THRESHOLDS.SEVERE.absFloorPct)) {
    classification = "SEVERE";
  } else if (
    meetsOrExceeds(multiple, CLASSIFICATION_THRESHOLDS.DISLOCATED.relativeMultiple) &&
    meetsOrExceeds(currentAbsDeviationFromParityPct, CLASSIFICATION_THRESHOLDS.DISLOCATED.absFloorPct)
  ) {
    classification = "DISLOCATED";
  } else if (
    meetsOrExceeds(multiple, CLASSIFICATION_THRESHOLDS.ELEVATED.relativeMultiple) &&
    meetsOrExceeds(currentAbsDeviationFromParityPct, CLASSIFICATION_THRESHOLDS.ELEVATED.absFloorPct)
  ) {
    classification = "ELEVATED";
  }

  return { currentAbsDeviationFromParityPct, relativeDeviationMultiple: multiple, classification };
}
