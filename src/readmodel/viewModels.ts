import type { FieldDisplayStatus, OverallTickerStatus } from "./fieldStatus.js";
import type { IntelligenceSummary } from "../intelligence/types.js";
import type { IntelligenceDetailViewModel } from "./intelligenceViewModel.js";

/** A single displayable field: its display status, and its value ONLY when that status is "ok". `value` is `null` for every non-ok status — this is enforced by the builder functions, not just by convention. */
export interface DisplayField<T> {
  status: FieldDisplayStatus;
  value: T | null;
  /** Free-text source citation, when available — surfaced in the detail view's provenance section. */
  source?: string;
}

export interface HolderConcentrationDisplay {
  status: FieldDisplayStatus;
  top1Pct: number | null;
  top5Pct: number | null;
  top10Pct: number | null;
  holderRows: number | null;
}

export interface TickerSummaryViewModel {
  symbol: string;
  canonicalTokenAddress: string | null;
  overallStatus: OverallTickerStatus | "no_data_yet";
  referencePrice: DisplayField<number>;
  secondaryPrice: DisplayField<number>;
  premiumDiscountPct: DisplayField<number>;
  holderConcentration: HolderConcentrationDisplay;
  lastUpdateTimestamp: string | null;
  /** Compact dislocation-intelligence summary — see src/intelligence/. Computed once per ticker and projected here; never recomputed client-side. */
  intelligence: IntelligenceSummary;
}

export interface ProvenanceRow {
  field: string;
  status: FieldDisplayStatus;
  source: string;
  detail: string | null;
}

export interface TickerDetailViewModel extends TickerSummaryViewModel {
  configuredPoolAddress: string | null;
  robinhoodAssetStatus: DisplayField<string>;
  robinhoodPrice: DisplayField<{ bid: string; ask: string; mid: number; isTradingHalt: boolean; generatedAt: string }>;
  chainlinkReferenceDetail: DisplayField<{ normalizedPrice: number; decimals: number; updatedAt: string }>;
  oraclePausedField: DisplayField<boolean>;
  provenance: ProvenanceRow[];
  /** Full dislocation-intelligence detail — same underlying computation as the summary above, projected in full. */
  intelligenceDetail: IntelligenceDetailViewModel;
}

export interface HistoryPoint {
  timestamp: string;
  referencePrice: number | null; // null = an honest gap, never a fabricated zero
  secondaryPrice: number | null;
  premiumDiscountPct: number | null;
}

export interface TickerHistoryViewModel {
  symbol: string;
  points: HistoryPoint[];
}
