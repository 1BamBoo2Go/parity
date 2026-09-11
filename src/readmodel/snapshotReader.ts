import { join } from "node:path";
import { readJsonLines } from "../snapshot/jsonlStore.js";
import type { TickerSnapshotRecord } from "../snapshot/types.js";

export interface SnapshotReaderOptions {
  dataDir?: string;
}

const DEFAULT_DATA_DIR = join(process.cwd(), "data", "snapshots");

function tickerSnapshotsPath(dataDir: string): string {
  return join(dataDir, "ticker-snapshots.jsonl");
}

/**
 * Read every persisted ticker-snapshot record. Malformed lines are already
 * skipped by `readJsonLines` (a P1.2b guarantee — a truncated trailing
 * write cannot make the rest of the file unreadable); this function adds
 * no additional parsing logic of its own.
 */
export function readAllTickerSnapshots(options: SnapshotReaderOptions = {}): TickerSnapshotRecord[] {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  return readJsonLines<TickerSnapshotRecord>(tickerSnapshotsPath(dataDir));
}

/**
 * The most recent snapshot for a given ticker, or `null` if none has ever
 * been captured. `null` is a distinct, meaningful case — "we have never
 * observed this ticker" is different from "we observed it and it failed,"
 * and callers must not conflate the two.
 */
export function readLatestTickerSnapshot(symbol: string, options: SnapshotReaderOptions = {}): TickerSnapshotRecord | null {
  const all = readAllTickerSnapshots(options).filter((r) => r.ticker === symbol);
  if (all.length === 0) return null;
  // Records are appended in capture order, but sort defensively by
  // capturedAt rather than assuming file order — cheap, and protects
  // against any future out-of-order write path.
  all.sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
  return all[all.length - 1] ?? null;
}

/**
 * Historical snapshots for a given ticker, oldest first, optionally capped
 * to the most recent `limit` points. No interpolation, no gap-filling — a
 * ticker with 3 captured points and 2 failed attempts still returns
 * however many actual records exist; presenting the *values within* those
 * records (including their own possible `unavailable` states) as gaps is
 * the caller's job (see buildTickerHistory.ts), not this function's.
 */
export function readTickerHistory(symbol: string, options: SnapshotReaderOptions & { limit?: number } = {}): TickerSnapshotRecord[] {
  const all = readAllTickerSnapshots(options).filter((r) => r.ticker === symbol);
  all.sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
  if (options.limit && options.limit > 0 && all.length > options.limit) {
    return all.slice(all.length - options.limit);
  }
  return all;
}
