import { describe, it, expect } from "vitest";
import { buildTickerSummary, buildTickerDetail, buildTickerHistory } from "../src/readmodel/buildViewModels.js";
import type { TickerSnapshotRecord } from "../src/snapshot/types.js";

function baseRecord(overrides: Partial<TickerSnapshotRecord> = {}): TickerSnapshotRecord {
  return {
    recordType: "ticker_snapshot",
    runId: "test-run",
    capturedAt: "2026-09-07T12:00:00.000Z",
    ticker: "AAPL",
    canonicalTokenAddress: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9",
    configuredPoolAddress: "0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed",
    robinhoodAssetStatus: { status: "ok", value: "ACTIVE", asOf: "2026-09-07T12:00:00.000Z", source: "test" },
    robinhoodPrice: {
      status: "ok",
      value: { bid: "213.40", ask: "213.50", mid: 213.45, isTradingHalt: false, generatedAt: "2026-09-07T12:00:00.000Z" },
      asOf: "2026-09-07T12:00:00.000Z",
      source: "test",
    },
    chainlinkReference: {
      status: "ok",
      value: { normalizedPrice: 213.45, decimals: 8, updatedAt: "2026-09-07T11:00:00.000Z" },
      asOf: "2026-09-07T11:00:00.000Z",
      source: "test",
    },
    oraclePaused: { status: "ok", value: false, asOf: "2026-09-07T12:00:00.000Z", source: "test" },
    secondaryPrice: { status: "ok", value: 214.0, asOf: "2026-09-07T12:00:00.000Z", source: "test" },
    premiumDiscountPct: { status: "ok", value: 0.26, asOf: "2026-09-07T12:00:00.000Z", source: "test" },
    holderConcentration: {
      status: "ok",
      value: { holderRows: 10, top1Pct: 40, top5Pct: 68, top10Pct: 79 },
      asOf: "2026-09-07T12:00:00.000Z",
      source: "test",
    },
    ...overrides,
  };
}

describe("buildTickerSummary — no_data_yet is distinct from a failed fetch", () => {
  it("returns a fully unavailable, honestly-labeled summary when record is null (never captured)", () => {
    const vm = buildTickerSummary("AAPL", null);
    expect(vm.overallStatus).toBe("no_data_yet");
    expect(vm.referencePrice.value).toBeNull();
    expect(vm.secondaryPrice.value).toBeNull();
    expect(vm.premiumDiscountPct.value).toBeNull();
    expect(vm.holderConcentration.top10Pct).toBeNull();
    expect(vm.lastUpdateTimestamp).toBeNull();
  });
});

describe("buildTickerSummary — never a fabricated zero for unavailable values", () => {
  it("premiumDiscountPct.value is null, not 0, when the field is unavailable", () => {
    const record = baseRecord({
      premiumDiscountPct: { status: "unavailable", reason: "implausible_result", detail: "sanity bound", source: "test" },
    });
    const vm = buildTickerSummary("AAPL", record);
    expect(vm.premiumDiscountPct.status).toBe("unavailable");
    expect(vm.premiumDiscountPct.value).toBeNull();
  });

  it("holderConcentration fields are all null, not 0%, when unavailable", () => {
    const record = baseRecord({
      holderConcentration: { status: "unavailable", reason: "upstream_error", detail: "blockscout down", source: "test" },
    });
    const vm = buildTickerSummary("AAPL", record);
    expect(vm.holderConcentration.top1Pct).toBeNull();
    expect(vm.holderConcentration.top5Pct).toBeNull();
    expect(vm.holderConcentration.top10Pct).toBeNull();
  });

  it("referencePrice.value is null, not 0, when the chainlink reference is stale", () => {
    const record = baseRecord({
      chainlinkReference: { status: "unavailable", reason: "stale", detail: "too old", source: "test" },
    });
    const vm = buildTickerSummary("AAPL", record);
    expect(vm.referencePrice.status).toBe("stale");
    expect(vm.referencePrice.value).toBeNull();
  });
});

describe("buildTickerSummary — happy path", () => {
  it("surfaces real values when every field is ok", () => {
    const vm = buildTickerSummary("AAPL", baseRecord());
    expect(vm.overallStatus).toBe("healthy_current");
    expect(vm.referencePrice.value).toBe(213.45);
    expect(vm.secondaryPrice.value).toBe(214.0);
    expect(vm.premiumDiscountPct.value).toBe(0.26);
    expect(vm.holderConcentration.top10Pct).toBe(79);
    expect(vm.lastUpdateTimestamp).toBe("2026-09-07T12:00:00.000Z");
  });
});

describe("buildTickerDetail", () => {
  it("returns an empty, honest detail view when record is null", () => {
    const vm = buildTickerDetail("AAPL", null);
    expect(vm.overallStatus).toBe("no_data_yet");
    expect(vm.configuredPoolAddress).toBeNull();
    expect(vm.provenance).toEqual([]);
  });

  it("builds a full provenance table with one row per tracked field, never omitting a failed field", () => {
    const record = baseRecord({
      secondaryPrice: { status: "unavailable", reason: "upstream_error", detail: "pool call failed", source: "uniswap_v3" },
    });
    const vm = buildTickerDetail("AAPL", record);
    expect(vm.provenance).toHaveLength(7);
    const secondaryRow = vm.provenance.find((r) => r.field === "Secondary (Uniswap V3)")!;
    expect(secondaryRow.status).toBe("unavailable");
    expect(secondaryRow.detail).toBe("pool call failed");
  });

  it("never puts a value into a provenance row's detail when the field succeeded", () => {
    const vm = buildTickerDetail("AAPL", baseRecord());
    const referenceRow = vm.provenance.find((r) => r.field === "Chainlink reference")!;
    expect(referenceRow.status).toBe("ok");
    expect(referenceRow.detail).toBeNull();
  });
});

describe("buildTickerHistory — gaps are preserved, never interpolated or zeroed", () => {
  it("a record with an unavailable field produces a null point, not zero", () => {
    const records = [
      baseRecord({ capturedAt: "2026-09-07T10:00:00.000Z" }),
      baseRecord({
        capturedAt: "2026-09-07T11:00:00.000Z",
        chainlinkReference: { status: "unavailable", reason: "rpc_unreachable", detail: "down", source: "test" },
        secondaryPrice: { status: "unavailable", reason: "upstream_error", detail: "down", source: "test" },
        premiumDiscountPct: { status: "unavailable", reason: "rpc_unreachable", detail: "down", source: "test" },
      }),
      baseRecord({ capturedAt: "2026-09-07T12:00:00.000Z" }),
    ];
    const history = buildTickerHistory("AAPL", records);
    expect(history.points).toHaveLength(3);
    expect(history.points[0]!.referencePrice).toBe(213.45);
    expect(history.points[1]!.referencePrice).toBeNull();
    expect(history.points[1]!.secondaryPrice).toBeNull();
    expect(history.points[1]!.premiumDiscountPct).toBeNull();
    expect(history.points[2]!.referencePrice).toBe(213.45);
    // Explicitly assert it is `null`, not `0` — the exact bug class this guards against.
    expect(history.points[1]!.referencePrice).not.toBe(0);
  });

  it("an empty record list produces an empty points array, not a fabricated series", () => {
    const history = buildTickerHistory("AAPL", []);
    expect(history.points).toEqual([]);
  });

  it("preserves chronological order as given (callers are responsible for sorting before calling this)", () => {
    const records = [
      baseRecord({ capturedAt: "2026-09-07T09:00:00.000Z", premiumDiscountPct: { status: "ok", value: 1, asOf: "x", source: "s" } }),
      baseRecord({ capturedAt: "2026-09-07T10:00:00.000Z", premiumDiscountPct: { status: "ok", value: 2, asOf: "x", source: "s" } }),
    ];
    const history = buildTickerHistory("AAPL", records);
    expect(history.points.map((p) => p.premiumDiscountPct)).toEqual([1, 2]);
  });
});

describe("buildTickerSummary / buildTickerDetail — intelligence field propagation (Slice P3)", () => {
  it("buildTickerSummary defaults to an honest INSUFFICIENT_DATA intelligence summary when no history is passed", () => {
    const vm = buildTickerSummary("AAPL", baseRecord());
    expect(vm.intelligence.maturity).toBe("INSUFFICIENT_DATA");
    expect(vm.intelligence.classification).toBeNull();
  });

  it("buildTickerSummary computes a real intelligence summary when full history is passed", () => {
    const records = Array.from({ length: 250 }, (_, i) =>
      baseRecord({
        capturedAt: new Date(Date.parse("2026-08-01T00:00:00.000Z") + i * 60 * 60000).toISOString(),
        premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" },
      }),
    );
    const latest = records[records.length - 1]!;
    const vm = buildTickerSummary("AAPL", latest, records);
    expect(vm.intelligence.maturity).toBe("MATURE");
    expect(vm.intelligence.classification).toBe("NORMAL");
  });

  it("buildTickerDetail exposes both the compact intelligence summary AND the full intelligenceDetail, computed from the same history", () => {
    const records = Array.from({ length: 250 }, (_, i) =>
      baseRecord({
        capturedAt: new Date(Date.parse("2026-08-01T00:00:00.000Z") + i * 60 * 60000).toISOString(),
        premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" },
      }),
    );
    const latest = records[records.length - 1]!;
    const vm = buildTickerDetail("AAPL", latest, records);
    expect(vm.intelligence.maturity).toBe("MATURE");
    expect(vm.intelligenceDetail.maturity).toBe("MATURE");
    // Summary and detail must agree — both are projections of the same computation.
    expect(vm.intelligence.classification).toBe(vm.intelligenceDetail.classification);
    expect(vm.intelligenceDetail.baseline.observationCount).toBe(250);
  });

  it("buildTickerDetail's intelligenceDetail is a fully null-shaped object (not a crash) when record is null", () => {
    const vm = buildTickerDetail("AAPL", null);
    expect(vm.intelligenceDetail.maturity).toBe("INSUFFICIENT_DATA");
    expect(vm.intelligenceDetail.classification).toBeNull();
    expect(vm.intelligenceDetail.episode).toBeNull();
  });

  it("immature history never gets mislabeled NORMAL — DEVELOPING history has classification: null, not a default NORMAL", () => {
    const records = Array.from({ length: 30 }, (_, i) =>
      baseRecord({
        capturedAt: new Date(Date.parse("2026-09-01T00:00:00.000Z") + i * 60 * 60000).toISOString(),
        premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" },
      }),
    );
    const latest = records[records.length - 1]!;
    const vm = buildTickerDetail("AAPL", latest, records);
    expect(vm.intelligence.maturity).toBe("DEVELOPING");
    expect(vm.intelligence.classification).toBeNull();
    expect(vm.intelligenceDetail.classification).toBeNull();
  });

  it("excludedByFreshnessCount survives through to the detail view model's baseline", () => {
    const fresh = Array.from({ length: 25 }, (_, i) =>
      baseRecord({
        capturedAt: new Date(Date.parse("2026-08-01T00:00:00.000Z") + i * 60 * 60000).toISOString(),
        premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" },
      }),
    );
    const staleByP3 = baseRecord({
      capturedAt: "2026-08-02T02:00:00.000Z",
      premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" },
      chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: "2026-01-01T00:00:00.000Z" }, asOf: "x", source: "s" },
    });
    const all = [...fresh, staleByP3];
    const vm = buildTickerDetail("AAPL", all[all.length - 1]!, all);
    expect(vm.intelligenceDetail.baseline.excludedByFreshnessCount).toBe(1);
    expect(vm.intelligenceDetail.baseline.observationCount).toBe(25);
  });
});
