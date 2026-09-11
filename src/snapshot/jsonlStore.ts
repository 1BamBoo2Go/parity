import { mkdirSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Minimal, append-only JSON Lines (JSONL) storage.
 *
 * Design rationale (per instruction: "simple, durable, append-oriented,
 * suitable for later dashboard/API time-series queries. Avoid premature
 * infrastructure"):
 *   - One JSON object per line. Trivial to query later (read line by line,
 *     filter/aggregate) without a database dependency.
 *   - Writes are pure appends (`appendFileSync` with the `a` flag) — this
 *     process NEVER reads-modifies-rewrites the whole file, and never
 *     truncates it. That is the actual mechanism behind "a rerun cannot
 *     silently corrupt history": every previous byte in the file is
 *     untouched by every subsequent call, by construction, not by careful
 *     bookkeeping that could have a bug in it.
 *   - A crash mid-write can, in the worst case, leave one incomplete
 *     trailing line. It cannot damage any line written before it, and
 *     `readJsonLines` below skips unparseable lines rather than throwing,
 *     so one bad trailing line does not lose the rest of the file either.
 */

/** Append a single JSON-serializable record as one line. Creates parent directories and the file itself if needed. Never truncates existing content. */
export function appendJsonLine(filePath: string, record: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const line = JSON.stringify(record) + "\n";
  appendFileSync(filePath, line, { encoding: "utf-8" });
}

/** Append multiple records as multiple lines in a single write call (still a pure append, never a rewrite). */
export function appendJsonLines(filePath: string, records: unknown[]): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const content = records.map((r) => JSON.stringify(r)).join("\n") + (records.length > 0 ? "\n" : "");
  if (content.length > 0) {
    appendFileSync(filePath, content, { encoding: "utf-8" });
  }
}

/**
 * Read and parse every well-formed line in a JSONL file. Malformed lines
 * (e.g. a truncated trailing line from an interrupted write) are skipped,
 * not thrown — a partial write must not make the rest of the file
 * unreadable. Returns an empty array if the file does not exist yet.
 */
export function readJsonLines<T = unknown>(filePath: string): T[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const raw = readFileSync(filePath, { encoding: "utf-8" });
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const records: T[] = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line) as T);
    } catch {
      // Deliberately swallowed: one malformed line (e.g. a truncated
      // trailing write from an interrupted process) must not make the
      // rest of the file's history unreadable.
      continue;
    }
  }
  return records;
}
