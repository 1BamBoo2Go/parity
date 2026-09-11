import type { TickerSnapshotRecord } from "../snapshot/types.js";
import { evaluateIntelligenceEligibility } from "./eligibility.js";
import { median, medianAbsoluteDeviation, medianAbsoluteFromZero } from "./robustStats.js";
import type { HistoricalBaseline } from "./types.js";

interface EligibleObservation {
  capturedAt: Date;
  pct: number;
}

/**
 * Partition a ticker's full record history into (a) eligible observations
 * usable for statistics, and (b) a count of records that were EXCLUDED
 * ONLY by P3's freshness rule (diagnostic — see HistoricalBaseline's
 * excludedByFreshnessCount). Records P2 already considered unhealthy for
 * any other reason are simply not eligible; they are not counted here.
 */
function partitionEligibility(records: TickerSnapshotRecord[]): {
  eligible: EligibleObservation[];
  excludedByFreshnessCount: number;
} {
  const eligible: EligibleObservation[] = [];
  let excludedByFreshnessCount = 0;

  for (const record of records) {
    const result = evaluateIntelligenceEligibility(record);
    if (result.eligible) {
      // Guaranteed present: eligibility requires P2 healthy_current, which
      // itself requires premiumDiscountPct.status === "ok".
      if (record.premiumDiscountPct.status === "ok") {
        eligible.push({ capturedAt: new Date(record.capturedAt), pct: record.premiumDiscountPct.value });
      }
    } else if (result.reason === "p3_reference_too_old") {
      excludedByFreshnessCount++;
    }
    // result.reason === "p2_unhealthy" -> not counted anywhere; never eligible in the first place.
  }

  eligible.sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  return { eligible, excludedByFreshnessCount };
}

/**
 * Compute the historical baseline from a ticker's FULL record history
 * (every record ever captured, valid or not — this function does its own
 * eligibility filtering via evaluateIntelligenceEligibility, so callers
 * should not pre-filter). No interpolation, no gap-filling: the baseline
 * is built strictly from whatever eligible observations actually exist.
 */
export function computeHistoricalBaseline(records: TickerSnapshotRecord[]): HistoricalBaseline {
  const { eligible, excludedByFreshnessCount } = partitionEligibility(records);

  if (eligible.length === 0) {
    return {
      observationCount: 0,
      baselineStartAt: null,
      baselineEndAt: null,
      medianPct: null,
      typicalAbsDeviationFromParityPct: null,
      dispersionMad: null,
      elapsedHours: 0,
      excludedByFreshnessCount,
    };
  }

  const values = eligible.map((o) => o.pct);
  const medianPct = median(values);

  const startAt = eligible[0]!.capturedAt;
  const endAt = eligible[eligible.length - 1]!.capturedAt;
  const elapsedHours = (endAt.getTime() - startAt.getTime()) / (1000 * 60 * 60);

  return {
    observationCount: eligible.length,
    baselineStartAt: startAt,
    baselineEndAt: endAt,
    medianPct,
    typicalAbsDeviationFromParityPct: medianAbsoluteFromZero(values),
    dispersionMad: medianAbsoluteDeviation(values, medianPct),
    elapsedHours,
    excludedByFreshnessCount,
  };
}
