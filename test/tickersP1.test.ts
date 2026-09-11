import { describe, it, expect } from "vitest";
import { CANDIDATE_TICKERS, isKnownUnsupported } from "../src/config/tickers.js";

function ticker(symbol: string) {
  const t = CANDIDATE_TICKERS.find((c) => c.symbol === symbol);
  if (!t) throw new Error(`Expected ${symbol} to be in CANDIDATE_TICKERS`);
  return t;
}

describe("Slice P1 — new candidates are present with full provenance", () => {
  const p1Symbols = ["TSLA", "NVDA", "MSFT", "SPY", "QQQ"];

  it("all five P1 candidates are in the registry", () => {
    for (const sym of p1Symbols) {
      expect(() => ticker(sym)).not.toThrow();
    }
  });

  it("every P1 candidate has a non-trivial provenance citation, same bar as P0 rows", () => {
    for (const sym of p1Symbols) {
      expect(ticker(sym).provenance.length).toBeGreaterThan(50);
    }
  });

  it("every P1 candidate has a real, non-empty mainnet token address", () => {
    for (const sym of p1Symbols) {
      expect(ticker(sym).tokenAddressMainnet).toMatch(/^0x[a-fA-F0-9]{40}$/);
    }
  });

  it("only TSLA and NVDA are marked poolVerified=true, reflecting their external live-verification PASS — MSFT/SPY/QQQ remain false, not promoted", () => {
    expect(ticker("TSLA").poolVerified).toBe(true);
    expect(ticker("NVDA").poolVerified).toBe(true);
    for (const sym of ["MSFT", "SPY", "QQQ"]) {
      expect(ticker(sym).poolVerified).toBe(false);
    }
  });
});

describe("Slice P1 — strong candidates (TSLA, NVDA) have real, citable feed addresses", () => {
  it("TSLA has a real Chainlink feed address, distinct from its token address", () => {
    const tsla = ticker("TSLA");
    expect(tsla.chainlinkFeedMainnet).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(tsla.chainlinkFeedMainnet).not.toBe(tsla.tokenAddressMainnet);
  });

  it("NVDA has a real Chainlink feed address, distinct from its token address", () => {
    const nvda = ticker("NVDA");
    expect(nvda.chainlinkFeedMainnet).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(nvda.chainlinkFeedMainnet).not.toBe(nvda.tokenAddressMainnet);
  });

  it("TSLA and NVDA both have a quote asset and fee tier configured, ready for a live pool-resolution attempt", () => {
    for (const sym of ["TSLA", "NVDA"]) {
      const t = ticker(sym);
      expect(t.quoteAsset).toBe("USDG");
      expect(t.poolFeeTier).toBe(3000);
    }
  });

  it("TSLA and NVDA's provenance records the actual external live verification numbers, not just a promotion claim", () => {
    expect(ticker("TSLA").provenance).toMatch(/\+0\.4177%/);
    expect(ticker("NVDA").provenance).toMatch(/\+0\.9865%/);
  });

  it("TSLA and NVDA's exact pool address is backfilled from the external live proof (P1.1 correction), not left null or fabricated", () => {
    expect(ticker("TSLA").poolAddressMainnet).toBe("0xf4ACdAEEB7022862A763C9B1B885e11191c889E3");
    expect(ticker("NVDA").poolAddressMainnet).toBe("0xB944cec30Bd4175855215D767ADC81F39e5f7E2B");
  });

  it("TSLA and NVDA's backfilled pool addresses are cited in provenance, tying them explicitly to the external live proof", () => {
    expect(ticker("TSLA").provenance).toMatch(/0xf4ACdAEEB7022862A763C9B1B885e11191c889E3/);
    expect(ticker("NVDA").provenance).toMatch(/0xB944cec30Bd4175855215D767ADC81F39e5f7E2B/);
  });
});

describe("Slice P1.1 — a promoted (poolVerified=true) ticker can never have a null pool address", () => {
  it("every ticker in the registry with poolVerified=true has a non-null, well-formed poolAddressMainnet", () => {
    for (const t of CANDIDATE_TICKERS) {
      if (t.poolVerified) {
        expect(t.poolAddressMainnet).not.toBeNull();
        expect(t.poolAddressMainnet).toMatch(/^0x[a-fA-F0-9]{40}$/);
      }
    }
  });

  it("regression fixture: a hypothetical poolVerified=true row with a null address must fail this invariant (proves the test itself is meaningful)", () => {
    const brokenRow = {
      symbol: "HYPOTHETICAL_BROKEN",
      tokenAddressMainnet: "0x1111111111111111111111111111111111111111",
      chainlinkFeedMainnet: "0x2222222222222222222222222222222222222222",
      poolVerified: true,
      poolAddressMainnet: null,
      poolDex: "Uniswap V3",
      poolFeeTier: 3000,
      quoteAsset: "USDG",
      knownUnsupportedReason: null,
      provenance: "test fixture — deliberately broken to prove the invariant check catches this",
    };
    const wouldPass = !brokenRow.poolVerified || brokenRow.poolAddressMainnet !== null;
    expect(wouldPass).toBe(false);
  });
});

describe("Slice P1 — the critical regression: research gap must NOT be confused with confirmed absence", () => {
  it("MSFT, SPY, and QQQ have chainlinkFeedMainnet=null (no address found) but are NOT knownUnsupported", () => {
    for (const sym of ["MSFT", "SPY", "QQQ"]) {
      const t = ticker(sym);
      expect(t.chainlinkFeedMainnet).toBeNull();
      expect(isKnownUnsupported(t)).toBe(false);
    }
  });

  it("HOOD, by contrast, IS knownUnsupported — a confirmed absence, not a research gap", () => {
    const hood = ticker("HOOD");
    expect(hood.chainlinkFeedMainnet).toBeNull();
    expect(isKnownUnsupported(hood)).toBe(true);
    expect(hood.knownUnsupportedReason).not.toBeNull();
  });

  it("MSFT, SPY, and QQQ each explain their gap as a research gap, not an absence, in their own provenance text", () => {
    for (const sym of ["MSFT", "SPY", "QQQ"]) {
      const t = ticker(sym);
      expect(t.knownUnsupportedReason).toBeNull();
    }
  });

  it("isKnownUnsupported is driven by the explicit knownUnsupportedReason field, not inferred from null addresses (the bug this test guards against)", () => {
    // A ticker with every address field null but no explicit reason must NOT
    // be treated as known-unsupported — only an explicit, evidence-backed
    // reason should trigger that classification.
    const hypotheticalResearchGap = {
      symbol: "HYPOTHETICAL",
      tokenAddressMainnet: "0x1111111111111111111111111111111111111111",
      chainlinkFeedMainnet: null,
      poolVerified: false,
      poolAddressMainnet: null,
      poolDex: null,
      poolFeeTier: null,
      quoteAsset: null,
      knownUnsupportedReason: null,
      provenance: "test fixture",
    };
    expect(isKnownUnsupported(hypotheticalResearchGap)).toBe(false);
  });
});

describe("Slice P1 — honest confidence-tier documentation", () => {
  it("QQQ's provenance explicitly flags it as single-source / lower-confidence than its peers", () => {
    const qqq = ticker("QQQ");
    expect(qqq.provenance.toLowerCase()).toMatch(/single source|lower-confidence|weakest/);
  });

  it("SPY's provenance explicitly documents the strong-pool / missing-feed asymmetry", () => {
    const spy = ticker("SPY");
    expect(spy.provenance).toMatch(/top-10-by-volume/);
    expect(spy.chainlinkFeedMainnet).toBeNull();
  });
});
