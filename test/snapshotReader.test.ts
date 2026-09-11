import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendJsonLine } from "../src/snapshot/jsonlStore.js";
import { readLatestTickerSnapshot, readTickerHistory, readAllTickerSnapshots } from "../src/readmodel/snapshotReader.js";
import type { TickerSnapshotRecord } from "../src/snapshot/types.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "parity-snapshotreader-test-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function record(symbol: string, capturedAt: string, premiumDiscountPct = 0.1): TickerSnapshotRecord {
  return {
    recordType: "ticker_snapshot",
    runId: "test-run",
    capturedAt,
    ticker: symbol,
    canonicalTokenAddress: "0x1111111111111111111111111111111111111111",
    configuredPoolAddress: "0x2222222222222222222222222222222222222222",
    robinhoodAssetStatus: { status: "ok", value: "ACTIVE", asOf: capturedAt, source: "test" },
    robinhoodPrice: { status: "ok", value: { bid: "1", ask: "1", mid: 1, isTradingHalt: false, generatedAt: capturedAt }, asOf: capturedAt, source: "test" },
    chainlinkReference: { status: "ok", value: { normalizedPrice: 100, decimals: 8, updatedAt: capturedAt }, asOf: capturedAt, source: "test" },
    oraclePaused: { status: "ok", value: false, asOf: capturedAt, source: "test" },
    secondaryPrice: { status: "ok", value: 100.5, asOf: capturedAt, source: "test" },
    premiumDiscountPct: { status: "ok", value: premiumDiscountPct, asOf: capturedAt, source: "test" },
    holderConcentration: { status: "ok", value: { holderRows: 5, top1Pct: 20, top5Pct: 50, top10Pct: 70 }, asOf: capturedAt, source: "test" },
  };
}

function writeRecords(records: TickerSnapshotRecord[]) {
  const path = join(dataDir, "ticker-snapshots.jsonl");
  for (const r of records) appendJsonLine(path, r);
}

describe("readLatestTickerSnapshot", () => {
  it("returns null when no snapshot has ever been captured for this ticker", () => {
    expect(readLatestTickerSnapshot("AAPL", { dataDir })).toBeNull();
  });

  it("returns the most recent record by capturedAt, regardless of file order", () => {
    writeRecords([
      record("AAPL", "2026-09-07T10:00:00.000Z", 0.1),
      record("AAPL", "2026-09-07T12:00:00.000Z", 0.3),
      record("AAPL", "2026-09-07T11:00:00.000Z", 0.2),
    ]);
    const latest = readLatestTickerSnapshot("AAPL", { dataDir });
    expect(latest?.capturedAt).toBe("2026-09-07T12:00:00.000Z");
    expect(latest?.premiumDiscountPct.status).toBe("ok");
  });

  it("only returns records for the requested ticker, ignoring others in the same file", () => {
    writeRecords([record("AAPL", "2026-09-07T10:00:00.000Z"), record("GOOGL", "2026-09-07T11:00:00.000Z")]);
    const latest = readLatestTickerSnapshot("AAPL", { dataDir });
    expect(latest?.ticker).toBe("AAPL");
  });
});

describe("readTickerHistory", () => {
  it("returns all records in chronological order", () => {
    writeRecords([
      record("AAPL", "2026-09-07T12:00:00.000Z"),
      record("AAPL", "2026-09-07T10:00:00.000Z"),
      record("AAPL", "2026-09-07T11:00:00.000Z"),
    ]);
    const history = readTickerHistory("AAPL", { dataDir });
    expect(history.map((r) => r.capturedAt)).toEqual([
      "2026-09-07T10:00:00.000Z",
      "2026-09-07T11:00:00.000Z",
      "2026-09-07T12:00:00.000Z",
    ]);
  });

  it("respects a limit, keeping the most recent N records", () => {
    writeRecords([
      record("AAPL", "2026-09-07T10:00:00.000Z"),
      record("AAPL", "2026-09-07T11:00:00.000Z"),
      record("AAPL", "2026-09-07T12:00:00.000Z"),
    ]);
    const history = readTickerHistory("AAPL", { dataDir, limit: 2 });
    expect(history.map((r) => r.capturedAt)).toEqual(["2026-09-07T11:00:00.000Z", "2026-09-07T12:00:00.000Z"]);
  });

  it("returns an empty array for a ticker with no history, not an error", () => {
    expect(readTickerHistory("AAPL", { dataDir })).toEqual([]);
  });
});

describe("malformed snapshot lines are handled safely", () => {
  it("a truncated/malformed trailing line does not prevent reading the well-formed records before it", () => {
    const path = join(dataDir, "ticker-snapshots.jsonl");
    appendJsonLine(path, record("AAPL", "2026-09-07T10:00:00.000Z"));
    appendJsonLine(path, record("AAPL", "2026-09-07T11:00:00.000Z"));
    // Simulate a process crashing mid-write.
    appendFileSync(path, '{"recordType": "ticker_snapshot", "ticker": "AAPL", "incomplete');

    const all = readAllTickerSnapshots({ dataDir });
    expect(all).toHaveLength(2);
    const latest = readLatestTickerSnapshot("AAPL", { dataDir });
    expect(latest?.capturedAt).toBe("2026-09-07T11:00:00.000Z");
  });

  it("a malformed line in the middle of the file does not corrupt records written after it", () => {
    const path = join(dataDir, "ticker-snapshots.jsonl");
    appendJsonLine(path, record("AAPL", "2026-09-07T10:00:00.000Z"));
    appendFileSync(path, "not even json at all\n");
    appendJsonLine(path, record("AAPL", "2026-09-07T11:00:00.000Z"));

    const history = readTickerHistory("AAPL", { dataDir });
    expect(history).toHaveLength(2);
  });
});
