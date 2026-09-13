import { getSupportedSnapshotTickers } from "../snapshot/supportedTickers.js";
import { readTickerHistory, type SnapshotReaderOptions } from "./snapshotReader.js";
import { buildTickerSummary, buildTickerDetail, buildTickerHistory } from "./buildViewModels.js";
import { classifyOverallStatus } from "./fieldStatus.js";
import { buildTickerIntelligence } from "../intelligence/buildTickerIntelligence.js";
import { toRiskProjection, type RiskViewModel } from "./riskViewModel.js";
import type { TickerSummaryViewModel, TickerDetailViewModel, TickerHistoryViewModel } from "./viewModels.js";

/**
 * The supported-ticker list is read directly from config via the same
 * function Slice P1.2b's capture pipeline uses — there is exactly one
 * place in this codebase that decides which tickers are supported, and
 * this is not a second one. If a ticker is ever promoted or demoted in
 * config, this list (and therefore the dashboard) picks it up automatically.
 */
export function getSupportedTickerSymbols(options: SnapshotReaderOptions = {}): string[] {
  void options; // reserved for future use (e.g. per-environment overrides); unused today, kept explicit rather than an unused-parameter lint suppression
  return getSupportedSnapshotTickers().map((t) => t.symbol);
}

export function getGridViewModel(options: SnapshotReaderOptions = {}): TickerSummaryViewModel[] {
  const symbols = getSupportedTickerSymbols();
  return symbols.map((symbol) => {
    const history = readTickerHistory(symbol, options);
    const latest = history.length > 0 ? history[history.length - 1]! : null;
    return buildTickerSummary(symbol, latest, history);
  });
}

export type DetailResult = { kind: "ok"; detail: TickerDetailViewModel } | { kind: "unsupported_ticker" };

export function getDetailViewModel(symbol: string, options: SnapshotReaderOptions = {}): DetailResult {
  const symbols = getSupportedTickerSymbols();
  if (!symbols.includes(symbol)) {
    return { kind: "unsupported_ticker" };
  }
  const history = readTickerHistory(symbol, options);
  const latest = history.length > 0 ? history[history.length - 1]! : null;
  return { kind: "ok", detail: buildTickerDetail(symbol, latest, history) };
}

export type HistoryResult = { kind: "ok"; history: TickerHistoryViewModel } | { kind: "unsupported_ticker" };

export function getHistoryViewModelFor(symbol: string, limit: number, options: SnapshotReaderOptions = {}): HistoryResult {
  const symbols = getSupportedTickerSymbols();
  if (!symbols.includes(symbol)) {
    return { kind: "unsupported_ticker" };
  }
  const records = readTickerHistory(symbol, { ...options, limit });
  return { kind: "ok", history: buildTickerHistory(symbol, records) };
}

/**
 * P5-A2 — the external Risk API's read model.
 *
 * Reuses exactly the same building blocks getDetailViewModel already
 * uses (getSupportedTickerSymbols for validation, readTickerHistory for
 * the persisted series) and calls buildTickerIntelligence — the ONE
 * canonical intelligence computation — exactly once. No new data-loading
 * path, no second/parallel intelligence computation.
 *
 * Dependency flow: persisted history/current record -> buildTickerIntelligence
 * (canonical, unchanged) -> toRiskProjection (P5-A1, unchanged) -> caller
 * (the new HTTP route added in src/web/server.ts).
 *
 * Distinguishes THREE outcomes, not two — found during this slice's own
 * architecture audit: a symbol can be genuinely SUPPORTED (present in
 * config, tracked by the collector) while having ZERO captured history
 * yet (a brand-new ticker promotion, before its first 15-minute capture
 * has ever run). classifyOverallStatus() requires a real
 * TickerSnapshotRecord and has no defined behaviour for "no record" —
 * the existing dashboard read model handles this by special-casing
 * `overallStatus: "no_data_yet"` OUTSIDE the OverallTickerStatus enum
 * entirely (see buildViewModels.ts, viewModels.ts). RiskViewModel's
 * referenceStatus field is typed as exactly OverallTickerStatus (no
 * "no_data_yet" escape hatch — see riskViewModel.ts), so this case
 * cannot be honestly represented as a normal "ok" risk response, and
 * must not be silently reported as "unsupported_ticker" either — the
 * ticker IS supported, it simply has no observation yet. It is currently
 * unreachable for all six production tickers (each already has
 * accumulating real history), but the code path exists and must not
 * fabricate a referenceStatus/capturedAt to paper over it.
 */
export type RiskResult =
  | { kind: "ok"; risk: RiskViewModel }
  | { kind: "unsupported_ticker" }
  | { kind: "no_data_yet" };

export function getRiskViewModel(symbol: string, options: SnapshotReaderOptions = {}): RiskResult {
  const symbols = getSupportedTickerSymbols();
  if (!symbols.includes(symbol)) {
    return { kind: "unsupported_ticker" };
  }
  const history = readTickerHistory(symbol, options);
  const latest = history.length > 0 ? history[history.length - 1]! : null;
  if (!latest) {
    return { kind: "no_data_yet" };
  }

  // The ONE canonical intelligence computation — called exactly once here.
  const intelligence = buildTickerIntelligence(symbol, history);
  const referenceStatus = classifyOverallStatus(latest);
  // The REAL current record's own capture time — never derived from
  // baseline.baselineEndAt (which reflects the latest ELIGIBLE
  // observation, not necessarily "now," and would be actively misleading
  // whenever the current record itself is ineligible).
  const capturedAt = new Date(latest.capturedAt);

  const risk = toRiskProjection({ symbol, intelligence, capturedAt, referenceStatus });
  return { kind: "ok", risk };
}
