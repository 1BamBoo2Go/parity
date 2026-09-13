import type { DislocationClassification } from "../intelligence/types.js";

/**
 * P5-B1 — the alert-event contract.
 *
 * This is deliberately a NEW, small, alert-specific type — not a fourth
 * variant bolted onto TickerIntelligence or RiskViewModel. It exists only
 * to describe "a classification transition occurred," and carries no
 * field this module itself computed: every value here is copied verbatim
 * from an already-computed RiskViewModel (see evaluateAlertTransition.ts).
 */
export type AlertEventType = "new_risk" | "escalation" | "recovery";

export interface AlertEpisodeContext {
  startedAt: string | null;
  durationMinutes: number | null;
  consecutiveObservations: number | null;
  peakAbsDeviationPct: number | null;
}

export interface AlertEvent {
  eventType: AlertEventType;
  symbol: string;
  /** The REAL current record's own capture time, copied from RiskViewModel.capturedAt — never Date.now(). */
  occurredAt: string;
  previousClassification: DislocationClassification;
  currentClassification: DislocationClassification;
  deviationPct: number | null;
  absDeviationPct: number | null;
  madMultiple: number | null;
  episode: AlertEpisodeContext | null;
}
