import { describe, it, expect } from "vitest";
import { classifyFieldStatus, classifyOverallStatus } from "../src/readmodel/fieldStatus.js";
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

describe("classifyFieldStatus", () => {
  it("maps an ok DataPoint to 'ok'", () => {
    expect(classifyFieldStatus({ status: "ok", value: 1, asOf: "x", source: "s" })).toBe("ok");
  });

  it("maps reason='stale' to 'stale'", () => {
    expect(classifyFieldStatus({ status: "unavailable", reason: "stale", detail: "d", source: "s" })).toBe("stale");
  });

  it("maps reason='oracle_paused' to 'paused'", () => {
    expect(classifyFieldStatus({ status: "unavailable", reason: "oracle_paused", detail: "d", source: "s" })).toBe("paused");
  });

  it("maps reason='trading_halt' to 'halted'", () => {
    expect(classifyFieldStatus({ status: "unavailable", reason: "trading_halt", detail: "d", source: "s" })).toBe("halted");
  });

  it("maps every other reason to 'unavailable'", () => {
    for (const reason of ["rpc_unreachable", "upstream_error", "rate_limited", "implausible_result", "no_chainlink_feed", "no_verified_pool", "not_yet_verified"]) {
      expect(classifyFieldStatus({ status: "unavailable", reason: reason as never, detail: "d", source: "s" })).toBe("unavailable");
    }
  });
});

describe("classifyOverallStatus — priority order over already-computed fields", () => {
  it("returns healthy_current when every required field is ok and nothing is paused/halted", () => {
    expect(classifyOverallStatus(baseRecord())).toBe("healthy_current");
  });

  it("returns stale_reference when the chainlink reference is stale, even if everything else is ok", () => {
    const record = baseRecord({
      chainlinkReference: { status: "unavailable", reason: "stale", detail: "too old", source: "test" },
    });
    expect(classifyOverallStatus(record)).toBe("stale_reference");
  });

  it("returns oracle_paused when oraclePaused is ok=true, even if prices are otherwise fine", () => {
    const record = baseRecord({ oraclePaused: { status: "ok", value: true, asOf: "x", source: "test" } });
    expect(classifyOverallStatus(record)).toBe("oracle_paused");
  });

  it("returns trading_halt when Robinhood's own isTradingHalt flag is true", () => {
    const record = baseRecord({
      robinhoodPrice: {
        status: "ok",
        value: { bid: "1", ask: "1", mid: 1, isTradingHalt: true, generatedAt: "x" },
        asOf: "x",
        source: "test",
      },
    });
    expect(classifyOverallStatus(record)).toBe("trading_halt");
  });

  it("returns upstream_unavailable when a required field fails for an ordinary reason", () => {
    const record = baseRecord({
      secondaryPrice: { status: "unavailable", reason: "upstream_error", detail: "pool call failed", source: "test" },
    });
    expect(classifyOverallStatus(record)).toBe("upstream_unavailable");
  });

  it("prioritizes stale_reference over a plain upstream_unavailable field elsewhere", () => {
    const record = baseRecord({
      chainlinkReference: { status: "unavailable", reason: "stale", detail: "too old", source: "test" },
      holderConcentration: { status: "unavailable", reason: "upstream_error", detail: "blockscout down", source: "test" },
    });
    expect(classifyOverallStatus(record)).toBe("stale_reference");
  });
});
