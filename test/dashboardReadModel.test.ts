import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getSupportedTickerSymbols,
  getGridViewModel,
  getDetailViewModel,
  getHistoryViewModelFor,
} from "../src/readmodel/dashboardReadModel.js";
import { getSupportedSnapshotTickers } from "../src/snapshot/supportedTickers.js";
import { appendJsonLine } from "../src/snapshot/jsonlStore.js";
import type { TickerSnapshotRecord } from "../src/snapshot/types.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "parity-dashboardreadmodel-test-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("getSupportedTickerSymbols — derived from config, no second hardcoded list in the read model", () => {
  it("matches exactly what src/snapshot/supportedTickers.ts derives from CANDIDATE_TICKERS", () => {
    const expected = getSupportedSnapshotTickers().map((t) => t.symbol);
    expect(getSupportedTickerSymbols().sort()).toEqual(expected.sort());
  });

  it("is exactly the six known-supported tickers", () => {
    expect(getSupportedTickerSymbols().sort()).toEqual(["AAPL", "GOOGL", "NVDA", "SPCX", "TSLA", "USO"].sort());
  });
});

describe("getGridViewModel", () => {
  it("returns one summary row per supported ticker, even with no data captured yet (all no_data_yet)", () => {
    const grid = getGridViewModel({ dataDir });
    expect(grid).toHaveLength(6);
    for (const row of grid) {
      expect(row.overallStatus).toBe("no_data_yet");
    }
  });
});

describe("getDetailViewModel — unsupported ticker handling", () => {
  it("returns kind='unsupported_ticker' for a ticker not in the supported list (e.g. MSFT)", () => {
    const result = getDetailViewModel("MSFT", { dataDir });
    expect(result.kind).toBe("unsupported_ticker");
  });

  it("returns kind='unsupported_ticker' for a nonsense symbol", () => {
    const result = getDetailViewModel("NOTATICKER", { dataDir });
    expect(result.kind).toBe("unsupported_ticker");
  });

  it("returns kind='ok' with an honest no_data_yet detail for a supported ticker with no captured snapshot", () => {
    const result = getDetailViewModel("AAPL", { dataDir });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.detail.overallStatus).toBe("no_data_yet");
    }
  });
});

describe("getHistoryViewModelFor — unsupported ticker handling and empty history", () => {
  it("returns kind='unsupported_ticker' for QQQ (a real ticker in config, but not promoted/supported)", () => {
    const result = getHistoryViewModelFor("QQQ", 100, { dataDir });
    expect(result.kind).toBe("unsupported_ticker");
  });

  it("returns an empty points array for a supported ticker with no history yet, not an error", () => {
    const result = getHistoryViewModelFor("AAPL", 100, { dataDir });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.history.points).toEqual([]);
    }
  });

  it("returns real points once a snapshot has been written", () => {
    const rec: TickerSnapshotRecord = {
      recordType: "ticker_snapshot",
      runId: "test",
      capturedAt: "2026-09-07T12:00:00.000Z",
      ticker: "AAPL",
      canonicalTokenAddress: "0x1",
      configuredPoolAddress: "0x2",
      robinhoodAssetStatus: { status: "ok", value: "ACTIVE", asOf: "x", source: "s" },
      robinhoodPrice: { status: "ok", value: { bid: "1", ask: "1", mid: 1, isTradingHalt: false, generatedAt: "x" }, asOf: "x", source: "s" },
      chainlinkReference: { status: "ok", value: { normalizedPrice: 100, decimals: 8, updatedAt: "x" }, asOf: "x", source: "s" },
      oraclePaused: { status: "ok", value: false, asOf: "x", source: "s" },
      secondaryPrice: { status: "ok", value: 101, asOf: "x", source: "s" },
      premiumDiscountPct: { status: "ok", value: 1.0, asOf: "x", source: "s" },
      holderConcentration: { status: "ok", value: { holderRows: 1, top1Pct: 1, top5Pct: 1, top10Pct: 1 }, asOf: "x", source: "s" },
    };
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), rec);
    const result = getHistoryViewModelFor("AAPL", 100, { dataDir });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.history.points).toHaveLength(1);
      expect(result.history.points[0]!.premiumDiscountPct).toBe(1.0);
    }
  });
});

describe("getGridViewModel / getDetailViewModel — intelligence agreement (Slice P3)", () => {
  function seedMatureHistory(symbol: string, pct: number) {
    for (let i = 0; i < 250; i++) {
      const capturedAt = new Date(Date.parse("2026-08-01T00:00:00.000Z") + i * 60 * 60000).toISOString();
      const rec: TickerSnapshotRecord = {
        recordType: "ticker_snapshot",
        runId: "seed",
        capturedAt,
        ticker: symbol,
        canonicalTokenAddress: "0x1",
        configuredPoolAddress: "0x2",
        robinhoodAssetStatus: { status: "ok", value: "ACTIVE", asOf: capturedAt, source: "s" },
        robinhoodPrice: { status: "ok", value: { bid: "1", ask: "1", mid: 1, isTradingHalt: false, generatedAt: capturedAt }, asOf: capturedAt, source: "s" },
        chainlinkReference: { status: "ok", value: { normalizedPrice: 100, decimals: 8, updatedAt: capturedAt }, asOf: capturedAt, source: "s" },
        oraclePaused: { status: "ok", value: false, asOf: capturedAt, source: "s" },
        secondaryPrice: { status: "ok", value: 100 + pct, asOf: capturedAt, source: "s" },
        premiumDiscountPct: { status: "ok", value: pct, asOf: capturedAt, source: "s" },
        holderConcentration: { status: "ok", value: { holderRows: 1, top1Pct: 1, top5Pct: 1, top10Pct: 1 }, asOf: capturedAt, source: "s" },
      };
      appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), rec);
    }
  }

  it("GET-grid-equivalent and GET-detail-equivalent agree on maturity/classification for the same underlying history", () => {
    seedMatureHistory("AAPL", 0.1);
    const grid = getGridViewModel({ dataDir });
    const detailResult = getDetailViewModel("AAPL", { dataDir });

    const aaplRow = grid.find((r) => r.symbol === "AAPL")!;
    expect(detailResult.kind).toBe("ok");
    if (detailResult.kind === "ok") {
      expect(aaplRow.intelligence.maturity).toBe(detailResult.detail.intelligence.maturity);
      expect(aaplRow.intelligence.classification).toBe(detailResult.detail.intelligence.classification);
      expect(aaplRow.intelligence.maturity).toBe(detailResult.detail.intelligenceDetail.maturity);
      expect(aaplRow.intelligence.classification).toBe(detailResult.detail.intelligenceDetail.classification);
    }
  });

  it("a ticker with no history at all reports INSUFFICIENT_DATA on the grid, never a default NORMAL", () => {
    const grid = getGridViewModel({ dataDir });
    for (const row of grid) {
      expect(row.intelligence.maturity).toBe("INSUFFICIENT_DATA");
      expect(row.intelligence.classification).toBeNull();
    }
  });
});
