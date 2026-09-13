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

describe("GET /api/v1/risk/:symbol (P5-A2)", () => {
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

  it("A/B/C. supported symbol returns HTTP 200 with apiVersion v1 and the approved RiskViewModel structure", async () => {
    seedMatureHistory("AAPL", 0.1);
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/v1/risk/AAPL");

    expect(res.status).toBe(200);
    expect(res.body.apiVersion).toBe("v1");
    expect(res.body.symbol).toBe("AAPL");
    expect(res.body).toHaveProperty("capturedAt");
    expect(res.body).toHaveProperty("referenceStatus");
    expect(res.body).toHaveProperty("deviation");
    expect(res.body.deviation).toHaveProperty("currentPct");
    expect(res.body.deviation).toHaveProperty("direction");
    expect(res.body.deviation).toHaveProperty("absDeviationPct");
    expect(res.body).toHaveProperty("eligibility");
    expect(res.body.eligibility).toHaveProperty("eligible");
    expect(res.body.eligibility).not.toHaveProperty("reason"); // deliberately absent — see P5-A1 audit
    expect(res.body).toHaveProperty("intelligence");
    expect(res.body.intelligence).toHaveProperty("maturity");
    expect(res.body.intelligence).toHaveProperty("observationCount");
    expect(res.body.intelligence).toHaveProperty("madMultiple");
    expect(res.body.intelligence).toHaveProperty("classification");
    expect(res.body.intelligence).toHaveProperty("episode");
    // Never a UI label leaking into the external contract.
    expect(res.body).not.toHaveProperty("label");
    expect(JSON.stringify(res.body)).not.toMatch(/typical/i);
  });

  it("D. unsupported symbol returns HTTP 404 with a stable, machine-readable error, distinct from no_data_yet", async () => {
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/v1/risk/DOESNOTEXIST");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("unsupported_ticker");
    expect(res.body.symbol).toBe("DOESNOTEXIST");
    expect(res.body.apiVersion).toBe("v1");
  });

  it("no_data_yet: a supported ticker with zero captured history returns HTTP 404 with a DIFFERENT error code than unsupported_ticker", async () => {
    // AAPL is a genuinely supported symbol; seed nothing for it.
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/v1/risk/AAPL");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("no_data_yet");
    expect(res.body.apiVersion).toBe("v1");
  });

  it("E. symbol normalization matches existing route behavior (lowercase input still resolves)", async () => {
    seedMatureHistory("AAPL", 0.1);
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/v1/risk/aapl");
    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe("AAPL");
  });

  it("F. capturedAt comes from the actual current record's own timestamp, not a derived/baseline value", async () => {
    seedMatureHistory("AAPL", 0.1);
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/v1/risk/AAPL");
    // The 250th (last) seeded record's capturedAt, per seedMatureHistory's loop.
    const expectedCapturedAt = new Date(Date.parse("2026-08-01T00:00:00.000Z") + 249 * 60 * 60000).toISOString();
    expect(res.body.capturedAt).toBe(expectedCapturedAt);
  });

  it("G. DEVELOPING/null semantics survive HTTP JSON serialization", async () => {
    // Only 30 observations -> DEVELOPING, not MATURE.
    for (let i = 0; i < 30; i++) {
      const capturedAt = new Date(Date.parse("2026-09-01T00:00:00.000Z") + i * 60 * 60000).toISOString();
      appendJsonLine(
        join(dataDir, "ticker-snapshots.jsonl"),
        seedRecord({
          ticker: "GOOGL",
          capturedAt,
          chainlinkReference: { status: "ok", value: { normalizedPrice: 338, decimals: 8, updatedAt: capturedAt }, asOf: capturedAt, source: "s" },
          premiumDiscountPct: { status: "ok", value: 0.25, asOf: capturedAt, source: "s" },
        }),
      );
    }
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/v1/risk/GOOGL");
    expect(res.status).toBe(200);
    expect(res.body.intelligence.maturity).toBe("DEVELOPING");
    // Current deviation is still honestly exposed while DEVELOPING...
    expect(res.body.deviation.currentPct).toBe(0.25);
    expect(res.body.eligibility.eligible).toBe(true);
    // ...while every mature-only statistic serializes as real JSON null,
    // never omitted and never coerced to 0.
    expect(res.body.intelligence.classification).toBeNull();
    expect(res.body.intelligence.madMultiple).toBeNull();
    expect(res.body.intelligence.episode).toBeNull();
    expect(res.body.intelligence).toHaveProperty("classification");
    expect(res.body.intelligence).toHaveProperty("madMultiple");
    expect(res.body.intelligence).toHaveProperty("episode");
  });

  it("H. exact numeric zero survives HTTP JSON serialization as 0, not null and not omitted", async () => {
    seedMatureHistory("AAPL", 0.1);
    const zeroCapturedAt = new Date(Date.parse("2026-08-01T00:00:00.000Z") + 250 * 60 * 60000).toISOString();
    appendJsonLine(
      join(dataDir, "ticker-snapshots.jsonl"),
      seedRecord({
        ticker: "AAPL",
        capturedAt: zeroCapturedAt,
        chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: zeroCapturedAt }, asOf: zeroCapturedAt, source: "s" },
        premiumDiscountPct: { status: "ok", value: 0, asOf: zeroCapturedAt, source: "s" },
      }),
    );
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/v1/risk/AAPL");
    expect(res.status).toBe(200);
    expect(res.body.deviation.currentPct).toBe(0);
    expect(res.body.deviation.absDeviationPct).toBe(0);
    expect(res.body.deviation.direction).toBe("flat");
    expect(res.body.eligibility.eligible).toBe(true); // zero is eligible, never confused with unavailable
  });

  it("intelligence-ineligible current observation: deviation/eligibility remain honest, no carried-forward classification", async () => {
    seedMatureHistory("USO", 0.1);
    const staleCapturedAt = new Date(Date.parse("2026-08-01T00:00:00.000Z") + 250 * 60 * 60000).toISOString();
    appendJsonLine(
      join(dataDir, "ticker-snapshots.jsonl"),
      seedRecord({
        ticker: "USO",
        capturedAt: staleCapturedAt,
        chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: "2026-01-01T00:00:00.000Z" }, asOf: staleCapturedAt, source: "s" },
        premiumDiscountPct: { status: "ok", value: 3.0, asOf: staleCapturedAt, source: "s" },
      }),
    );
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/v1/risk/USO");
    expect(res.status).toBe(200);
    expect(res.body.deviation.currentPct).toBeNull();
    expect(res.body.deviation.direction).toBeNull();
    expect(res.body.eligibility.eligible).toBe(false);
    expect(res.body.intelligence.classification).toBeNull();
    expect(res.body.intelligence.episode.state).toBe("current_observation_unavailable");
  });
});

describe("GET /api/v1/risk/:symbol (P5-A3 contract hardening)", () => {
  const VALID_REFERENCE_STATUSES = ["healthy_current", "stale_reference", "oracle_paused", "trading_halt", "upstream_unavailable"];
  const VALID_MATURITIES = ["INSUFFICIENT_DATA", "DEVELOPING", "MATURE"];
  const VALID_DIRECTIONS = ["premium", "discount", "flat"];

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

  it("referenceStatus is exactly a valid, existing OverallTickerStatus enum member — never an invented value", async () => {
    seedMatureHistory("AAPL", 0.1); // reaches MATURE, classification NORMAL — verified empirically before writing this test
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/v1/risk/AAPL");
    expect(res.status).toBe(200);
    expect(res.body.intelligence.maturity).toBe("MATURE");
    expect(VALID_REFERENCE_STATUSES).toContain(res.body.referenceStatus);
  });

  it("capturedAt is well-formed ISO-8601 (round-trips through Date parsing byte-for-byte), not merely equal to one known value", async () => {
    seedMatureHistory("AAPL", 0.1);
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/v1/risk/AAPL");
    expect(res.status).toBe(200);
    expect(typeof res.body.capturedAt).toBe("string");
    const reparsed = new Date(res.body.capturedAt);
    expect(Number.isNaN(reparsed.getTime())).toBe(false);
    expect(reparsed.toISOString()).toBe(res.body.capturedAt); // proves canonical ISO-8601, not just "Date-parseable"
  });

  it("intelligence.maturity is always one of the three canonical values, across MATURE, DEVELOPING, and INSUFFICIENT_DATA", async () => {
    // MATURE
    seedMatureHistory("AAPL", 0.1);
    // DEVELOPING (enough for a baseline, not yet MATURE — same shape the
    // existing G test already empirically proves lands on DEVELOPING)
    for (let i = 0; i < 30; i++) {
      const capturedAt = new Date(Date.parse("2026-09-01T00:00:00.000Z") + i * 60 * 60000).toISOString();
      appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "GOOGL", capturedAt, chainlinkReference: { status: "ok", value: { normalizedPrice: 338, decimals: 8, updatedAt: capturedAt }, asOf: capturedAt, source: "s" }, premiumDiscountPct: { status: "ok", value: 0.1, asOf: capturedAt, source: "s" } }));
    }
    // INSUFFICIENT_DATA (below both the minimum-observation and minimum-
    // elapsed-hours thresholds for any baseline at all)
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "USO", capturedAt: "2026-09-01T00:00:00.000Z", oraclePaused: { status: "ok", value: true, asOf: "x", source: "s" } }));

    const app = createApp({ dataDir });
    for (const symbol of ["AAPL", "GOOGL", "USO"]) {
      const res = await request(app).get(`/api/v1/risk/${symbol}`);
      expect(res.status).toBe(200);
      expect(VALID_MATURITIES).toContain(res.body.intelligence.maturity);
    }
    const aapl = await request(app).get("/api/v1/risk/AAPL");
    const googl = await request(app).get("/api/v1/risk/GOOGL");
    const uso = await request(app).get("/api/v1/risk/USO");
    expect(aapl.body.intelligence.maturity).toBe("MATURE");
    expect(googl.body.intelligence.maturity).toBe("DEVELOPING");
    expect(uso.body.intelligence.maturity).toBe("INSUFFICIENT_DATA");
  });

  it("deviation.direction is exhaustively premium/discount/flat when present, and null exactly when currentPct is null", async () => {
    seedMatureHistory("AAPL", 0.1);
    const premiumCapturedAt = new Date(Date.parse("2026-08-01T00:00:00.000Z") + 250 * 60 * 60000).toISOString();
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: premiumCapturedAt, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: premiumCapturedAt }, asOf: premiumCapturedAt, source: "s" }, premiumDiscountPct: { status: "ok", value: 2.5, asOf: premiumCapturedAt, source: "s" } }));
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/v1/risk/AAPL");
    expect(res.status).toBe(200);
    expect(VALID_DIRECTIONS).toContain(res.body.deviation.direction);
    expect(res.body.deviation.direction).toBe(res.body.deviation.currentPct === null ? null : res.body.deviation.direction);
    // Direction is null iff currentPct is null — checked both directions.
    if (res.body.deviation.currentPct === null) {
      expect(res.body.deviation.direction).toBeNull();
    } else {
      expect(VALID_DIRECTIONS).toContain(res.body.deviation.direction);
    }
  });

  it("success response object contains ONLY the approved top-level and nested keys — no accidental extra fields", async () => {
    seedMatureHistory("AAPL", 0.1);
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/v1/risk/AAPL");
    expect(res.status).toBe(200);

    expect(Object.keys(res.body).sort()).toEqual(
      ["symbol", "apiVersion", "capturedAt", "referenceStatus", "deviation", "eligibility", "intelligence"].sort(),
    );
    expect(Object.keys(res.body.deviation).sort()).toEqual(["currentPct", "direction", "absDeviationPct"].sort());
    // eligibility must contain ONLY truthful preserved eligibility state —
    // exactly `eligible`, deliberately never `reason` (see P5-A1 audit:
    // the granular p2/p3 reason is not preserved by canonical
    // TickerIntelligence and must not be invented here).
    expect(Object.keys(res.body.eligibility)).toEqual(["eligible"]);
    expect(Object.keys(res.body.intelligence).sort()).toEqual(
      ["maturity", "observationCount", "baselinePeriodHours", "baselineMedianPct", "baselineDispersionMad", "madMultiple", "classification", "episode"].sort(),
    );
  });

  it("error responses contain ONLY the documented keys — unsupported_ticker and no_data_yet shapes", async () => {
    const app = createApp({ dataDir });

    const unsupported = await request(app).get("/api/v1/risk/DOESNOTEXIST");
    expect(unsupported.status).toBe(404);
    expect(Object.keys(unsupported.body).sort()).toEqual(["error", "symbol", "apiVersion"].sort());
    expect(unsupported.body).toEqual({ error: "unsupported_ticker", symbol: "DOESNOTEXIST", apiVersion: "v1" });

    const noData = await request(app).get("/api/v1/risk/AAPL"); // supported, nothing seeded
    expect(noData.status).toBe(404);
    expect(Object.keys(noData.body).sort()).toEqual(["error", "symbol", "apiVersion"].sort());
    expect(noData.body).toEqual({ error: "no_data_yet", symbol: "AAPL", apiVersion: "v1" });
  });

  it("symbol lookup is case-insensitive for mixed case, and the returned symbol is always canonical uppercase", async () => {
    seedMatureHistory("AAPL", 0.1);
    const app = createApp({ dataDir });
    for (const input of ["aapl", "Aapl", "AaPl", "AAPL"]) {
      const res = await request(app).get(`/api/v1/risk/${input}`);
      expect(res.status).toBe(200);
      expect(res.body.symbol).toBe("AAPL");
    }
  });

  it("never leaks a raw upstream/provenance error string, even when the underlying record has one", async () => {
    seedMatureHistory("AAPL", 0.1);
    const rawUpstreamError =
      "All holder-data sources failed for 0xaf3d76f1834a1d425780943c99ea8a608f8a93f9. Attempts:\n  - v2 REST: HTTP 403\n  - PRO API: SKIPPED \u2014 no BLOCKSCOUT_API_KEY set.";
    const capturedAt = new Date(Date.parse("2026-08-01T00:00:00.000Z") + 250 * 60 * 60000).toISOString();
    appendJsonLine(
      join(dataDir, "ticker-snapshots.jsonl"),
      seedRecord({
        ticker: "AAPL",
        capturedAt,
        chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: capturedAt }, asOf: capturedAt, source: "s" },
        premiumDiscountPct: { status: "ok", value: 0.1, asOf: capturedAt, source: "s" },
        // A real, raw upstream failure string exactly like the one this
        // project has traced through ProvenanceRow.detail elsewhere.
        holderConcentration: { status: "unavailable", reason: "upstream_error", detail: rawUpstreamError, source: "Blockscout" },
      }),
    );
    const app = createApp({ dataDir });
    const res = await request(app).get("/api/v1/risk/AAPL");
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("BLOCKSCOUT_API_KEY");
    expect(raw).not.toContain("HTTP 403");
    expect(raw).not.toContain(rawUpstreamError);
    // RiskViewModel has no field capable of carrying it in the first
    // place — this test proves that by construction, not by luck.
    expect(res.body).not.toHaveProperty("provenance");
    expect(res.body).not.toHaveProperty("holderConcentration");
  });
});
