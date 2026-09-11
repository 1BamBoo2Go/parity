import { describe, it, expect } from "vitest";
import { captureTickerSnapshot, type CaptureDeps } from "../src/snapshot/captureTickerSnapshot.js";
import { CANDIDATE_TICKERS } from "../src/config/tickers.js";
import type { TickerConfig } from "../src/domain/types.js";
import type { PublicClient } from "viem";

const aapl = CANDIDATE_TICKERS.find((t) => t.symbol === "AAPL")! as TickerConfig;
const fakeClient = {} as PublicClient; // never actually used by injected fakes below
const registry = {
  assets: [
    {
      id: "1",
      tokenSymbol: "AAPL",
      tokenName: "Apple Inc.",
      deployments: [{ contractAddress: aapl.tokenAddressMainnet!, chainId: 4663 }],
      currentMultiplier: "1.000000000000000000",
      pendingMultiplier: "1.000000000000000000",
      status: "ASSET_STATUS_ACTIVE" as const,
    },
  ],
};

function fullyWorkingDeps(): CaptureDeps {
  return {
    fetchPrice: async () => ({
      tokenSymbol: "AAPL",
      deployments: [],
      bid: "213.40",
      ask: "213.50",
      currency: "USD",
      dailyTradingVolume: "1000000",
      isTradingHalt: false,
      generatedAt: new Date().toISOString(),
    }),
    readFeed: async () => ({
      rawAnswer: 21345000000n,
      decimals: 8,
      normalizedPrice: 213.45,
      updatedAt: new Date(),
      roundId: 1n,
    }),
    readMultiplierState: async () => ({ uiMultiplier: 1_000000000000000000n, oraclePaused: false }),
    resolvePool: async () => "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3",
    readSpotPrice: async () => ({
      poolAddress: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3" as `0x${string}`,
      sqrtPriceX96: 1n,
      token0: aapl.tokenAddressMainnet as `0x${string}`,
      token1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as `0x${string}`,
      rawPriceToken1PerToken0: 0, // unused by the orchestration directly; computeStockTokenPriceInQuoteAsset recomputes from sqrtPriceX96
    }),
    readDecimals: async (_client, address) =>
      address.toLowerCase() === (aapl.tokenAddressMainnet as string).toLowerCase() ? 18 : 6,
    fetchHolders: async () => [
      { address: "0x1", value: "500" },
      { address: "0x2", value: "500" },
    ],
    readSupply: async () => 1000n,
  };
}

// A realistic sqrtPriceX96 producing ~$214 for an 18-vs-6-decimals pair, matching test/poolPrice.test.ts's helper logic.
function realisticSqrtPriceX96(): bigint {
  const humanPrice = 214;
  const decimals0 = 18;
  const decimals1 = 6;
  const rawPrice = humanPrice / 10 ** (decimals0 - decimals1);
  const sqrtPrice = Math.sqrt(rawPrice);
  return BigInt(Math.round(sqrtPrice * 2 ** 96));
}

describe("captureTickerSnapshot — happy path", () => {
  it("produces a fully 'ok' record with a real, plausible premium/discount when every source succeeds", async () => {
    const deps = fullyWorkingDeps();
    deps.readSpotPrice = async () => ({
      poolAddress: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3" as `0x${string}`,
      sqrtPriceX96: realisticSqrtPriceX96(),
      token0: aapl.tokenAddressMainnet as `0x${string}`,
      token1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as `0x${string}`,
      rawPriceToken1PerToken0: 0,
    });

    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run-1", deps);

    expect(record.ticker).toBe("AAPL");
    expect(record.runId).toBe("test-run-1");
    expect(record.robinhoodAssetStatus.status).toBe("ok");
    expect(record.robinhoodPrice.status).toBe("ok");
    expect(record.chainlinkReference.status).toBe("ok");
    expect(record.secondaryPrice.status).toBe("ok");
    expect(record.premiumDiscountPct.status).toBe("ok");
    expect(record.holderConcentration.status).toBe("ok");
    if (record.holderConcentration.status === "ok") {
      expect(record.holderConcentration.value.top1Pct).toBeCloseTo(50, 1);
    }
  });
});

describe("captureTickerSnapshot — timestamp integrity", () => {
  it("capturedAt is a valid, recent ISO-8601 timestamp", async () => {
    const before = Date.now();
    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run-ts", fullyWorkingDeps());
    const after = Date.now();

    const parsed = new Date(record.capturedAt).getTime();
    expect(Number.isNaN(parsed)).toBe(false);
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });

  it("each DataPoint's own asOf (when ok) is also a valid ISO timestamp, not the string 'null' or similar", async () => {
    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run-ts2", fullyWorkingDeps());
    expect(record.robinhoodPrice.status).toBe("ok");
    if (record.robinhoodPrice.status === "ok") {
      expect(Number.isNaN(new Date(record.robinhoodPrice.asOf).getTime())).toBe(false);
    }
  });
});

describe("captureTickerSnapshot — no fabricated zero for unavailable values", () => {
  it("when the Robinhood price fetch fails, the field is unavailable, never a numeric 0", async () => {
    const deps = fullyWorkingDeps();
    deps.fetchPrice = async () => {
      throw new Error("simulated 429 exhausted");
    };
    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run-fail-price", deps);

    expect(record.robinhoodPrice.status).toBe("unavailable");
    expect((record.robinhoodPrice as { value?: unknown }).value).toBeUndefined();
  });

  it("when the Chainlink feed read fails, reference AND premium/discount are unavailable, never zero or fabricated", async () => {
    const deps = fullyWorkingDeps();
    deps.readFeed = async () => {
      throw new Error("simulated host_not_allowed");
    };
    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run-fail-feed", deps);

    expect(record.chainlinkReference.status).toBe("unavailable");
    expect(record.premiumDiscountPct.status).toBe("unavailable");
    expect((record.premiumDiscountPct as { value?: unknown }).value).toBeUndefined();
  });

  it("when holder concentration fails, the field is unavailable — never a fabricated 0% concentration", async () => {
    const deps = fullyWorkingDeps();
    deps.fetchHolders = async () => {
      throw new Error("simulated Blockscout 403");
    };
    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run-fail-holders", deps);

    expect(record.holderConcentration.status).toBe("unavailable");
    expect((record.holderConcentration as { value?: unknown }).value).toBeUndefined();
  });
});

describe("captureTickerSnapshot — partial upstream failure must not invalidate the rest of an otherwise-valid snapshot", () => {
  it("a Blockscout failure alone does not affect reference price, secondary price, or premium/discount", async () => {
    const deps = fullyWorkingDeps();
    deps.readSpotPrice = async () => ({
      poolAddress: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3" as `0x${string}`,
      sqrtPriceX96: realisticSqrtPriceX96(),
      token0: aapl.tokenAddressMainnet as `0x${string}`,
      token1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as `0x${string}`,
      rawPriceToken1PerToken0: 0,
    });
    deps.fetchHolders = async () => {
      throw new Error("simulated Blockscout outage — must not affect anything else");
    };

    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run-partial", deps);

    expect(record.holderConcentration.status).toBe("unavailable");
    // Everything else is completely unaffected by the holders failure:
    expect(record.chainlinkReference.status).toBe("ok");
    expect(record.secondaryPrice.status).toBe("ok");
    expect(record.premiumDiscountPct.status).toBe("ok");
    expect(record.robinhoodPrice.status).toBe("ok");
  });

  it("a Chainlink failure alone does not prevent the Robinhood price or holder concentration from being recorded", async () => {
    const deps = fullyWorkingDeps();
    deps.readFeed = async () => {
      throw new Error("simulated RPC outage");
    };

    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run-partial-2", deps);

    expect(record.chainlinkReference.status).toBe("unavailable");
    expect(record.robinhoodPrice.status).toBe("ok");
    expect(record.holderConcentration.status).toBe("ok");
  });

  it("a registry miss (ticker absent from the live response) does not prevent price/feed/pool data from being captured", async () => {
    const emptyRegistry = { assets: [] };
    const record = await captureTickerSnapshot(aapl, emptyRegistry, fakeClient, "test-run-no-registry", fullyWorkingDeps());

    expect(record.robinhoodAssetStatus.status).toBe("unavailable");
    expect(record.robinhoodPrice.status).toBe("ok");
    expect(record.chainlinkReference.status).toBe("ok");
  });

  it("a null registry (the fetch itself failed this run) is handled the same way, without throwing", async () => {
    const record = await captureTickerSnapshot(aapl, null, fakeClient, "test-run-null-registry", fullyWorkingDeps());
    expect(record.robinhoodAssetStatus.status).toBe("unavailable");
    expect(record.robinhoodPrice.status).toBe("ok");
  });
});
