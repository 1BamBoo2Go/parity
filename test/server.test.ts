import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { createApp } from "../src/web/server.js";
import { appendJsonLine } from "../src/snapshot/jsonlStore.js";
import type { TickerSnapshotRecord } from "../src/snapshot/types.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "parity-server-test-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function seedRecord(overrides: Partial<TickerSnapshotRecord> = {}): TickerSnapshotRecord {
  return {
    recordType: "ticker_snapshot",
    runId: "test-run",
    capturedAt: "2026-09-07T12:00:00.000Z",
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

describe("GET /api/tickers", () => {
  it("returns exactly the six supported tickers, even with no data captured (all no_data_yet)", async () => {
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/tickers");
    expect(res.status).toBe(200);
    expect(res.body.tickers).toHaveLength(6);
    expect(res.body.tickers.map((t: { symbol: string }) => t.symbol).sort()).toEqual(
      ["AAPL", "GOOGL", "NVDA", "SPCX", "TSLA", "USO"].sort(),
    );
    for (const t of res.body.tickers) {
      expect(t.overallStatus).toBe("no_data_yet");
    }
  });

  it("reflects a real captured snapshot once one exists", async () => {
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord());
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/tickers");
    const aapl = res.body.tickers.find((t: { symbol: string }) => t.symbol === "AAPL");
    expect(aapl.overallStatus).toBe("healthy_current");
    expect(aapl.premiumDiscountPct.value).toBeCloseTo(0.26);
  });

  it("never serializes an unavailable field's value as 0", async () => {
    appendJsonLine(
      join(dataDir, "ticker-snapshots.jsonl"),
      seedRecord({ premiumDiscountPct: { status: "unavailable", reason: "implausible_result", detail: "d", source: "s" } }),
    );
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/tickers");
    const aapl = res.body.tickers.find((t: { symbol: string }) => t.symbol === "AAPL");
    expect(aapl.premiumDiscountPct.status).toBe("unavailable");
    expect(aapl.premiumDiscountPct.value).toBeNull();
  });
});

describe("GET /api/tickers/:symbol", () => {
  it("returns 404 with a clear error for an unsupported ticker", async () => {
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/tickers/MSFT");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("unsupported_ticker");
  });

  it("returns 404 for a nonsense symbol rather than crashing", async () => {
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/tickers/NOTATICKER");
    expect(res.status).toBe(404);
  });

  it("returns full detail for a supported ticker with data, including provenance rows", async () => {
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord());
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/tickers/AAPL");
    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe("AAPL");
    expect(res.body.configuredPoolAddress).toBe("0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed");
    expect(res.body.provenance).toHaveLength(7);
  });

  it("is case-insensitive on the symbol path param", async () => {
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord());
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/tickers/aapl");
    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe("AAPL");
  });
});

describe("GET /api/tickers/:symbol/history", () => {
  it("returns 404 for an unsupported ticker", async () => {
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/tickers/SPY/history");
    expect(res.status).toBe(404);
  });

  it("returns an empty points array for a supported ticker with no history", async () => {
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/tickers/AAPL/history");
    expect(res.status).toBe(200);
    expect(res.body.points).toEqual([]);
  });

  it("returns gap-preserving points, with null (not 0) for an unavailable field", async () => {
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ capturedAt: "2026-09-07T10:00:00.000Z" }));
    appendJsonLine(
      join(dataDir, "ticker-snapshots.jsonl"),
      seedRecord({
        capturedAt: "2026-09-07T11:00:00.000Z",
        premiumDiscountPct: { status: "unavailable", reason: "rpc_unreachable", detail: "d", source: "s" },
      }),
    );
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/tickers/AAPL/history");
    expect(res.status).toBe(200);
    expect(res.body.points).toHaveLength(2);
    expect(res.body.points[1].premiumDiscountPct).toBeNull();
  });

  it("respects a limit query parameter", async () => {
    for (let i = 0; i < 5; i++) {
      appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ capturedAt: `2026-09-07T1${i}:00:00.000Z` }));
    }
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/tickers/AAPL/history?limit=2");
    expect(res.body.points).toHaveLength(2);
  });
});

describe("GET / — static frontend", () => {
  it("serves the dashboard HTML shell", async () => {
    const app = createApp({ dataDir });
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Parity");
  });

  it("serves app.js without any embedded secret-looking value", async () => {
    const app = createApp({ dataDir });
    const res = await request(app).get("/app.js");
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/proapi_[a-z0-9]{10,}/i);
    expect(res.text).not.toMatch(/BLOCKSCOUT_API_KEY\s*[:=]\s*['"][a-zA-Z0-9]{10,}/);
  });
});

describe("GET /api/tickers and /api/tickers/:symbol — intelligence propagation through the API (Slice P3)", () => {
  function seedMatureHistory(symbol: string, pct: number) {
    for (let i = 0; i < 250; i++) {
      const capturedAt = new Date(Date.parse("2026-08-01T00:00:00.000Z") + i * 60 * 60000).toISOString();
      appendJsonLine(
        join(dataDir, "ticker-snapshots.jsonl"),
        seedRecord({
          ticker: symbol,
          capturedAt,
          chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: capturedAt }, asOf: capturedAt, source: "s" },
          premiumDiscountPct: { status: "ok", value: pct, asOf: capturedAt, source: "s" },
        }),
      );
    }
  }

  it("GET /api/tickers exposes a compact intelligence summary for every ticker", async () => {
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/tickers");
    expect(res.status).toBe(200);
    for (const row of res.body.tickers) {
      expect(row.intelligence).toBeDefined();
      expect(row.intelligence.maturity).toBe("INSUFFICIENT_DATA");
      expect(typeof row.intelligence.label).toBe("string");
    }
  });

  it("GET /api/tickers/:symbol exposes full intelligence detail, including the baseline", async () => {
    seedMatureHistory("AAPL", 0.1);
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/tickers/AAPL");
    expect(res.status).toBe(200);
    expect(res.body.intelligenceDetail).toBeDefined();
    expect(res.body.intelligenceDetail.maturity).toBe("MATURE");
    expect(res.body.intelligenceDetail.baseline.observationCount).toBe(250);
    expect(res.body.intelligenceDetail.classification).toBe("NORMAL");
  });

  it("maturity/classification agree between GET /api/tickers and GET /api/tickers/:symbol for the same ticker", async () => {
    seedMatureHistory("AAPL", 3.0); // a dramatic move against a flat baseline -> SEVERE
    const app = createApp({ dataDir });
    const gridRes = await request(app).get("/api/tickers");
    const detailRes = await request(app).get("/api/tickers/AAPL");

    const aaplRow = gridRes.body.tickers.find((t: { symbol: string }) => t.symbol === "AAPL");
    expect(aaplRow.intelligence.maturity).toBe(detailRes.body.intelligenceDetail.maturity);
    expect(aaplRow.intelligence.classification).toBe(detailRes.body.intelligenceDetail.classification);
    expect(aaplRow.intelligence.relativeDeviationMultiple).toBe(detailRes.body.intelligenceDetail.relativeDeviationMultiple);
  });

  it("immature (DEVELOPING) history is never mislabeled NORMAL through the API — classification is null, but the eligible current deviation is still exposed", async () => {
    for (let i = 0; i < 29; i++) {
      const capturedAt = new Date(Date.parse("2026-09-01T00:00:00.000Z") + i * 60 * 60000).toISOString();
      appendJsonLine(
        join(dataDir, "ticker-snapshots.jsonl"),
        seedRecord({
          ticker: "GOOGL",
          capturedAt,
          chainlinkReference: { status: "ok", value: { normalizedPrice: 338, decimals: 8, updatedAt: capturedAt }, asOf: capturedAt, source: "s" },
          premiumDiscountPct: { status: "ok", value: 0.1, asOf: capturedAt, source: "s" },
        }),
      );
    }
    // The current (most recent) record — eligible, with a distinct value so
    // it's unambiguous this is "the current deviation," not a baseline value.
    const currentCapturedAt = new Date(Date.parse("2026-09-01T00:00:00.000Z") + 29 * 60 * 60000).toISOString();
    appendJsonLine(
      join(dataDir, "ticker-snapshots.jsonl"),
      seedRecord({
        ticker: "GOOGL",
        capturedAt: currentCapturedAt,
        chainlinkReference: { status: "ok", value: { normalizedPrice: 338, decimals: 8, updatedAt: currentCapturedAt }, asOf: currentCapturedAt, source: "s" },
        premiumDiscountPct: { status: "ok", value: -0.0932, asOf: currentCapturedAt, source: "s" },
      }),
    );
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/tickers/GOOGL");
    expect(res.body.intelligenceDetail.maturity).toBe("DEVELOPING");
    // REGRESSION (real VPS finding): classification must stay null/unavailable...
    expect(res.body.intelligenceDetail.classification).toBeNull();
    expect(res.body.intelligenceDetail.relativeDeviationMultiple).toBeNull();
    expect(res.body.intelligenceDetail.episode).toBeNull();
    // ...but the eligible current deviation must NOT be nulled alongside it.
    expect(res.body.intelligenceDetail.currentPremiumDiscountPct).toBeCloseTo(-0.0932, 6);
    expect(res.body.intelligenceDetail.currentAbsDeviationFromParityPct).toBeCloseTo(0.0932, 6);

    const gridRes = await request(app).get("/api/tickers");
    const googlRow = gridRes.body.tickers.find((t: { symbol: string }) => t.symbol === "GOOGL");
    expect(googlRow.intelligence.classification).toBeNull();
  });

  it("an unavailable current observation serializes as null through the API, never a stale value or zero", async () => {
    // 250 fresh mature-baseline records, then a final record whose reference is stale-by-P3's rule.
    for (let i = 0; i < 250; i++) {
      const capturedAt = new Date(Date.parse("2026-08-01T00:00:00.000Z") + i * 60 * 60000).toISOString();
      appendJsonLine(
        join(dataDir, "ticker-snapshots.jsonl"),
        seedRecord({
          ticker: "USO",
          capturedAt,
          chainlinkReference: { status: "ok", value: { normalizedPrice: 141, decimals: 8, updatedAt: capturedAt }, asOf: capturedAt, source: "s" },
          premiumDiscountPct: { status: "ok", value: 0.1, asOf: capturedAt, source: "s" },
        }),
      );
    }
    const staleCapturedAt = "2026-09-11T10:00:00.000Z";
    appendJsonLine(
      join(dataDir, "ticker-snapshots.jsonl"),
      seedRecord({
        ticker: "USO",
        capturedAt: staleCapturedAt,
        chainlinkReference: { status: "ok", value: { normalizedPrice: 141, decimals: 8, updatedAt: "2026-01-01T00:00:00.000Z" }, asOf: staleCapturedAt, source: "s" },
        premiumDiscountPct: { status: "ok", value: 0.1, asOf: staleCapturedAt, source: "s" },
      }),
    );
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/tickers/USO");
    expect(res.body.intelligenceDetail.maturity).toBe("MATURE");
    expect(res.body.intelligenceDetail.classification).toBeNull();
    expect(res.body.intelligenceDetail.currentPremiumDiscountPct).toBeNull();
    expect(res.body.intelligenceDetail.episode).toEqual({ state: "current_observation_unavailable" });
  });

  it("excludedByFreshnessCount is exposed and accurate through the detail API response", async () => {
    for (let i = 0; i < 25; i++) {
      const capturedAt = new Date(Date.parse("2026-08-01T00:00:00.000Z") + i * 60 * 60000).toISOString();
      appendJsonLine(
        join(dataDir, "ticker-snapshots.jsonl"),
        seedRecord({
          ticker: "SPCX",
          capturedAt,
          chainlinkReference: { status: "ok", value: { normalizedPrice: 147, decimals: 8, updatedAt: capturedAt }, asOf: capturedAt, source: "s" },
          premiumDiscountPct: { status: "ok", value: 0.1, asOf: capturedAt, source: "s" },
        }),
      );
    }
    const p3StaleCapturedAt = "2026-08-02T02:00:00.000Z";
    appendJsonLine(
      join(dataDir, "ticker-snapshots.jsonl"),
      seedRecord({
        ticker: "SPCX",
        capturedAt: p3StaleCapturedAt,
        chainlinkReference: { status: "ok", value: { normalizedPrice: 147, decimals: 8, updatedAt: "2026-01-01T00:00:00.000Z" }, asOf: p3StaleCapturedAt, source: "s" },
        premiumDiscountPct: { status: "ok", value: 0.1, asOf: p3StaleCapturedAt, source: "s" },
      }),
    );
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/tickers/SPCX");
    expect(res.body.intelligenceDetail.baseline.excludedByFreshnessCount).toBe(1);
    expect(res.body.intelligenceDetail.baseline.observationCount).toBe(25);
  });
});
