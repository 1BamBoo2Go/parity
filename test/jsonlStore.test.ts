import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendJsonLine, appendJsonLines, readJsonLines } from "../src/snapshot/jsonlStore.js";

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "parity-jsonl-test-"));
  filePath = join(dir, "nested", "snapshots.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("appendJsonLine / readJsonLines — basic persistence", () => {
  it("creates parent directories that do not exist yet", () => {
    expect(existsSync(join(dir, "nested"))).toBe(false);
    appendJsonLine(filePath, { a: 1 });
    expect(existsSync(join(dir, "nested"))).toBe(true);
  });

  it("writes one record and reads it back identically", () => {
    appendJsonLine(filePath, { symbol: "AAPL", value: 213.45 });
    const records = readJsonLines<{ symbol: string; value: number }>(filePath);
    expect(records).toEqual([{ symbol: "AAPL", value: 213.45 }]);
  });

  it("returns an empty array for a file that does not exist yet, rather than throwing", () => {
    expect(readJsonLines(join(dir, "does-not-exist.jsonl"))).toEqual([]);
  });
});

describe("append-only durability — a rerun cannot silently corrupt history", () => {
  it("multiple appends accumulate; earlier records are never overwritten or truncated", () => {
    appendJsonLine(filePath, { seq: 1 });
    appendJsonLine(filePath, { seq: 2 });
    appendJsonLine(filePath, { seq: 3 });
    const records = readJsonLines<{ seq: number }>(filePath);
    expect(records).toEqual([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
  });

  it("simulates a second scheduler run: content written by an earlier process invocation survives a later one untouched", () => {
    // First "run"
    appendJsonLine(filePath, { runId: "run-1", ticker: "AAPL" });
    const afterFirstRun = readFileSync(filePath, "utf-8");

    // Second "run" (simulating a retry or the next scheduled invocation)
    appendJsonLine(filePath, { runId: "run-2", ticker: "AAPL" });
    const afterSecondRun = readFileSync(filePath, "utf-8");

    // The bytes written by the first run must be an exact, untouched prefix
    // of the file after the second run — this is the actual mechanism that
    // makes "a rerun cannot corrupt history" true, not just documented.
    expect(afterSecondRun.startsWith(afterFirstRun)).toBe(true);
    const records = readJsonLines<{ runId: string }>(filePath);
    expect(records.map((r) => r.runId)).toEqual(["run-1", "run-2"]);
  });

  it("appendJsonLines writes a batch in one call without disturbing prior content", () => {
    appendJsonLine(filePath, { seq: 0 });
    appendJsonLines(filePath, [{ seq: 1 }, { seq: 2 }]);
    const records = readJsonLines<{ seq: number }>(filePath);
    expect(records).toEqual([{ seq: 0 }, { seq: 1 }, { seq: 2 }]);
  });

  it("a malformed trailing line does not make the rest of the file unreadable", () => {
    appendJsonLine(filePath, { seq: 1 });
    appendJsonLine(filePath, { seq: 2 });
    // Simulate a process crashing mid-write, leaving a truncated JSON line.
    appendFileSync(filePath, '{"seq": 3, "incomplete');
    const records = readJsonLines<{ seq: number }>(filePath);
    // The two well-formed lines are still readable; the broken one is skipped, not fatal.
    expect(records).toEqual([{ seq: 1 }, { seq: 2 }]);
  });
});
