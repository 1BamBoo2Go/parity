import { classifyOverallStatus } from "../readmodel/fieldStatus.js";
import type { TickerSnapshotRecord } from "../snapshot/types.js";
import { INTELLIGENCE_MAX_REFERENCE_AGE_MINUTES } from "./thresholds.js";

/**
 * How old the Chainlink reference was AT THE MOMENT this specific snapshot
 * was captured — computed entirely from two already-persisted fields
 * (`capturedAt` and `chainlinkReference.value.updatedAt`). Returns `null`
 * when the reference wasn't `ok` at all (nothing to measure the age of).
 *
 * This is independent of "now" (the wall-clock time intelligence happens
 * to be computed) — for a historical record, age is a fixed property of
 * that record, not something that grows as time passes after the fact.
 */
export function referenceAgeAtCaptureMinutes(record: TickerSnapshotRecord): number | null {
  if (record.chainlinkReference.status !== "ok") {
    return null;
  }
  const capturedAtMs = new Date(record.capturedAt).getTime();
  const updatedAtMs = new Date(record.chainlinkReference.value.updatedAt).getTime();
  if (!Number.isFinite(capturedAtMs) || !Number.isFinite(updatedAtMs)) {
    return null;
  }
  return (capturedAtMs - updatedAtMs) / 60000;
}

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: "p2_unhealthy" }
  | { eligible: false; reason: "p3_reference_too_old"; ageMinutes: number };

/**
 * The single, shared definition of "valid observation" for every purpose
 * inside src/intelligence/ (baseline construction, current classification,
 * and persistence walking alike) — per the P3 design amendment's explicit
 * confirmation that using a looser standard for "today's reading" than for
 * the baseline it's judged against would itself be an inconsistent
 * yardstick.
 *
 * P2's classifyOverallStatus() === "healthy_current" is NECESSARY but not
 * SUFFICIENT: this additionally requires the reference to have been fresh
 * enough, AT CAPTURE TIME, for P3's own stricter statistical purposes —
 * without touching P0's `isStale()` or `buildParitySnapshot()` at all.
 *
 * Returns a discriminated result (not a bare boolean) specifically so
 * callers — in particular HistoricalBaseline's `excludedByFreshnessCount`
 * — can distinguish "excluded because P2 already considered it unhealthy"
 * from "excluded ONLY because of P3's additional freshness rule," per the
 * explicit diagnostic requirement that the two must never be conflated.
 */
export function evaluateIntelligenceEligibility(record: TickerSnapshotRecord): EligibilityResult {
  if (classifyOverallStatus(record) !== "healthy_current") {
    return { eligible: false, reason: "p2_unhealthy" };
  }
  const ageMinutes = referenceAgeAtCaptureMinutes(record);
  // ageMinutes is guaranteed non-null here: healthy_current requires
  // chainlinkReference.status === "ok" (see classifyOverallStatus), so
  // referenceAgeAtCaptureMinutes cannot return null in this branch. The
  // fallback below exists only as a defensive, never-expected-to-fire
  // guard, not a real code path.
  if (ageMinutes === null) {
    return { eligible: false, reason: "p2_unhealthy" };
  }
  if (ageMinutes > INTELLIGENCE_MAX_REFERENCE_AGE_MINUTES) {
    return { eligible: false, reason: "p3_reference_too_old", ageMinutes };
  }
  return { eligible: true };
}

/** Convenience boolean wrapper for call sites that don't need the exclusion reason. */
export function isEligibleForIntelligence(record: TickerSnapshotRecord): boolean {
  return evaluateIntelligenceEligibility(record).eligible;
}
