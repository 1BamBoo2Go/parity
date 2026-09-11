import type { SerializedDataPoint } from "../snapshot/serialize.js";
import type { TickerSnapshotRecord } from "../snapshot/types.js";

/**
 * Display status for a single field. This is a pure relabeling of the
 * already-computed `status`/`reason` values already present in a persisted
 * snapshot record (themselves produced by Slice P0/P1's already-tested
 * `buildParitySnapshot`) — no new staleness check, no new pause detection,
 * no new market logic of any kind is computed here. If the underlying
 * record says a reference price is stale, this module's only job is to
 * say so clearly, not to re-decide whether it's stale.
 */
export type FieldDisplayStatus = "ok" | "stale" | "paused" | "halted" | "unavailable";

export function classifyFieldStatus<T>(dp: SerializedDataPoint<T>): FieldDisplayStatus {
  if (dp.status === "ok") {
    return "ok";
  }
  switch (dp.reason) {
    case "stale":
      return "stale";
    case "oracle_paused":
      return "paused";
    case "trading_halt":
      return "halted";
    default:
      return "unavailable";
  }
}

/**
 * Overall, ticker-level status for the grid/detail views. A strict,
 * documented priority order over fields that are ALREADY present in the
 * record — this function makes no price or staleness determination of its
 * own; it only decides which already-known condition is most important to
 * surface first when more than one applies.
 *
 * Priority, highest first:
 *   1. stale reference    — the number the whole product is about is not current
 *   2. oracle paused       — an active corporate-action pause on the feed
 *   3. trading halt        — Robinhood's own halt flag
 *   4. upstream unavailable — any other required field failed to load
 *   5. healthy/current      — every required field loaded and is current
 *
 * "no_data_yet" is a separate, distinct case (no snapshot has ever been
 * captured for this ticker) — see buildTickerSummary.ts, which is the only
 * caller that can observe a genuinely absent record.
 */
export type OverallTickerStatus = "healthy_current" | "stale_reference" | "oracle_paused" | "trading_halt" | "upstream_unavailable";

export function classifyOverallStatus(record: TickerSnapshotRecord): OverallTickerStatus {
  if (record.chainlinkReference.status === "unavailable" && record.chainlinkReference.reason === "stale") {
    return "stale_reference";
  }
  if (record.oraclePaused.status === "ok" && record.oraclePaused.value === true) {
    return "oracle_paused";
  }
  if (record.robinhoodPrice.status === "ok" && record.robinhoodPrice.value.isTradingHalt === true) {
    return "trading_halt";
  }
  const requiredFields: SerializedDataPoint<unknown>[] = [
    record.robinhoodAssetStatus,
    record.robinhoodPrice,
    record.chainlinkReference,
    record.secondaryPrice,
    record.premiumDiscountPct,
  ];
  if (requiredFields.some((f) => f.status === "unavailable")) {
    return "upstream_unavailable";
  }
  return "healthy_current";
}

/** Human-readable label and a semantic color tag for each overall status — presentation only. */
export const OVERALL_STATUS_PRESENTATION: Record<
  OverallTickerStatus | "no_data_yet",
  { label: string; tone: "green" | "amber" | "red" | "gray" }
> = {
  healthy_current: { label: "Healthy / current", tone: "green" },
  stale_reference: { label: "Stale reference", tone: "amber" },
  oracle_paused: { label: "Oracle paused", tone: "amber" },
  trading_halt: { label: "Trading halt", tone: "amber" },
  upstream_unavailable: { label: "Upstream unavailable", tone: "red" },
  no_data_yet: { label: "No data yet", tone: "gray" },
};
