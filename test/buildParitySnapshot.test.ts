import { describe, it, expect } from "vitest";
import { buildParitySnapshot, unsupportedSnapshot } from "../src/parity/buildParitySnapshot.js";
import type { DataPoint, TickerConfig, UnavailableReason } from "../src/domain/types.js";
import { CANDIDATE_TICKERS, isKnownUnsupported } from "../src/config/tickers.js";

const aapl = CANDIDATE_TICKERS.find((t) => t.symbol === "AAPL")! as TickerConfig;
const hood = CANDIDATE_TICKERS.find((t) => t.symbol === "HOOD")! as TickerConfig;
const NOW = new Date("2026-09-07T12:00:00Z");

function ok<T>(value: T, asOf: Date = NOW, source = "test"): DataPoint<T> {
  return { status: "ok", value, asOf, source };
}
function unavailable<T>(reason: UnavailableReason, detail = "test"): DataPoint<T> {
  return { status: "unavailable", reason, detail, source: "test" };
}

describe("buildParitySnapshot — happy path", () => {
  it("computes an ok snapshot when everything is healthy", () => {
    const snap = buildParitySnapshot(aapl, {
      chainlinkReference: ok(213.45),
      secondaryMarket: ok(214.0),
      tradingHalt: ok(false),
      oraclePaused: ok(false),
    }, NOW);

    expect(snap.supportStatus).toBe("ok");
    expect(snap.premiumDiscountPct.status).toBe("ok");
    if (snap.premiumDiscountPct.status === "ok") {
      expect(snap.premiumDiscountPct.value).toBeCloseTo(0.2577, 3);
    }
  });
});

describe("buildParitySnapshot — missing data must never become zero", () => {
  it("does NOT compute a premium/discount when reference is unavailable", () => {
    const snap = buildParitySnapshot(aapl, {
      chainlinkReference: unavailable("rpc_unreachable", "sandbox network policy blocked the RPC host"),
      secondaryMarket: ok(214.0),
      tradingHalt: ok(false),
      oraclePaused: ok(false),
    }, NOW);

    expect(snap.premiumDiscountPct.status).toBe("unavailable");
    expect(snap.supportStatus).toBe("unsupported");
    // Explicitly assert there is no numeric 0 masquerading as a real value.
    expect((snap.premiumDiscountPct as { value?: number }).value).toBeUndefined();
  });

  it("does NOT compute a premium/discount when secondary is unavailable", () => {
    const snap = buildParitySnapshot(aapl, {
      chainlinkReference: ok(213.45),
      secondaryMarket: unavailable("no_verified_pool", "pool not yet confirmed"),
      tradingHalt: ok(false),
      oraclePaused: ok(false),
    }, NOW);

    expect(snap.premiumDiscountPct.status).toBe("unavailable");
    expect(snap.supportStatus).toBe("unsupported");
  });

  it("does NOT compute a premium/discount when BOTH sides are unavailable", () => {
    const snap = buildParitySnapshot(aapl, {
      chainlinkReference: unavailable("rpc_unreachable", "blocked"),
      secondaryMarket: unavailable("no_verified_pool", "not confirmed"),
      tradingHalt: unavailable("upstream_error", "n/a"),
      oraclePaused: unavailable("upstream_error", "n/a"),
    }, NOW);

    expect(snap.premiumDiscountPct.status).toBe("unavailable");
    expect(snap.supportStatus).toBe("unsupported");
  });
});

describe("buildParitySnapshot — stale data must never be presented as current", () => {
  it("downgrades an 'ok' reference to unavailable if it is older than the max age, even though the source itself claimed ok", () => {
    const staleAsOf = new Date(NOW.getTime() - 50 * 3600 * 1000); // 50h old, default max 48h
    const snap = buildParitySnapshot(aapl, {
      chainlinkReference: ok(213.45, staleAsOf),
      secondaryMarket: ok(214.0),
      tradingHalt: ok(false),
      oraclePaused: ok(false),
    }, NOW);

    expect(snap.referencePrice.status).toBe("unavailable");
    if (snap.referencePrice.status === "unavailable") {
      expect(snap.referencePrice.reason).toBe("stale");
    }
    expect(snap.supportStatus).toBe("unsupported");
    expect(snap.premiumDiscountPct.status).toBe("unavailable");
  });

  it("accepts a reference just inside the max age window", () => {
    const freshAsOf = new Date(NOW.getTime() - 47 * 3600 * 1000);
    const snap = buildParitySnapshot(aapl, {
      chainlinkReference: ok(213.45, freshAsOf),
      secondaryMarket: ok(214.0),
      tradingHalt: ok(false),
      oraclePaused: ok(false),
    }, NOW);

    expect(snap.referencePrice.status).toBe("ok");
  });
});

describe("buildParitySnapshot — market-state gating", () => {
  it("marks the snapshot degraded (not ok, not unsupported) during an active trading halt, even with healthy prices", () => {
    const snap = buildParitySnapshot(aapl, {
      chainlinkReference: ok(213.45),
      secondaryMarket: ok(214.0),
      tradingHalt: ok(true),
      oraclePaused: ok(false),
    }, NOW);

    expect(snap.supportStatus).toBe("degraded");
    // Premium/discount can still be computed (the numbers exist), but the
    // caller-facing supportStatus must not read as healthy "ok".
    expect(snap.premiumDiscountPct.status).toBe("ok");
  });

  it("marks the snapshot degraded during an active oracle pause", () => {
    const snap = buildParitySnapshot(aapl, {
      chainlinkReference: ok(213.45),
      secondaryMarket: ok(214.0),
      tradingHalt: ok(false),
      oraclePaused: ok(true),
    }, NOW);

    expect(snap.supportStatus).toBe("degraded");
  });
});

describe("unsupportedSnapshot — the HOOD case (no published Chainlink feed)", () => {
  it("produces an explicit unsupported snapshot rather than omitting the ticker or defaulting values", () => {
    const snap = unsupportedSnapshot(hood, "no_chainlink_feed: Wield repo confirms no published feed for HOOD", NOW);

    expect(snap.symbol).toBe("HOOD");
    expect(snap.supportStatus).toBe("unsupported");
    expect(snap.referencePrice.status).toBe("unavailable");
    expect(snap.premiumDiscountPct.status).toBe("unavailable");
    // Never a numeric 0 standing in for "we don't know".
    expect((snap.referencePrice as { value?: number }).value).toBeUndefined();
    expect((snap.premiumDiscountPct as { value?: number }).value).toBeUndefined();
  });
});

describe("registry sanity — counterfeit-risk awareness is present in config", () => {
  it("every candidate ticker carries a non-empty provenance citation", () => {
    for (const t of CANDIDATE_TICKERS) {
      expect(t.provenance.length).toBeGreaterThan(20);
    }
  });

  it("HOOD is deliberately included as a known-unsupported example, with chainlinkFeedMainnet explicitly null", () => {
    expect(hood.chainlinkFeedMainnet).toBeNull();
  });

  it("poolVerified=true appears only on the six externally-verified supported tickers, each with a documented promotion/correction citation in provenance — every other row remains false", () => {
    const expectedPromoted = ["AAPL", "GOOGL", "USO", "SPCX", "TSLA", "NVDA"];
    for (const t of CANDIDATE_TICKERS) {
      if (t.poolVerified) {
        expect(expectedPromoted).toContain(t.symbol);
        expect(t.provenance).toMatch(/PROMOTED after external live verification|CORRECTED in P1\.2/);
        // The actual acceptance requirement, checked at this level too: never poolVerified=true with a null address.
        expect(t.poolAddressMainnet).not.toBeNull();
        expect(t.chainlinkFeedMainnet).not.toBeNull();
      } else {
        expect(expectedPromoted).not.toContain(t.symbol);
      }
    }
  });
});

describe("isKnownUnsupported — the narrow HOOD-style gap check", () => {
  it("is true for HOOD (no feed, no pool configured)", () => {
    expect(isKnownUnsupported(hood)).toBe(true);
  });

  it("is false for a ticker that has a feed configured, even if its pool is not yet verified", () => {
    expect(isKnownUnsupported(aapl)).toBe(false);
  });
});
