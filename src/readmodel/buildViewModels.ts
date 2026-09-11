import type { TickerSnapshotRecord } from "../snapshot/types.js";
import type { SerializedDataPoint } from "../snapshot/serialize.js";
import { classifyFieldStatus, classifyOverallStatus } from "./fieldStatus.js";
import { buildTickerIntelligence, toIntelligenceSummary } from "../intelligence/buildTickerIntelligence.js";
import { toIntelligenceDetailViewModel, type IntelligenceDetailViewModel } from "./intelligenceViewModel.js";
import type {
  DisplayField,
  HolderConcentrationDisplay,
  HistoryPoint,
  ProvenanceRow,
  TickerDetailViewModel,
  TickerHistoryViewModel,
  TickerSummaryViewModel,
} from "./viewModels.js";

/**
 * Convert a SerializedDataPoint into a DisplayField. This is the one place
 * the "value is null unless status is ok" rule is mechanically enforced —
 * every view-model builder below goes through this function, so there is
 * no code path anywhere in the read model that can smuggle a value out of
 * an `unavailable` DataPoint.
 */
function toDisplayField<T>(dp: SerializedDataPoint<T>): DisplayField<T> {
  if (dp.status === "ok") {
    return { status: classifyFieldStatus(dp), value: dp.value, source: dp.source };
  }
  return { status: classifyFieldStatus(dp), value: null, source: dp.source };
}

function toHolderConcentrationDisplay(dp: TickerSnapshotRecord["holderConcentration"]): HolderConcentrationDisplay {
  const status = classifyFieldStatus(dp);
  if (dp.status === "ok") {
    return { status, top1Pct: dp.value.top1Pct, top5Pct: dp.value.top5Pct, top10Pct: dp.value.top10Pct, holderRows: dp.value.holderRows };
  }
  return { status, top1Pct: null, top5Pct: null, top10Pct: null, holderRows: null };
}

/** Build the grid-row view model for one ticker. `record` is `null` when no snapshot has ever been captured — a distinct, honestly-labeled state, never treated as "unavailable due to failure." `history` is the ticker's full snapshot history, used only to compute the compact intelligence summary (see src/intelligence/); defaults to empty for callers that don't have it (yielding an honest INSUFFICIENT_DATA summary, never a fabricated one). */
export function buildTickerSummary(symbol: string, record: TickerSnapshotRecord | null, history: TickerSnapshotRecord[] = []): TickerSummaryViewModel {
  const intelligence = toIntelligenceSummary(buildTickerIntelligence(symbol, history));

  if (!record) {
    return {
      symbol,
      canonicalTokenAddress: null,
      overallStatus: "no_data_yet",
      referencePrice: { status: "unavailable", value: null },
      secondaryPrice: { status: "unavailable", value: null },
      premiumDiscountPct: { status: "unavailable", value: null },
      holderConcentration: { status: "unavailable", top1Pct: null, top5Pct: null, top10Pct: null, holderRows: null },
      lastUpdateTimestamp: null,
      intelligence,
    };
  }

  const referenceDp = record.chainlinkReference.status === "ok"
    ? ({ status: "ok", value: record.chainlinkReference.value.normalizedPrice, asOf: record.chainlinkReference.asOf, source: record.chainlinkReference.source } as const)
    : record.chainlinkReference;

  return {
    symbol: record.ticker,
    canonicalTokenAddress: record.canonicalTokenAddress,
    overallStatus: classifyOverallStatus(record),
    referencePrice: toDisplayField(referenceDp),
    secondaryPrice: toDisplayField(record.secondaryPrice),
    premiumDiscountPct: toDisplayField(record.premiumDiscountPct),
    holderConcentration: toHolderConcentrationDisplay(record.holderConcentration),
    lastUpdateTimestamp: record.capturedAt,
    intelligence,
  };
}

/** Build the full detail view model for one ticker. Same `null`-record handling as buildTickerSummary, and the same `history` parameter for the full intelligence detail (see src/intelligence/). */
export function buildTickerDetail(symbol: string, record: TickerSnapshotRecord | null, history: TickerSnapshotRecord[] = []): TickerDetailViewModel {
  const summary = buildTickerSummary(symbol, record, history);
  const intelligenceDetail: IntelligenceDetailViewModel = toIntelligenceDetailViewModel(buildTickerIntelligence(symbol, history));

  if (!record) {
    return {
      ...summary,
      configuredPoolAddress: null,
      robinhoodAssetStatus: { status: "unavailable", value: null },
      robinhoodPrice: { status: "unavailable", value: null },
      chainlinkReferenceDetail: { status: "unavailable", value: null },
      oraclePausedField: { status: "unavailable", value: null },
      provenance: [],
      intelligenceDetail,
    };
  }

  const provenance: ProvenanceRow[] = [
    { field: "Robinhood asset status", status: classifyFieldStatus(record.robinhoodAssetStatus), source: record.robinhoodAssetStatus.source, detail: record.robinhoodAssetStatus.status === "unavailable" ? record.robinhoodAssetStatus.detail : null },
    { field: "Robinhood price/state", status: classifyFieldStatus(record.robinhoodPrice), source: record.robinhoodPrice.source, detail: record.robinhoodPrice.status === "unavailable" ? record.robinhoodPrice.detail : null },
    { field: "Chainlink reference", status: classifyFieldStatus(record.chainlinkReference), source: record.chainlinkReference.source, detail: record.chainlinkReference.status === "unavailable" ? record.chainlinkReference.detail : null },
    { field: "Oracle paused", status: classifyFieldStatus(record.oraclePaused), source: record.oraclePaused.source, detail: record.oraclePaused.status === "unavailable" ? record.oraclePaused.detail : null },
    { field: "Secondary (Uniswap V3)", status: classifyFieldStatus(record.secondaryPrice), source: record.secondaryPrice.source, detail: record.secondaryPrice.status === "unavailable" ? record.secondaryPrice.detail : null },
    { field: "Premium/discount", status: classifyFieldStatus(record.premiumDiscountPct), source: record.premiumDiscountPct.source, detail: record.premiumDiscountPct.status === "unavailable" ? record.premiumDiscountPct.detail : null },
    { field: "Holder concentration", status: classifyFieldStatus(record.holderConcentration), source: record.holderConcentration.source, detail: record.holderConcentration.status === "unavailable" ? record.holderConcentration.detail : null },
  ];

  return {
    ...summary,
    configuredPoolAddress: record.configuredPoolAddress,
    robinhoodAssetStatus: toDisplayField(record.robinhoodAssetStatus),
    robinhoodPrice: toDisplayField(record.robinhoodPrice),
    chainlinkReferenceDetail: toDisplayField(record.chainlinkReference),
    oraclePausedField: toDisplayField(record.oraclePaused),
    provenance,
    intelligenceDetail,
  };
}

/**
 * Build a gap-preserving history series. Each point's price fields are
 * `null` whenever the underlying record's field was `unavailable` at that
 * timestamp — never interpolated, never defaulted to zero. Rendering code
 * (see public/app.js) is responsible for drawing an actual visual break
 * wherever it encounters `null`, not connecting through it.
 */
export function buildTickerHistory(symbol: string, records: TickerSnapshotRecord[]): TickerHistoryViewModel {
  const points: HistoryPoint[] = records.map((record) => ({
    timestamp: record.capturedAt,
    referencePrice: record.chainlinkReference.status === "ok" ? record.chainlinkReference.value.normalizedPrice : null,
    secondaryPrice: record.secondaryPrice.status === "ok" ? record.secondaryPrice.value : null,
    premiumDiscountPct: record.premiumDiscountPct.status === "ok" ? record.premiumDiscountPct.value : null,
  }));
  return { symbol, points };
}
