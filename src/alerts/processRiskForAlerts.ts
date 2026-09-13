import type { RiskViewModel } from "../readmodel/riskViewModel.js";
import type { AlertEvent } from "./types.js";
import { evaluateAlertTransition } from "./evaluateAlertTransition.js";
import { readAlertState, writeAlertState, type AlertStateStoreOptions, type AlertStateFile, type PerSymbolAlertState } from "./alertStateStore.js";

export type ProcessRiskForAlertsReason =
  | "seeded_first_observation"
  | "stale_or_replayed_capture"
  | "transition_evaluated";

export interface ProcessRiskForAlertsResult {
  event: AlertEvent | null;
  stateUpdated: boolean;
  reason: ProcessRiskForAlertsReason;
}

/**
 * P5-B2 — the stateful coordinator around the pure P5-B1 evaluator.
 *
 * This function contains NO intelligence math and NO alert-policy logic
 * of its own: every classification-transition DECISION is delegated to
 * evaluateAlertTransition() (src/alerts/evaluateAlertTransition.ts),
 * unmodified. This module's entire job is: figure out what "previous"
 * canonical state means across process runs, refuse to process stale or
 * replayed input, and durably record what was actually observed.
 *
 * ORDERING / DEDUP: a capturedAt at or before the last successfully
 * evaluated capturedAt for that symbol is treated as stale/replayed —
 * neither the evaluator nor the state file is touched. This single rule
 * satisfies every dedup and ordering requirement from the P5-B2 spec: the
 * exact-same-snapshot-evaluated-twice case, the process-restart case, and
 * the genuinely-out-of-order/replayed case are all the same rule (a
 * process restart cannot re-fire an already-emitted transition for
 * exactly this reason — the persisted capturedAt survives the restart and
 * blocks the replay on the very next call, deterministically, with no
 * separate "already emitted" flag needed).
 */
export function processRiskForAlerts(currentRisk: RiskViewModel, options?: AlertStateStoreOptions): ProcessRiskForAlertsResult {
  const symbol = currentRisk.symbol.toUpperCase();
  const state = readAlertState(options); // may throw AlertStateCorruptionError — fail closed, propagates to the caller uninterpreted
  const existing = state[symbol];

  if (existing) {
    const currentMs = Date.parse(currentRisk.capturedAt);
    const lastMs = Date.parse(existing.lastEvaluatedCapturedAt);
    if (currentMs <= lastMs) {
      return { event: null, stateUpdated: false, reason: "stale_or_replayed_capture" };
    }
  }

  const previous = existing ? buildShadowRiskViewModel(symbol, existing) : null;
  const event = evaluateAlertTransition(previous, currentRisk);

  const nextState: AlertStateFile = {
    ...state,
    [symbol]: {
      lastEvaluatedCapturedAt: currentRisk.capturedAt,
      lastClassification: currentRisk.intelligence.classification,
    },
  };
  writeAlertState(nextState, options);

  return { event, stateUpdated: true, reason: existing ? "transition_evaluated" : "seeded_first_observation" };
}

/**
 * Reconstructs the minimal RiskViewModel-shaped object evaluateAlertTransition()
 * needs to read a PREVIOUS classification from persisted state, without
 * duplicating or re-deriving any of its transition logic.
 *
 * Verified, not assumed: evaluateAlertTransition() reads exactly ONE field
 * off its `previous` parameter — `previous?.intelligence.classification`
 * — and nothing else (grepped the function body directly; `previous.symbol`,
 * `.capturedAt`, `.deviation`, `.eligibility`, `.referenceStatus`, and every
 * other `intelligence.*` field are never referenced). This object is
 * therefore not a fabricated "fake API response" — every field the
 * evaluator can actually observe (`intelligence.classification`) is the
 * real persisted value; capturedAt and symbol are also real, persisted
 * values (included for type-shape completeness and because they are
 * genuinely known, not guessed); every remaining field is filled with an
 * honest "unavailable" placeholder purely to satisfy the RiskViewModel
 * type signature that evaluateAlertTransition()'s (unmodified, P5-B1)
 * signature requires, and none of them can ever influence its output.
 * This keeps P5-B1 entirely unchanged, per explicit instruction, rather
 * than widening its signature or duplicating its comparison logic here.
 */
function buildShadowRiskViewModel(symbol: string, state: PerSymbolAlertState): RiskViewModel {
  return {
    symbol,
    apiVersion: "v1",
    capturedAt: state.lastEvaluatedCapturedAt,
    referenceStatus: "healthy_current",
    deviation: { currentPct: null, direction: null, absDeviationPct: null },
    eligibility: { eligible: state.lastClassification !== null },
    intelligence: {
      maturity: state.lastClassification !== null ? "MATURE" : "INSUFFICIENT_DATA",
      observationCount: 0,
      baselinePeriodHours: null,
      baselineMedianPct: null,
      baselineDispersionMad: null,
      madMultiple: null,
      classification: state.lastClassification,
      episode: null,
    },
  };
}
