import type { CaptureRunResult } from "../snapshot/captureRun.js";
import type { SnapshotReaderOptions } from "../readmodel/snapshotReader.js";
import { getRiskViewModel } from "../readmodel/dashboardReadModel.js";
import { processRiskForAlerts } from "./processRiskForAlerts.js";
import type { AlertStateStoreOptions } from "./alertStateStore.js";
import type { AlertEvent } from "./types.js";

/**
 * P5-B3 — wires the already-proven P5-B1 evaluator and P5-B2 coordinator
 * to real snapshot-collection results.
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
 *   -> a later transport layer (not built in this slice) would consume
 *      the AlertEvent objects this module surfaces.
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
 */

export interface ProcessedAlertOutcome {
  symbol: string;
  event: AlertEvent | null;
}

export interface AlertProcessingFailure {
  symbol: string;
  error: string;
}

export interface ProcessCaptureRunForAlertsResult {
  processed: ProcessedAlertOutcome[];
  failures: AlertProcessingFailure[];
}

export interface ProcessCaptureRunForAlertsOptions {
  readerOptions?: SnapshotReaderOptions;
  alertStateOptions?: AlertStateStoreOptions;
}

/** `PARITY_ALERT_EVENT <json>` — one line, deterministic, easy for a later transport layer to grep/parse/test. Carries the canonical AlertEvent only; no transport-specific formatting. */
export function formatAlertEventLogLine(event: AlertEvent): string {
  return `PARITY_ALERT_EVENT ${JSON.stringify(event)}`;
}

/** Side-effecting wrapper around formatAlertEventLogLine — kept separate so the format itself stays independently testable without capturing stdout. */
export function logAlertEvent(event: AlertEvent): void {
  console.log(formatAlertEventLogLine(event));
}

export function processCaptureRunForAlerts(
  captureResult: CaptureRunResult,
  options: ProcessCaptureRunForAlertsOptions = {},
): ProcessCaptureRunForAlertsResult {
  const processed: ProcessedAlertOutcome[] = [];
  const failures: AlertProcessingFailure[] = [];

  // ONLY successfully, durably-persisted records — never tickerErrors.
  for (const record of captureResult.tickerRecords) {
    const symbol = record.ticker;
    try {
      const riskResult = getRiskViewModel(symbol, options.readerOptions);
      if (riskResult.kind !== "ok") {
        // A record was just written for this exact symbol, so this
        // branch is not expected in practice — handled explicitly and
        // honestly rather than assumed unreachable. No event is
        // fabricated either way.
        failures.push({ symbol, error: `risk view model unavailable immediately after a successful capture (${riskResult.kind})` });
        continue;
      }

      const alertResult = processRiskForAlerts(riskResult.risk, options.alertStateOptions);
      if (alertResult.event) {
        logAlertEvent(alertResult.event);
      }
      processed.push({ symbol, event: alertResult.event });
    } catch (err) {
      // Includes AlertStateCorruptionError (fail-closed, P5-B2) and any
      // other unexpected failure. Recorded, never silently swallowed,
      // never used to fabricate a fake event, and never allowed to stop
      // the remaining symbols from being attempted.
      failures.push({ symbol, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { processed, failures };
}
