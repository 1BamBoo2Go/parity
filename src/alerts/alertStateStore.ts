import { existsSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import type { DislocationClassification } from "../intelligence/types.js";

/**
 * P5-B2 — durable per-symbol alert state.
 *
 * AUDIT FINDING (see P5-B2 report): the existing persistence convention in
 * this codebase (src/snapshot/jsonlStore.ts) is append-only JSONL,
 * deliberately built for an immutable time-series log, and its reader
 * deliberately SKIPS malformed lines rather than failing — correct for a
 * log where losing one bad trailing line must not lose the rest of
 * history, but wrong for THIS file: alert state is a single, MUTABLE
 * current-state-per-symbol record, and silently discarding a corrupt
 * classification here could fabricate a false "first observation" and
 * cause an incorrect NEW_RISK alert to fire (or, worse, silently suppress
 * a real one) the next time a symbol is evaluated. No existing
 * atomic-write helper was found anywhere in the tree (grepped for
 * renameSync/writeFileSync/fsync across src/) — this file introduces the
 * one needed for a whole-object rewrite, following the standard
 * write-temp / fsync / rename pattern; jsonlStore.ts's append-only writes
 * never needed it.
 *
 * FILE LOCATION: data/alert-state.json — a sibling of data/snapshots/,
 * not inside it, because this is not an append-only time-series log; it
 * is current, mutable, per-symbol state. Already covered by the existing
 * blanket `data/` rule in .gitignore (confirmed by direct inspection) —
 * no gitignore change was needed.
 *
 * CORRUPTION POLICY — explicit choice: FAIL CLOSED. A state file that
 * exists but cannot be parsed as valid JSON, or does not match the
 * expected shape, throws AlertStateCorruptionError rather than being
 * silently reset to empty. Quarantine-and-reset was considered and
 * rejected: silently discarding real prior classification state would
 * make the NEXT evaluation see "no prior state" and could fire a false
 * NEW_RISK alert for a ticker that was already known to be abnormal — an
 * incorrect alert is a worse outcome than a loud, investigable failure. A
 * MISSING file, by contrast, is not corruption — it is the normal,
 * expected state before this system has ever run, and returns a valid
 * empty state with no error.
 */

export interface PerSymbolAlertState {
  lastEvaluatedCapturedAt: string; // ISO-8601, from the real snapshot's own capturedAt
  lastClassification: DislocationClassification | null;
}

export type AlertStateFile = Record<string, PerSymbolAlertState>;

export interface AlertStateStoreOptions {
  /** Defaults to <cwd>/data/alert-state.json, a sibling of data/snapshots/. */
  filePath?: string;
}

const DEFAULT_FILE_PATH = join(process.cwd(), "data", "alert-state.json");

export class AlertStateCorruptionError extends Error {
  constructor(filePath: string, cause: string) {
    super(`Alert state file at ${filePath} is corrupt and was not loaded: ${cause}`);
    this.name = "AlertStateCorruptionError";
  }
}

const VALID_CLASSIFICATIONS: ReadonlySet<string> = new Set(["NORMAL", "ELEVATED", "DISLOCATED", "SEVERE"]);

function isValidPerSymbolState(value: unknown): value is PerSymbolAlertState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.lastEvaluatedCapturedAt !== "string") return false;
  if (Number.isNaN(Date.parse(v.lastEvaluatedCapturedAt))) return false;
  if (v.lastClassification !== null && !VALID_CLASSIFICATIONS.has(v.lastClassification as string)) return false;
  return true;
}

function isValidAlertStateFile(value: unknown): value is AlertStateFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(isValidPerSymbolState);
}

function resolvePath(options: AlertStateStoreOptions | undefined): string {
  return options?.filePath ?? DEFAULT_FILE_PATH;
}

/**
 * Load the current alert state. A missing file is valid, empty state — not
 * corruption. A present-but-unparseable-or-malformed file throws
 * AlertStateCorruptionError (fail closed — see module doc).
 */
export function readAlertState(options?: AlertStateStoreOptions): AlertStateFile {
  const filePath = resolvePath(options);
  if (!existsSync(filePath)) {
    return {};
  }
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new AlertStateCorruptionError(filePath, `unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AlertStateCorruptionError(filePath, "not valid JSON");
  }
  if (!isValidAlertStateFile(parsed)) {
    throw new AlertStateCorruptionError(filePath, "valid JSON but does not match the expected per-symbol alert state shape");
  }
  return parsed;
}

/**
 * Atomically persist the full alert state: write to a temp file in the
 * SAME directory (so the subsequent rename is on the same filesystem and
 * therefore atomic on POSIX), fsync it, close it, then rename over the
 * real path. A process dying at any point before the rename leaves the
 * real file completely untouched; a process dying after the rename has
 * fully committed the new state. There is no window where the real file
 * can observably contain partial/truncated content.
 */
export function writeAlertState(state: AlertStateFile, options?: AlertStateStoreOptions): void {
  const filePath = resolvePath(options);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = join(dir, `.${basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const fd = openSync(tmpPath, "w");
  try {
    writeFileSync(fd, JSON.stringify(state, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmpPath, filePath);
  } catch (err) {
    // Rename failed — clean up the orphaned temp file rather than leaking
    // it, then surface the real error.
    try {
      unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup only
    }
    throw err;
  }
}
