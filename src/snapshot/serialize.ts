import type { DataPoint } from "../domain/types.js";

/**
 * JSONL-safe representation of a DataPoint: identical discriminated union,
 * but `asOf` is an ISO-8601 string instead of a `Date` (JSON has no native
 * date type, and we want snapshot files to be plain, portable JSON forever,
 * not dependent on any particular deserializer re-hydrating dates).
 *
 * This is a pure, mechanical translation — it does not change which branch
 * a DataPoint is in, and it cannot turn an `unavailable` DataPoint into an
 * `ok` one or vice versa. Missing data stays missing; it never becomes a
 * fabricated value here.
 */
export type SerializedDataPoint<T> =
  | { status: "ok"; value: T; asOf: string; source: string }
  | { status: "unavailable"; reason: string; detail: string; source: string };

export function serializeDataPoint<T>(dp: DataPoint<T>): SerializedDataPoint<T> {
  if (dp.status === "ok") {
    return { status: "ok", value: dp.value, asOf: dp.asOf.toISOString(), source: dp.source };
  }
  return { status: "unavailable", reason: dp.reason, detail: dp.detail, source: dp.source };
}
