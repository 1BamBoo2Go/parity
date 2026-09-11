import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureRun } from "../src/snapshot/captureRun.js";
import { readJsonLines } from "../src/snapshot/jsonlStore.js";
import type { CaptureDeps } from "../src/snapshot/captureTickerSnapshot.js";
import { CANDIDATE_TICKERS } from "../src/config/tickers.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "parity-capturerun-test-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

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
    resolvePool: async () => null, // no pool found — a legitimate, common outcome, not an error
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

describe("captureRun — full happy path persists to all three series", () => {
  it("writes exactly six ticker records, one registry record, and one gas record", async () => {
    const result = await captureRun({ dataDir, deps: workingDeps(), fetchRegistry: workingRegistry, captureGas: workingGas });

    expect(result.tickerRecords).toHaveLength(6);
    expect(result.registryCaptured).toBe(true);
    expect(result.gasCaptured).toBe(true);
    expect(result.tickerErrors).toEqual([]);

    const tickerLines = readJsonLines(join(dataDir, "ticker-snapshots.jsonl"));
    const registryLines = readJsonLines(join(dataDir, "registry-snapshots.jsonl"));
    const gasLines = readJsonLines(join(dataDir, "gas-snapshots.jsonl"));
    expect(tickerLines).toHaveLength(6);
    expect(registryLines).toHaveLength(1);
    expect(gasLines).toHaveLength(1);
  });

  it("every record from one run shares the same runId, for later retry/dedup attribution", async () => {
    const result = await captureRun({ dataDir, deps: workingDeps(), fetchRegistry: workingRegistry, captureGas: workingGas });
    for (const record of result.tickerRecords) {
      expect(record.runId).toBe(result.runId);
    }
  });
});

describe("captureRun — partial failure isolation at the run level", () => {
  it("a registry fetch failure does not prevent gas capture or any ticker's price/feed data from being captured", async () => {
    const failingRegistry = async (): Promise<never> => {
      throw new Error("simulated registry outage");
    };
    const result = await captureRun({ dataDir, deps: workingDeps(), fetchRegistry: failingRegistry, captureGas: workingGas });

    expect(result.registryCaptured).toBe(false);
    expect(result.gasCaptured).toBe(true);
    expect(result.tickerRecords).toHaveLength(6);
    for (const record of result.tickerRecords) {
      expect(record.robinhoodAssetStatus.status).toBe("unavailable");
      expect(record.robinhoodPrice.status).toBe("ok"); // completely unaffected by the registry failure
    }
    // Registry file should not exist / have no records — but this must not
    // have thrown or aborted the rest of the run.
    expect(readJsonLines(join(dataDir, "registry-snapshots.jsonl"))).toHaveLength(0);
    expect(readJsonLines(join(dataDir, "ticker-snapshots.jsonl"))).toHaveLength(6);
  });

  it("a gas capture failure does not prevent registry or ticker capture", async () => {
    const failingGas = async (): Promise<never> => {
      throw new Error("simulated RPC failure reading latest block");
    };
    const result = await captureRun({ dataDir, deps: workingDeps(), fetchRegistry: workingRegistry, captureGas: failingGas });

    expect(result.gasCaptured).toBe(false);
    expect(result.registryCaptured).toBe(true);
    expect(result.tickerRecords).toHaveLength(6);
  });

  it("one ticker's capture throwing an unexpected error does not stop the remaining tickers from being captured and persisted", async () => {
    const deps = workingDeps();
    let callCount = 0;
    const originalFetchPrice = deps.fetchPrice;
    deps.fetchPrice = async (symbol: string) => {
      callCount++;
      if (symbol === "GOOGL") {
        throw new Error("simulated total meltdown for this one ticker");
      }
      return originalFetchPrice(symbol);
    };

    const result = await captureRun({ dataDir, deps, fetchRegistry: workingRegistry, captureGas: workingGas });

    // GOOGL still produces a record (captureTickerSnapshot catches its own
    // internal errors), just with robinhoodPrice unavailable — it is not
    // dropped from the run, and every other ticker is completely unaffected.
    expect(result.tickerRecords).toHaveLength(6);
    const googl = result.tickerRecords.find((r) => r.ticker === "GOOGL")!;
    expect(googl.robinhoodPrice.status).toBe("unavailable");
    const others = result.tickerRecords.filter((r) => r.ticker !== "GOOGL");
    for (const r of others) {
      expect(r.robinhoodPrice.status).toBe("ok");
    }
    expect(callCount).toBe(6);
  });
});

describe("captureRun — retry/rerun safety at the run level", () => {
  it("running captureRun twice appends a second full set of records without losing or altering the first", async () => {
    const firstResult = await captureRun({ dataDir, deps: workingDeps(), fetchRegistry: workingRegistry, captureGas: workingGas });
    const secondResult = await captureRun({ dataDir, deps: workingDeps(), fetchRegistry: workingRegistry, captureGas: workingGas });

    expect(firstResult.runId).not.toBe(secondResult.runId);

    const tickerLines = readJsonLines<{ runId: string }>(join(dataDir, "ticker-snapshots.jsonl"));
    const registryLines = readJsonLines<{ runId: string }>(join(dataDir, "registry-snapshots.jsonl"));
    const gasLines = readJsonLines<{ runId: string }>(join(dataDir, "gas-snapshots.jsonl"));

    expect(tickerLines).toHaveLength(12); // 6 + 6, none overwritten
    expect(registryLines).toHaveLength(2);
    expect(gasLines).toHaveLength(2);

    const runIdsInTickerFile = new Set(tickerLines.map((r) => r.runId));
    expect(runIdsInTickerFile.has(firstResult.runId)).toBe(true);
    expect(runIdsInTickerFile.has(secondResult.runId)).toBe(true);
  });
});
