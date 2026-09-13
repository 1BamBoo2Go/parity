import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureRun, type CaptureRunResult } from "../src/snapshot/captureRun.js";
import { appendJsonLine } from "../src/snapshot/jsonlStore.js";
import { processCaptureRunForAlerts, formatAlertEventLogLine, type AlertDelivery } from "../src/alerts/processCaptureRunForAlerts.js";
import { readAlertState } from "../src/alerts/alertStateStore.js";
import type { AlertEvent } from "../src/alerts/types.js";
import type { CaptureDeps } from "../src/snapshot/captureTickerSnapshot.js";
import type { TickerSnapshotRecord } from "../src/snapshot/types.js";
import { CANDIDATE_TICKERS } from "../src/config/tickers.js";

let dataDir: string;
let alertStatePath: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "parity-alertpipeline-test-"));
  alertStatePath = join(dataDir, "alert-state.json");
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function opts() {
  return { readerOptions: { dataDir }, alertStateOptions: { filePath: alertStatePath } };
}

// ---- real end-to-end fixtures, matching captureRun.test.ts's own pattern ----
function workingDeps(): CaptureDeps {
  return {
    fetchPrice: async (symbol: string) => ({
      tokenSymbol: symbol,
      deployments: [],
      bid: "100.00",
      ask: "100.10",
      currency: "USD",
      dailyTradingVolume: "1",
      isTradingHalt: false,
      generatedAt: new Date().toISOString(),
    }),
    readFeed: async () => ({ rawAnswer: 10000000000n, decimals: 8, normalizedPrice: 100, updatedAt: new Date(), roundId: 1n }),
    readMultiplierState: async () => ({ uiMultiplier: 1_000000000000000000n, oraclePaused: false }),
    resolvePool: async () => null,
    readSpotPrice: async () => {
      throw new Error("should not be called when resolvePool returns null");
    },
    readDecimals: async () => 18,
    fetchHolders: async () => [{ address: "0x1", value: "100" }],
    readSupply: async () => 1000n,
  };
}
const workingRegistry = async () => ({
  assets: CANDIDATE_TICKERS.filter((t) => t.tokenAddressMainnet).map((t) => ({
    id: t.symbol,
    tokenSymbol: t.symbol,
    tokenName: t.symbol,
    deployments: [{ contractAddress: t.tokenAddressMainnet!, chainId: 4663 }],
    currentMultiplier: "1.0",
    pendingMultiplier: "1.0",
    status: "ASSET_STATUS_ACTIVE" as const,
  })),
});
const workingGas = async () => ({
  recordType: "gas_snapshot" as const,
  runId: "unused-overwritten-by-captureRun",
  capturedAt: new Date().toISOString(),
  network: "mainnet" as const,
  blockNumber: "123456",
  blockTimestamp: new Date().toISOString(),
  baseFeePerGasWei: "1000000",
});

// ---- synthetic fixtures for precise classification control, matching test/server.test.ts's own pattern ----
function seedRecord(overrides: Partial<TickerSnapshotRecord> = {}): TickerSnapshotRecord {
  return {
    recordType: "ticker_snapshot",
    runId: "test-run",
    capturedAt: "2026-09-13T00:00:00.000Z",
    ticker: "AAPL",
    canonicalTokenAddress: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9",
    configuredPoolAddress: "0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed",
    robinhoodAssetStatus: { status: "ok", value: "ACTIVE", asOf: "x", source: "s" },
    robinhoodPrice: { status: "ok", value: { bid: "213.4", ask: "213.5", mid: 213.45, isTradingHalt: false, generatedAt: "x" }, asOf: "x", source: "s" },
    chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: "x" }, asOf: "x", source: "s" },
    oraclePaused: { status: "ok", value: false, asOf: "x", source: "s" },
    secondaryPrice: { status: "ok", value: 214.0, asOf: "x", source: "s" },
    premiumDiscountPct: { status: "ok", value: 0.26, asOf: "x", source: "s" },
    holderConcentration: { status: "ok", value: { holderRows: 10, top1Pct: 40, top5Pct: 68, top10Pct: 79 }, asOf: "x", source: "s" },
    ...overrides,
  };
}

/** Seeds 250 flat, MATURE-eligible records for `symbol` at `pct`, ending at `capturedAt`. */
function seedMatureHistory(symbol: string, pct: number, capturedAt: string) {
  const endMs = Date.parse(capturedAt);
  for (let i = 0; i < 250; i++) {
    const t = new Date(endMs - (249 - i) * 60 * 60000).toISOString();
    appendJsonLine(
      join(dataDir, "ticker-snapshots.jsonl"),
      seedRecord({
        ticker: symbol,
        capturedAt: t,
        chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t }, asOf: t, source: "s" },
        premiumDiscountPct: { status: "ok", value: i === 249 ? pct : 0.1, asOf: t, source: "s" },
      }),
    );
  }
}

function syntheticCaptureResult(records: TickerSnapshotRecord[], errors: { symbol: string; error: string }[] = []): CaptureRunResult {
  return { runId: "synthetic-run", tickerRecords: records, registryCaptured: true, gasCaptured: true, tickerErrors: errors };
}

describe("processCaptureRunForAlerts — real end-to-end via captureRun()", () => {
  it("1. a real successful capture run advances alert state for every captured ticker", async () => {
    const captureResult = await captureRun({ dataDir, deps: workingDeps(), fetchRegistry: workingRegistry, captureGas: workingGas });
    expect(captureResult.tickerRecords.length).toBeGreaterThan(0);

    const result = await processCaptureRunForAlerts(captureResult, opts());
    expect(result.failures).toEqual([]);
    expect(result.processed.length).toBe(captureResult.tickerRecords.length);

    const state = readAlertState({ filePath: alertStatePath });
    for (const record of captureResult.tickerRecords) {
      expect(state[record.ticker]).toBeDefined();
      expect(state[record.ticker]!.lastEvaluatedCapturedAt).toBe(record.capturedAt);
    }
  });

  it("2. the first integrated observation ever seeds state for every ticker and emits no alerts (no phantom historical alerts)", async () => {
    expect(existsSync(alertStatePath)).toBe(false);
    const captureResult = await captureRun({ dataDir, deps: workingDeps(), fetchRegistry: workingRegistry, captureGas: workingGas });

    const result = await processCaptureRunForAlerts(captureResult, opts());
    expect(result.processed.every((p) => p.event === null)).toBe(true);
  });
});

describe("processCaptureRunForAlerts — classification transitions via synthetic capture results", () => {
  it("3. NORMAL -> ELEVATED produces exactly one structured PARITY_ALERT_EVENT", async () => {
    seedMatureHistory("AAPL", 0.1, "2026-09-13T00:00:00.000Z"); // ends NORMAL
    const seedResult = syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" } })]);
    await processCaptureRunForAlerts(seedResult, opts());

    const escalationAt = "2026-09-13T00:15:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: escalationAt, premiumDiscountPct: { status: "ok", value: 3.0, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: escalationAt }, asOf: escalationAt, source: "s" } }));
    const nextResult = syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: escalationAt })]);

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      const result = await processCaptureRunForAlerts(nextResult, opts());
      expect(result.processed[0]!.event!.eventType).toBe("new_risk");
      const alertLines = logs.filter((l) => l.startsWith("PARITY_ALERT_EVENT"));
      expect(alertLines).toHaveLength(1);
      expect(alertLines[0]).toBe(formatAlertEventLogLine(result.processed[0]!.event!));
    } finally {
      console.log = originalLog;
    }
  });

  it("4. replaying the same capturedAt produces no duplicate event", async () => {
    seedMatureHistory("AAPL", 0.1, "2026-09-13T00:00:00.000Z");
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" } })]), opts());

    const escalationAt = "2026-09-13T00:15:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: escalationAt, premiumDiscountPct: { status: "ok", value: 3.0, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: escalationAt }, asOf: escalationAt, source: "s" } }));
    const record = seedRecord({ ticker: "AAPL", capturedAt: escalationAt });

    const first = await processCaptureRunForAlerts(syntheticCaptureResult([record]), opts());
    expect(first.processed[0]!.event).not.toBeNull();

    // Same capturedAt processed again (e.g. a re-run against the same collected record).
    const replay = await processCaptureRunForAlerts(syntheticCaptureResult([record]), opts());
    expect(replay.processed[0]!.event).toBeNull();
  });

  it("5. a subsequent escalation after an already-emitted event produces exactly one new event", async () => {
    seedMatureHistory("AAPL", 0.1, "2026-09-13T00:00:00.000Z");
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" } })]), opts());

    // Empirically verified against classifyCurrentDislocation directly
    // (flat 0.1 baseline, MAD floor applies): 0.2 -> ELEVATED, 0.35 -> DISLOCATED.
    const t1 = "2026-09-13T00:15:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: t1, premiumDiscountPct: { status: "ok", value: 0.2, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t1 }, asOf: t1, source: "s" } }));
    const r1 = await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: t1 })]), opts());
    expect(r1.processed[0]!.event!.eventType).toBe("new_risk");
    expect(r1.processed[0]!.event!.currentClassification).toBe("ELEVATED");

    const t2 = "2026-09-13T00:30:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: t2, premiumDiscountPct: { status: "ok", value: 0.35, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t2 }, asOf: t2, source: "s" } }));
    const r2 = await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: t2 })]), opts());
    expect(r2.processed[0]!.event!.eventType).toBe("escalation");
    expect(r2.processed[0]!.event!.currentClassification).toBe("DISLOCATED");
  });

  it("6. recovery (abnormal -> NORMAL) produces exactly one event", async () => {
    seedMatureHistory("AAPL", 3.0, "2026-09-13T00:00:00.000Z"); // ends SEVERE-ish
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 3.0, asOf: "x", source: "s" } })]), opts());

    const recoveryAt = "2026-09-13T00:15:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: recoveryAt, premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: recoveryAt }, asOf: recoveryAt, source: "s" } }));
    const result = await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: recoveryAt })]), opts());
    expect(result.processed[0]!.event!.eventType).toBe("recovery");
  });
});

describe("processCaptureRunForAlerts — failure isolation", () => {
  it("7. a ticker that failed collection (present only in tickerErrors) never advances alert state", async () => {
    const capturedAt = "2026-09-13T00:00:00.000Z";
    // AAPL genuinely succeeded and was durably written; GOOGL failed
    // collection entirely and has no record on disk at all.
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt }));
    const partial = syntheticCaptureResult(
      [seedRecord({ ticker: "AAPL", capturedAt })],
      [{ symbol: "GOOGL", error: "simulated upstream failure" }],
    );
    const result = await processCaptureRunForAlerts(partial, opts());
    expect(result.processed.map((p) => p.symbol)).toEqual(["AAPL"]);
    const state = readAlertState({ filePath: alertStatePath });
    expect(state.AAPL).toBeDefined();
    expect(state.GOOGL).toBeUndefined();
  });

  it("8. alert-state corruption is surfaced per symbol and never fabricates an event", async () => {
    const capturedAt = "2026-09-13T00:00:00.000Z";
    // A genuinely successful, durably-written snapshot for AAPL — the
    // corruption below must be reached (and reported) via the ALERT state
    // file specifically, not short-circuited by a missing snapshot.
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt }));
    writeFileSync(alertStatePath, "not valid json at all");
    const captureResult = syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt })]);
    const result = await processCaptureRunForAlerts(captureResult, opts());
    expect(result.processed).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.symbol).toBe("AAPL");
    expect(result.failures[0]!.error).toMatch(/corrupt/i);
  });

  it("9. an alert-processing failure does not touch or invalidate the already-successful snapshot on disk", async () => {
    writeFileSync(alertStatePath, "not valid json at all");
    const capturedAt = "2026-09-13T00:00:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt }));
    const snapshotPath = join(dataDir, "ticker-snapshots.jsonl");
    const before = readFileSync(snapshotPath, "utf-8");

    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt })]), opts());

    const after = readFileSync(snapshotPath, "utf-8");
    expect(after).toEqual(before); // the snapshot file itself is completely untouched by the downstream alert failure
  });
});

describe("processCaptureRunForAlerts — symbol independence", () => {
  it("10. separate symbols in the same capture run are processed independently", async () => {
    seedMatureHistory("AAPL", 0.1, "2026-09-13T00:00:00.000Z");
    seedMatureHistory("GOOGL", 3.0, "2026-09-13T00:00:00.000Z");
    await processCaptureRunForAlerts(
      syntheticCaptureResult([
        seedRecord({ ticker: "AAPL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" } }),
        seedRecord({ ticker: "GOOGL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 3.0, asOf: "x", source: "s" } }),
      ]),
      opts(),
    );

    const t1 = "2026-09-13T00:15:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: t1, premiumDiscountPct: { status: "ok", value: 2.5, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t1 }, asOf: t1, source: "s" } }));
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "GOOGL", capturedAt: t1, premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t1 }, asOf: t1, source: "s" } }));

    const result = await processCaptureRunForAlerts(
      syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: t1 }), seedRecord({ ticker: "GOOGL", capturedAt: t1 })]),
      opts(),
    );

    const aapl = result.processed.find((p) => p.symbol === "AAPL")!;
    const googl = result.processed.find((p) => p.symbol === "GOOGL")!;
    expect(aapl.event!.eventType).toBe("new_risk");
    expect(googl.event!.eventType).toBe("recovery");
  });
});

describe("formatAlertEventLogLine — deterministic, parseable log format", () => {
  it("produces a PARITY_ALERT_EVENT-prefixed line containing exactly the AlertEvent as JSON", async () => {
    seedMatureHistory("AAPL", 0.1, "2026-09-13T00:00:00.000Z");
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" } })]), opts());
    const t1 = "2026-09-13T00:15:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: t1, premiumDiscountPct: { status: "ok", value: 3.0, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t1 }, asOf: t1, source: "s" } }));
    const result = await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: t1 })]), opts());

    const event = result.processed[0]!.event!;
    const line = formatAlertEventLogLine(event);
    expect(line.startsWith("PARITY_ALERT_EVENT ")).toBe(true);
    const jsonPart = line.slice("PARITY_ALERT_EVENT ".length);
    expect(JSON.parse(jsonPart)).toEqual(event);
  });
});

describe("processCaptureRunForAlerts — P5-B4 delivery boundary", () => {
  function fakeDelivery() {
    const calls: AlertEvent[] = [];
    const deliver: AlertDelivery = async (event) => {
      calls.push(event as AlertEvent);
    };
    return { deliver, calls };
  }

  it("1. the canonical AlertEvent is passed to delivery completely unchanged", async () => {
    seedMatureHistory("AAPL", 0.1, "2026-09-13T00:00:00.000Z");
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" } })]), opts());
    const t1 = "2026-09-13T00:15:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: t1, premiumDiscountPct: { status: "ok", value: 3.0, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t1 }, asOf: t1, source: "s" } }));

    const { deliver, calls } = fakeDelivery();
    const result = await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: t1 })]), { ...opts(), deliver });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(result.processed[0]!.event);
  });

  it("2. when no event occurs, delivery is never invoked", async () => {
    const capturedAt = "2026-09-13T00:00:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt }));
    const { deliver, calls } = fakeDelivery();
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt })]), { ...opts(), deliver });
    expect(calls).toHaveLength(0); // first observation: seeded, no event, no delivery
  });

  it("3. exactly one canonical transition causes exactly one delivery call", async () => {
    seedMatureHistory("AAPL", 0.1, "2026-09-13T00:00:00.000Z");
    const { deliver, calls } = fakeDelivery();
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" } })]), { ...opts(), deliver });
    const t1 = "2026-09-13T00:15:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: t1, premiumDiscountPct: { status: "ok", value: 3.0, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t1 }, asOf: t1, source: "s" } }));
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: t1 })]), { ...opts(), deliver });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.eventType).toBe("new_risk");
  });

  it("4. replaying the same capturedAt causes no second delivery call", async () => {
    seedMatureHistory("AAPL", 0.1, "2026-09-13T00:00:00.000Z");
    const { deliver, calls } = fakeDelivery();
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" } })]), { ...opts(), deliver });
    const t1 = "2026-09-13T00:15:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: t1, premiumDiscountPct: { status: "ok", value: 3.0, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t1 }, asOf: t1, source: "s" } }));
    const record = seedRecord({ ticker: "AAPL", capturedAt: t1 });
    await processCaptureRunForAlerts(syntheticCaptureResult([record]), { ...opts(), deliver });
    expect(calls).toHaveLength(1);
    await processCaptureRunForAlerts(syntheticCaptureResult([record]), { ...opts(), deliver }); // replay
    expect(calls).toHaveLength(1); // still one — no duplicate delivery
  });

  it("5. escalation and recovery each deliver independently when genuinely generated", async () => {
    seedMatureHistory("AAPL", 0.1, "2026-09-13T00:00:00.000Z");
    const { deliver, calls } = fakeDelivery();
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" } })]), { ...opts(), deliver });

    const t1 = "2026-09-13T00:15:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: t1, premiumDiscountPct: { status: "ok", value: 0.2, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t1 }, asOf: t1, source: "s" } }));
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: t1 })]), { ...opts(), deliver });

    const t2 = "2026-09-13T00:30:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: t2, premiumDiscountPct: { status: "ok", value: 0.35, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t2 }, asOf: t2, source: "s" } }));
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: t2 })]), { ...opts(), deliver });

    const t3 = "2026-09-13T00:45:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: t3, premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t3 }, asOf: t3, source: "s" } }));
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: t3 })]), { ...opts(), deliver });

    expect(calls.map((e) => e.eventType)).toEqual(["new_risk", "escalation", "recovery"]);
  });

  it("6. separate symbols deliver independently", async () => {
    seedMatureHistory("AAPL", 0.1, "2026-09-13T00:00:00.000Z");
    seedMatureHistory("GOOGL", 3.0, "2026-09-13T00:00:00.000Z");
    const { deliver, calls } = fakeDelivery();
    await processCaptureRunForAlerts(
      syntheticCaptureResult([
        seedRecord({ ticker: "AAPL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" } }),
        seedRecord({ ticker: "GOOGL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 3.0, asOf: "x", source: "s" } }),
      ]),
      { ...opts(), deliver },
    );
    const t1 = "2026-09-13T00:15:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: t1, premiumDiscountPct: { status: "ok", value: 2.5, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t1 }, asOf: t1, source: "s" } }));
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "GOOGL", capturedAt: t1, premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t1 }, asOf: t1, source: "s" } }));
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: t1 }), seedRecord({ ticker: "GOOGL", capturedAt: t1 })]), { ...opts(), deliver });

    expect(calls).toHaveLength(2);
    expect(calls.find((e) => e.symbol === "AAPL")!.eventType).toBe("new_risk");
    expect(calls.find((e) => e.symbol === "GOOGL")!.eventType).toBe("recovery");
  });

  it("7. a delivery failure is surfaced visibly as a distinct 'delivery'-stage failure", async () => {
    seedMatureHistory("AAPL", 0.1, "2026-09-13T00:00:00.000Z");
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" } })]), opts()); // seed prior alert state (NORMAL)
    const t1 = "2026-09-13T00:15:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: t1, premiumDiscountPct: { status: "ok", value: 3.0, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t1 }, asOf: t1, source: "s" } }));
    const failingDeliver: AlertDelivery = async () => {
      throw new Error("simulated transport outage");
    };
    const result = await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: t1 })]), { ...opts(), deliver: failingDeliver });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.stage).toBe("delivery");
    expect(result.failures[0]!.error).toMatch(/simulated transport outage/);
    // The event WAS decided (processed reflects it) even though delivery failed.
    expect(result.processed[0]!.event).not.toBeNull();
  });

  it("8. a delivery failure does not delete/corrupt the already-successfully-written snapshot", async () => {
    seedMatureHistory("AAPL", 0.1, "2026-09-13T00:00:00.000Z");
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" } })]), opts());
    const t1 = "2026-09-13T00:15:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: t1, premiumDiscountPct: { status: "ok", value: 3.0, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t1 }, asOf: t1, source: "s" } }));
    const snapshotPath = join(dataDir, "ticker-snapshots.jsonl");
    const before = readFileSync(snapshotPath, "utf-8");

    const failingDeliver: AlertDelivery = async () => {
      throw new Error("simulated transport outage");
    };
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: t1 })]), { ...opts(), deliver: failingDeliver });

    expect(readFileSync(snapshotPath, "utf-8")).toBe(before);
  });

  it("9. a delivery failure does not reset or regress alert state — state already reflects the new observation", async () => {
    seedMatureHistory("AAPL", 0.1, "2026-09-13T00:00:00.000Z");
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" } })]), opts());
    const t1 = "2026-09-13T00:15:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: t1, premiumDiscountPct: { status: "ok", value: 3.0, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t1 }, asOf: t1, source: "s" } }));
    const failingDeliver: AlertDelivery = async () => {
      throw new Error("simulated transport outage");
    };
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: t1 })]), { ...opts(), deliver: failingDeliver });

    const state = readAlertState({ filePath: alertStatePath });
    // Known, documented, accepted limitation: state ALREADY advanced
    // (processRiskForAlerts persists internally, before delivery is ever
    // attempted) — this is exactly what the module doc describes, not a
    // bug. Confirm it is truthful, not regressed to the pre-transition value.
    expect(state.AAPL!.lastEvaluatedCapturedAt).toBe(t1);
    expect(state.AAPL!.lastClassification).toBe("SEVERE");
  });

  it("10. the first observation still seeds state and calls delivery zero times, even with a delivery function present", async () => {
    const capturedAt = "2026-09-13T00:00:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt }));
    const { deliver, calls } = fakeDelivery();
    const result = await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt })]), { ...opts(), deliver });
    expect(result.processed[0]!.event).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("the delivered event is frozen — a delivery implementation cannot mutate the canonical event", async () => {
    seedMatureHistory("AAPL", 0.1, "2026-09-13T00:00:00.000Z");
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" } })]), opts());
    const t1 = "2026-09-13T00:15:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: t1, premiumDiscountPct: { status: "ok", value: 3.0, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t1 }, asOf: t1, source: "s" } }));

    let observed: AlertEvent | undefined;
    const mutatingDeliver: AlertDelivery = async (event) => {
      observed = event as AlertEvent;
      expect(() => {
        (event as { symbol: string }).symbol = "TAMPERED";
      }).toThrow();
    };
    const result = await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: t1 })]), { ...opts(), deliver: mutatingDeliver });
    expect(observed!.symbol).toBe("AAPL"); // unchanged despite the attempted mutation
    expect(result.processed[0]!.event!.symbol).toBe("AAPL");
  });
});

describe("defaultAlertDelivery — preserves the existing PARITY_ALERT_EVENT structured log exactly", () => {
  it("used automatically when no deliver option is supplied", async () => {
    seedMatureHistory("AAPL", 0.1, "2026-09-13T00:00:00.000Z");
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" } })]), opts());
    const t1 = "2026-09-13T00:15:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: t1, premiumDiscountPct: { status: "ok", value: 3.0, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t1 }, asOf: t1, source: "s" } }));

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: t1 })]), opts()); // no `deliver` supplied
    } finally {
      console.log = originalLog;
    }
    const alertLines = logs.filter((l) => l.startsWith("PARITY_ALERT_EVENT"));
    expect(alertLines).toHaveLength(1);
  });
});
