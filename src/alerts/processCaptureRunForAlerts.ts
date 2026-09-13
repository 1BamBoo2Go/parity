import type { CaptureRunResult } from "../snapshot/captureRun.js";
import type { SnapshotReaderOptions } from "../readmodel/snapshotReader.js";
import { getRiskViewModel } from "../readmodel/dashboardReadModel.js";
import { processRiskForAlerts } from "./processRiskForAlerts.js";
import type { AlertStateStoreOptions } from "./alertStateStore.js";
import type { AlertEvent } from "./types.js";

/**
 * P5-B3/P5-B4 — wires the already-proven P5-B1 evaluator and P5-B2
 * coordinator to real snapshot-collection results, through a
 * transport-neutral delivery boundary.
 *
 * LAYER SEPARATION (unchanged from P5-B1/P5-B2, not merged):
 *   captureRun() (collector, unmodified)
 *     -> ONLY result.tickerRecords is read here — never tickerErrors.
 *        This is the ordering guarantee, enforced structurally rather
 *        than by a runtime check: captureRun() only pushes a record into
 *        tickerRecords AFTER appendJsonLine() has returned successfully
 *        (see src/snapshot/captureRun.ts) — a ticker that failed
 *        collection OR failed to durably persist is in tickerErrors
 *        instead, and this module never even sees it as a candidate for
 *        alert processing.
 *   -> getRiskViewModel() (P5-A2's existing canonical read-model path,
 *      unmodified) re-reads the just-written history fresh from disk and
 *      calls buildTickerIntelligence() exactly once, same as every other
 *      RiskViewModel consumer. No intelligence recomputation happens here.
 *   -> processRiskForAlerts() (P5-B2, unmodified) handles all
 *      dedup/ordering/persistence.
 *   -> evaluateAlertTransition() (P5-B1, unmodified, called from inside
 *      processRiskForAlerts) makes the actual alert decision.
 *   -> deliver() (P5-B4, NEW) — the transport-neutral delivery boundary.
 *      This module (and the collector above it) knows nothing about
 *      Discord, webhooks, or any future transport; it only knows it has
 *      an AlertEvent and a function that promises to deliver it.
 *
 * P5-B4 AUDIT FINDING — why a boundary was introduced here specifically:
 * before this slice, `logAlertEvent(alertResult.event)` was called
 * directly, inline, hard-wired to console.log, with no injection point at
 * all. That is a real coupling point: any future transport (P5-B5's
 * Discord adapter) would have had to either replace this call site
 * directly (entangling collector code with transport specifics) or wrap
 * the whole pipeline a second time. A single injectable async function
 * removes that coupling with no new framework, no event bus, no queue —
 * exactly the "minimum abstraction actually justified" the audit asked
 * for. The existing PARITY_ALERT_EVENT structured log is preserved
 * UNCHANGED as the DEFAULT delivery implementation (see
 * defaultAlertDelivery below) — there are not two competing event-output
 * paths; logging IS the current delivery mechanism, just now reachable
 * through one seam instead of a hardcoded call.
 *
 * FAILURE ISOLATION: each successfully-captured ticker is processed
 * independently. A failure processing one symbol's alert state (most
 * plausibly AlertStateCorruptionError, but handled generically) is
 * recorded and does NOT stop the remaining symbols from being attempted,
 * mirroring captureRun()'s own per-ticker isolation philosophy exactly.
 * Nothing in this module can retroactively affect an already-durably
 * -written snapshot — by the time this function runs, every record in
 * tickerRecords is already committed to disk; there is no "undo" path
 * here even in principle.
 *
 * DELIVERY-FAILURE SEMANTICS — IMPORTANT, READ BEFORE CHANGING:
 * processRiskForAlerts() (P5-B2) already durably persists the new
 * lastEvaluatedCapturedAt/lastClassification INSIDE itself, before it
 * returns — this was true before P5-B4 and is deliberately NOT changed
 * here. That means by the time deliver() is even called, alert state for
 * this symbol has ALREADY advanced. A delivery failure is therefore
 * reported (failures[], stage: "delivery") but:
 *   - does NOT roll back or regress the already-written alert state
 *   - does NOT touch the already-durably-written snapshot
 *   - does NOT fabricate a second/different canonical transition
 *   - does NOT retry
 * KNOWN, ACCEPTED LIMITATION (explicitly not solved in this slice): if
 * delivery fails after state has advanced, the event is not recoverable
 * by simply replaying the same snapshot later — processRiskForAlerts()
 * will correctly treat that exact capturedAt as already-evaluated
 * (P5-B2's dedup rule) and will not regenerate the event. Durable
 * delivery/outbox semantics (persist "pending delivery" separately from
 * "evaluated", retry failed deliveries) are a legitimate LATER concern,
 * deliberately deferred rather than built prematurely here.
 */

export type AlertDelivery = (event: Readonly<AlertEvent>) => Promise<void>;

/** The default delivery implementation: exactly the P5-B3 structured log, unchanged. */
export const defaultAlertDelivery: AlertDelivery = async (event) => {
  logAlertEvent(event);
};

/**
 * Shallow-freezes the event and its one nested object (episode), so a
 * delivery implementation structurally cannot mutate the canonical event
 * it was handed — enforced by the runtime, not merely documented.
 */
function freezeAlertEvent(event: AlertEvent): Readonly<AlertEvent> {
  if (event.episode) {
    Object.freeze(event.episode);
  }
  return Object.freeze(event);
}

export interface ProcessedAlertOutcome {
  symbol: string;
  event: AlertEvent | null;
}

export interface AlertProcessingFailure {
  symbol: string;
  error: string;
  /**
   * "alert_processing": the failure happened before any event was
   * decided — for state-corruption failures specifically, alert state
   * was NOT advanced this run for this symbol (readAlertState throws
   * before processRiskForAlerts ever reaches writeAlertState).
   * "delivery": an event was already decided AND alert state was already
   * durably persisted (see module doc's DELIVERY-FAILURE SEMANTICS) —
   * only the delivery attempt itself failed.
   */
  stage: "alert_processing" | "delivery";
}

export interface ProcessCaptureRunForAlertsResult {
  processed: ProcessedAlertOutcome[];
  failures: AlertProcessingFailure[];
}

export interface ProcessCaptureRunForAlertsOptions {
  readerOptions?: SnapshotReaderOptions;
  alertStateOptions?: AlertStateStoreOptions;
  /** Defaults to defaultAlertDelivery (the existing PARITY_ALERT_EVENT structured log). Injected so tests — and later transports — can supply a different implementation without touching this module. */
  deliver?: AlertDelivery;
}

/** `PARITY_ALERT_EVENT <json>` — one line, deterministic, easy for a later transport layer to grep/parse/test. Carries the canonical AlertEvent only; no transport-specific formatting. */
export function formatAlertEventLogLine(event: AlertEvent): string {
  return `PARITY_ALERT_EVENT ${JSON.stringify(event)}`;
}

/** Side-effecting wrapper around formatAlertEventLogLine — kept separate so the format itself stays independently testable without capturing stdout. */
export function logAlertEvent(event: AlertEvent): void {
  console.log(formatAlertEventLogLine(event));
}

export async function processCaptureRunForAlerts(
  captureResult: CaptureRunResult,
  options: ProcessCaptureRunForAlertsOptions = {},
): Promise<ProcessCaptureRunForAlertsResult> {
  const deliver = options.deliver ?? defaultAlertDelivery;
  const processed: ProcessedAlertOutcome[] = [];
  const failures: AlertProcessingFailure[] = [];

  // ONLY successfully, durably-persisted records — never tickerErrors.
  for (const record of captureResult.tickerRecords) {
    const symbol = record.ticker;
    let alertResult;
    try {
      const riskResult = getRiskViewModel(symbol, options.readerOptions);
      if (riskResult.kind !== "ok") {
        // A record was just written for this exact symbol, so this
        // branch is not expected in practice — handled explicitly and
        // honestly rather than assumed unreachable. No event is
        // fabricated either way.
        failures.push({ symbol, error: `risk view model unavailable immediately after a successful capture (${riskResult.kind})`, stage: "alert_processing" });
        continue;
      }
      alertResult = processRiskForAlerts(riskResult.risk, options.alertStateOptions);
    } catch (err) {
      // Includes AlertStateCorruptionError (fail-closed, P5-B2) and any
      // other unexpected failure. Recorded, never silently swallowed,
      // never used to fabricate a fake event, and never allowed to stop
      // the remaining symbols from being attempted. Alert state was NOT
      // advanced this run for this symbol — the throw happened before
      // processRiskForAlerts could reach its own writeAlertState call.
      failures.push({ symbol, error: err instanceof Error ? err.message : String(err), stage: "alert_processing" });
      continue;
    }

    processed.push({ symbol, event: alertResult.event });

    if (alertResult.event) {
      const frozen = freezeAlertEvent(alertResult.event);
      try {
        await deliver(frozen);
      } catch (err) {
        // Delivery-only failure — see module doc's DELIVERY-FAILURE
        // SEMANTICS. Alert state was ALREADY durably advanced before this
        // point (inside processRiskForAlerts, unchanged from P5-B2); this
        // catch cannot and does not roll that back, does not touch the
        // snapshot, and does not fabricate a replacement event.
        failures.push({ symbol, error: `delivery failed: ${err instanceof Error ? err.message : String(err)}`, stage: "delivery" });
      }
    }
  }

  return { processed, failures };
}
