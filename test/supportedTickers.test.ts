import { describe, it, expect } from "vitest";
import {
  getSupportedSnapshotTickers,
  getSupportedSnapshotTickerSymbols,
  assertPromotedTickersHaveAddresses,
} from "../src/snapshot/supportedTickers.js";
import { CANDIDATE_TICKERS } from "../src/config/tickers.js";
import type { TickerConfig } from "../src/domain/types.js";

describe("supported-ticker invariant (P1.2: now derived from config, not hardcoded)", () => {
  it("derives exactly the six named tickers from CANDIDATE_TICKERS' poolVerified flag, no more and no less", () => {
    const expected = ["AAPL", "GOOGL", "USO", "SPCX", "TSLA", "NVDA"];
    const symbols = getSupportedSnapshotTickerSymbols();
    expect([...symbols].sort()).toEqual([...expected].sort());
    expect(symbols).toHaveLength(6);
  });

  it("does NOT include MSFT, SPY, QQQ (unverified/incomplete) or HOOD (confirmed unsupported)", () => {
    const symbols = getSupportedSnapshotTickerSymbols();
    for (const excluded of ["MSFT", "SPY", "QQQ", "HOOD"]) {
      expect(symbols).not.toContain(excluded);
    }
  });

  it("SPY specifically is excluded despite having a verified pool, because it lacks a verified feed — promotion requires both, not just one", () => {
    const spy = CANDIDATE_TICKERS.find((t) => t.symbol === "SPY")!;
    expect(spy.poolVerified).toBe(false); // per explicit P1 instruction: not promoted without a verified feed too
    expect(getSupportedSnapshotTickerSymbols()).not.toContain("SPY");
  });

  it("getSupportedSnapshotTickers returns real TickerConfig objects, each with a non-null token address", () => {
    const tickers = getSupportedSnapshotTickers();
    expect(tickers).toHaveLength(6);
    for (const t of tickers) {
      expect(t.tokenAddressMainnet).toMatch(/^0x[a-fA-F0-9]{40}$/);
    }
  });

  it("every supported ticker has a non-null, well-formed Chainlink feed AND pool address (the actual acceptance requirement)", () => {
    const tickers = getSupportedSnapshotTickers();
    for (const t of tickers) {
      expect(t.chainlinkFeedMainnet).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(t.poolAddressMainnet).toMatch(/^0x[a-fA-F0-9]{40}$/);
    }
  });

  it("the four P0 tickers' pool addresses match exactly what was externally verified live during Slice P0's first run", () => {
    const byAddress: Record<string, string> = {
      AAPL: "0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed",
      GOOGL: "0x553e9a453425CD9B90919F317061FbC3794CC57a",
      USO: "0x02175608F1b5E6b5ed221cCFdC7Be197D111D915",
      SPCX: "0xEb07d9587eFD1778dFb9c385Ec43EF6d5F9fE401",
    };
    for (const [symbol, expectedPool] of Object.entries(byAddress)) {
      const t = CANDIDATE_TICKERS.find((c) => c.symbol === symbol)!;
      expect(t.poolAddressMainnet).toBe(expectedPool);
      expect(t.poolVerified).toBe(true);
      expect(t.provenance).toMatch(new RegExp(expectedPool));
    }
  });
});

describe("assertPromotedTickersHaveAddresses — the loud invariant check", () => {
  it("does not throw for the real, current CANDIDATE_TICKERS config", () => {
    expect(() => assertPromotedTickersHaveAddresses(CANDIDATE_TICKERS)).not.toThrow();
  });

  it("throws loudly for a synthetic ticker marked poolVerified=true with a null pool address", () => {
    const broken: TickerConfig[] = [
      {
        symbol: "BROKEN",
        tokenAddressMainnet: "0x1111111111111111111111111111111111111111",
        chainlinkFeedMainnet: "0x2222222222222222222222222222222222222222",
        poolVerified: true,
        poolAddressMainnet: null, // the violation
        poolDex: "Uniswap V3",
        poolFeeTier: 3000,
        quoteAsset: "USDG",
        knownUnsupportedReason: null,
        provenance: "test fixture — deliberately broken",
      },
    ];
    expect(() => assertPromotedTickersHaveAddresses(broken)).toThrow(/invariant violated/);
  });

  it("throws loudly for a synthetic ticker marked poolVerified=true with a null Chainlink feed", () => {
    const broken: TickerConfig[] = [
      {
        symbol: "BROKEN2",
        tokenAddressMainnet: "0x1111111111111111111111111111111111111111",
        chainlinkFeedMainnet: null, // the violation
        poolVerified: true,
        poolAddressMainnet: "0x3333333333333333333333333333333333333333",
        poolDex: "Uniswap V3",
        poolFeeTier: 3000,
        quoteAsset: "USDG",
        knownUnsupportedReason: null,
        provenance: "test fixture — deliberately broken",
      },
    ];
    expect(() => assertPromotedTickersHaveAddresses(broken)).toThrow(/invariant violated/);
  });

  it("does not throw for a ticker that is simply not promoted (poolVerified=false), regardless of null fields", () => {
    const fine: TickerConfig[] = [
      {
        symbol: "FINE",
        tokenAddressMainnet: "0x1111111111111111111111111111111111111111",
        chainlinkFeedMainnet: null,
        poolVerified: false,
        poolAddressMainnet: null,
        poolDex: null,
        poolFeeTier: null,
        quoteAsset: null,
        knownUnsupportedReason: null,
        provenance: "test fixture — an ordinary unpromoted/unverified candidate",
      },
    ];
    expect(() => assertPromotedTickersHaveAddresses(fine)).not.toThrow();
  });
});
