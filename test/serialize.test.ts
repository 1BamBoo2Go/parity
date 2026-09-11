import { describe, it, expect } from "vitest";
import { serializeDataPoint } from "../src/snapshot/serialize.js";
import type { DataPoint } from "../src/domain/types.js";

describe("serializeDataPoint", () => {
  it("converts an 'ok' DataPoint's Date asOf into a valid ISO string, preserving value/status/source", () => {
    const dp: DataPoint<number> = { status: "ok", value: 213.45, asOf: new Date("2026-09-07T12:00:00.000Z"), source: "test" };
    const serialized = serializeDataPoint(dp);
    expect(serialized).toEqual({ status: "ok", value: 213.45, asOf: "2026-09-07T12:00:00.000Z", source: "test" });
  });

  it("passes an 'unavailable' DataPoint through unchanged (no Date field to convert, no value to fabricate)", () => {
    const dp: DataPoint<number> = { status: "unavailable", reason: "rpc_unreachable", detail: "blocked", source: "test" };
    const serialized = serializeDataPoint(dp);
    expect(serialized).toEqual({ status: "unavailable", reason: "rpc_unreachable", detail: "blocked", source: "test" });
    expect((serialized as { value?: unknown }).value).toBeUndefined();
  });
});
