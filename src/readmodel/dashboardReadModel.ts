import { getSupportedSnapshotTickers } from "../snapshot/supportedTickers.js";
import { readTickerHistory, type SnapshotReaderOptions } from "./snapshotReader.js";
import { buildTickerSummary, buildTickerDetail, buildTickerHistory } from "./buildViewModels.js";
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
