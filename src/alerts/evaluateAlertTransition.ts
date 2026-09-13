import type { DislocationClassification } from "../intelligence/types.js";
import type { RiskViewModel } from "../readmodel/riskViewModel.js";
import type { AlertEvent, AlertEventType } from "./types.js";

/**
 * P5-B1 — the canonical alert-decision engine.
 *
 * CORE RULE: this module computes NOTHING about market state. It
 * interprets already-produced intelligence only — specifically, two
 * already-computed RiskViewModel snapshots (P5-A1/P5-A2's own external
 * contract). It never reads TickerIntelligence, HistoricalBaseline, or
 * any src/intelligence/ internals directly, and never calls
 * buildTickerIntelligence, classifyCurrentDislocation,
 * evaluateIntelligenceEligibility, or computePersistenceEpisode.
 *
 * WHY RiskViewModel, not TickerIntelligence (see P5-B1 audit report for
 * the full comparison): RiskViewModel already exposes exactly the fields
 * an alert needs (classification, madMultiple, episode, the current
 * deviation, capturedAt), already JSON-safe (ISO-8601 strings, no Date
 * objects to re-convert), already flattened to just what's needed (no
 * internal baseline diagnostics), and already hardened/tested by P5-A3.
 * Introducing a second, parallel alert-only projection of raw
 * TickerIntelligence would be exactly the "separate risk thresholds /
 * duplicated computation" this slice is required to avoid.
 *
 * THE MATURE INVARIANT — audited, not re-derived: TickerIntelligence's
 * `classification` field exists ONLY on its MATURE union member (see
 * src/intelligence/types.ts — INSUFFICIENT_DATA and DEVELOPING have no
 * `classification` field at all, not even as null). RiskViewModel's
 * toRiskProjection() preserves this as a RUNTIME guarantee — it sets
 * `intelligence.classification` to `isMature ? intelligence.classification
 * : null` (src/readmodel/riskViewModel.ts). Therefore, wherever
 * `classification !== null` is observed on a RiskViewModel, the ticker
 * WAS MATURE at that capture — this module relies on that fact and
 * deliberately does NOT re-check `intelligence.maturity` anywhere below;
 * doing so would be exactly the duplicated maturity logic this slice is
 * required to avoid. The same reasoning applies to `episode`: it is
 * non-null on RiskViewModel exactly when maturity was MATURE (same
 * toRiskProjection construction), so every alert-worthy transition
 * (new_risk / escalation / recovery all require a non-null classification
 * on at least one side) is guaranteed to have a real episode object to
 * read from on the MATURE side.
 *
 * NULL / MISSING-PREVIOUS SEMANTICS: `previous` may be `null` — the very
 * first time a ticker is ever evaluated, there is no prior state to
 * compare against. This is treated identically to "previous classification
 * is null": per the explicit policy, we cannot distinguish a true
 * transition from merely resuming visibility after missing/ineligible
 * data, so no alert is produced. A single guard clause below handles
 * every null-involving case in the specified test matrix uniformly.
 */
export function evaluateAlertTransition(previous: RiskViewModel | null, current: RiskViewModel): AlertEvent | null {
  const prevClassification: DislocationClassification | null = previous?.intelligence.classification ?? null;
  const currClassification: DislocationClassification | null = current.intelligence.classification;

  // Any null on either side: never infer a transition across a gap in
  // canonical visibility. Covers null->abnormal, abnormal->null,
  // null->NORMAL, NORMAL->null, and null->null in one place.
  if (prevClassification === null || currClassification === null) {
    return null;
  }

  // Identical classification repeated: nothing changed.
  if (prevClassification === currClassification) {
    return null;
  }

  const eventType = classifyTransition(prevClassification, currClassification);
  if (eventType === null) {
    return null;
  }

  const episode = current.intelligence.episode;

  return {
    eventType,
    symbol: current.symbol.toUpperCase(),
    occurredAt: current.capturedAt,
    previousClassification: prevClassification,
    currentClassification: currClassification,
    deviationPct: current.deviation.currentPct,
    absDeviationPct: current.deviation.absDeviationPct,
    madMultiple: current.intelligence.madMultiple,
    episode: episode
      ? {
          startedAt: episode.startedAt,
          durationMinutes: episode.durationMinutes,
          consecutiveObservations: episode.consecutiveObservations,
          peakAbsDeviationPct: episode.peakAbsDeviationPct,
        }
      : null,
  };
}

// Ordinal severity, used ONLY to compare two already-canonical
// classifications against each other — this is not a new risk threshold,
// it is a fixed ranking over the four already-canonical enum values
// (src/intelligence/types.ts's DislocationClassification), needed purely
// to answer "did severity increase or decrease," never to decide
// classification itself.
const SEVERITY_ORDER: Record<DislocationClassification, number> = {
  NORMAL: 0,
  ELEVATED: 1,
  DISLOCATED: 2,
  SEVERE: 3,
};

function classifyTransition(prev: DislocationClassification, curr: DislocationClassification): AlertEventType | null {
  if (prev === "NORMAL") {
    // curr !== "NORMAL" here (equal case already handled by the caller) ->
    // NORMAL -> ELEVATED/DISLOCATED/SEVERE.
    return "new_risk";
  }
  if (curr === "NORMAL") {
    // prev !== "NORMAL" here -> ELEVATED/DISLOCATED/SEVERE -> NORMAL.
    return "recovery";
  }
  // Both sides are non-NORMAL and different from each other.
  if (SEVERITY_ORDER[curr] > SEVERITY_ORDER[prev]) {
    return "escalation";
  }
  // A downgrade between two abnormal tiers (e.g. SEVERE -> DISLOCATED).
  // Per explicit policy: prefer no event over inventing a downgrade
  // semantic not requested by this slice.
  return null;
}
