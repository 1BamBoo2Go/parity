import type { TickerSnapshotRecord } from "../snapshot/types.js";
import { evaluateIntelligenceEligibility } from "./eligibility.js";
import { classifyCurrentDislocation } from "./classification.js";
import { MAX_OBSERVATION_GAP_MINUTES } from "./thresholds.js";
import type { DislocationEpisode, HistoricalBaseline } from "./types.js";

/**
 * Walk a ticker's full, chronologically-ordered history BACKWARD from the
 * most recent record to determine whether — and for how long — the
 * CURRENT abnormal condition (if any) has persisted.
 *
 * Three independent things can break continuity at any step, per the P3
 * design amendment (Revision 2):
 *   1. A temporal gap: the timestamp delta between two ADJACENT REAL
 *      records exceeds MAX_OBSERVATION_GAP_MINUTES — this is what catches
 *      a genuinely missing capture window (the collector was down), not
 *      just an explicit invalid-status record. Checked first, and applies
 *      regardless of whether the earlier record would otherwise have been
 *      individually valid.
 *   2. The earlier record is not intelligence-eligible (fails P2's
 *      healthy_current OR P3's freshness rule) — we cannot attest to
 *      continuity through a record we don't trust.
 *   3. The earlier record IS eligible, but classifies NORMAL — this is an
 *      ordinary episode boundary, not a data-quality problem.
 *
 * Never bridges across a gap or an ineligible record as though continuity
 * were proven — per explicit instruction, absence of evidence is reported
 * honestly, never assumed away.
 *
 * `sortedRecords` must be the ticker's FULL history (not pre-filtered),
 * oldest first. `baseline` must already be MATURE (callers are
 * responsible for the maturity gate, same convention as classification.ts).
 */
export function computePersistenceEpisode(sortedRecords: TickerSnapshotRecord[], baseline: HistoricalBaseline): DislocationEpisode {
  if (sortedRecords.length === 0) {
    return { state: "current_observation_unavailable" };
  }

  const currentRecord = sortedRecords[sortedRecords.length - 1]!;
  const currentEligibility = evaluateIntelligenceEligibility(currentRecord);
  if (!currentEligibility.eligible || currentRecord.premiumDiscountPct.status !== "ok") {
    return { state: "current_observation_unavailable" };
  }

  const currentPct = currentRecord.premiumDiscountPct.value;
  const currentClassification = classifyCurrentDislocation(currentPct, baseline).classification;
  if (currentClassification === "NORMAL") {
    return { state: "no_active_episode" };
  }

  // An active abnormal episode exists as of the current record. Walk
  // backward to find where it started.
  let episodeStartRecord = currentRecord;
  let consecutiveAbnormalObservations = 1;
  let peakAbsoluteDeviationPct = Math.abs(currentPct);

  let cursor = sortedRecords.length - 1;
  while (cursor > 0) {
    const laterRecord = sortedRecords[cursor]!;
    const earlierRecord = sortedRecords[cursor - 1]!;

    const deltaMinutes = (new Date(laterRecord.capturedAt).getTime() - new Date(earlierRecord.capturedAt).getTime()) / 60000;
    if (deltaMinutes > MAX_OBSERVATION_GAP_MINUTES) {
      break; // a genuinely missing capture window — do not bridge across it
    }

    const earlierEligibility = evaluateIntelligenceEligibility(earlierRecord);
    if (!earlierEligibility.eligible || earlierRecord.premiumDiscountPct.status !== "ok") {
      break; // cannot attest to continuity through a record we don't trust
    }

    const earlierPct = earlierRecord.premiumDiscountPct.value;
    const earlierClassification = classifyCurrentDislocation(earlierPct, baseline).classification;
    if (earlierClassification === "NORMAL") {
      break; // ordinary episode boundary
    }

    // Continues the episode.
    episodeStartRecord = earlierRecord;
    consecutiveAbnormalObservations++;
    peakAbsoluteDeviationPct = Math.max(peakAbsoluteDeviationPct, Math.abs(earlierPct));
    cursor--;
  }

  const dislocationStartedAt = new Date(episodeStartRecord.capturedAt);
  const durationMinutes = (new Date(currentRecord.capturedAt).getTime() - dislocationStartedAt.getTime()) / 60000;

  return {
    state: "active",
    dislocationStartedAt,
    durationMinutes,
    consecutiveAbnormalObservations,
    peakAbsoluteDeviationPct,
  };
}
