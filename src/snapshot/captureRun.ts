import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fetchRobinhoodAssets, type RobinhoodAssetsResponse } from "../sources/robinhoodRegistry.js";
import { createRobinhoodChainClient } from "../sources/evmClient.js";
import { getSupportedSnapshotTickers } from "./supportedTickers.js";
import { captureTickerSnapshot, defaultCaptureDeps, type CaptureDeps } from "./captureTickerSnapshot.js";
import { captureRegistrySnapshot } from "./captureRegistrySnapshot.js";
import { captureGasSnapshot } from "./captureGasSnapshot.js";
import { appendJsonLine } from "./jsonlStore.js";
import type { TickerSnapshotRecord } from "./types.js";

export interface CaptureRunOptions {
  dataDir?: string;
  deps?: CaptureDeps;
  /** Injectable for testing without live network access; defaults to the real implementation. */
  fetchRegistry?: () => Promise<RobinhoodAssetsResponse>;
  /** Injectable for testing without live network access; defaults to the real implementation. */
  captureGas?: (client: ReturnType<typeof createRobinhoodChainClient>, runId: string) => ReturnType<typeof captureGasSnapshot>;
}

export interface CaptureRunResult {
  runId: string;
  tickerRecords: TickerSnapshotRecord[];
  registryCaptured: boolean;
  gasCaptured: boolean;
  tickerErrors: { symbol: string; error: string }[];
}

const DEFAULT_DATA_DIR = join(process.cwd(), "data", "snapshots");

/**
 * Run one full capture cycle: registry (once), gas context (once), then
 * every supported ticker's full snapshot, each independently. A failure in
 * any single piece — the registry fetch, the gas sample, or any one
 * ticker's chain/API reads — is caught, logged into the result, and does
 * NOT prevent every other piece from being captured and persisted. This is
 * the same "one failed upstream source must not corrupt prior history, and
 * must not invalidate an otherwise-valid observation" rule applied at the
 * run level, not just within a single ticker's fields.
 */
export async function captureRun(options: CaptureRunOptions = {}): Promise<CaptureRunResult> {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const deps = options.deps ?? defaultCaptureDeps;
  const fetchRegistryFn = options.fetchRegistry ?? fetchRobinhoodAssets;
  const captureGasFn = options.captureGas ?? captureGasSnapshot;
  const runId = randomUUID();
  const client = createRobinhoodChainClient("mainnet");

  const tickerErrors: { symbol: string; error: string }[] = [];

  // Registry — fetched once, shared by every ticker's status lookup below.
  let registry: RobinhoodAssetsResponse | null = null;
  let registryCaptured = false;
  try {
    registry = await fetchRegistryFn();
    const registryRecord = captureRegistrySnapshot(registry, runId);
    appendJsonLine(join(dataDir, "registry-snapshots.jsonl"), registryRecord);
    registryCaptured = true;
  } catch (err) {
    tickerErrors.push({ symbol: "__registry__", error: err instanceof Error ? err.message : String(err) });
  }

  // Gas context — independent of registry and of every ticker below.
  let gasCaptured = false;
  try {
    const gasRecord = await captureGasFn(client, runId);
    appendJsonLine(join(dataDir, "gas-snapshots.jsonl"), gasRecord);
    gasCaptured = true;
  } catch (err) {
    tickerErrors.push({ symbol: "__gas__", error: err instanceof Error ? err.message : String(err) });
  }

  // Every supported ticker, independently. One ticker throwing does not
  // stop the loop or discard records already captured for other tickers.
  const tickers = getSupportedSnapshotTickers();
  const tickerRecords: TickerSnapshotRecord[] = [];
  for (const ticker of tickers) {
    try {
      const record = await captureTickerSnapshot(ticker, registry, client, runId, deps);
      appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), record);
      tickerRecords.push(record);
    } catch (err) {
      // captureTickerSnapshot is designed to catch its own internal errors
      // per-field and never throw for an ordinary upstream failure — a
      // throw escaping it here means something unexpected happened. Record
      // it and continue with the remaining tickers regardless.
      tickerErrors.push({ symbol: ticker.symbol, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { runId, tickerRecords, registryCaptured, gasCaptured, tickerErrors };
}
