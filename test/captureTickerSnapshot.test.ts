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
      tick: -12345,
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
    readLiquidity: async () => 123456789n,
    readBalanceOf: async () => 987654321n,
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
      tick: -12345,
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
      tick: -12345,
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

describe("captureTickerSnapshot — P5-C0 execution/liquidity telemetry", () => {
  it("preserves sqrtPriceX96 and tick from the same slot0() read secondaryPrice already used — zero additional reads for these two fields", async () => {
    const deps = fullyWorkingDeps();
    let readSpotPriceCallCount = 0;
    const realSqrt = realisticSqrtPriceX96();
    deps.readSpotPrice = async () => {
      readSpotPriceCallCount++;
      return {
        poolAddress: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3" as `0x${string}`,
        sqrtPriceX96: realSqrt,
        tick: -74959,
        token0: aapl.tokenAddressMainnet as `0x${string}`,
        token1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as `0x${string}`,
        rawPriceToken1PerToken0: 0,
      };
    };
    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run", deps);

    expect(readSpotPriceCallCount).toBe(1); // exactly the one call secondaryPrice already required — no second call for telemetry
    expect(record.poolSqrtPriceX96?.status).toBe("ok");
    expect(record.poolSqrtPriceX96?.status === "ok" && record.poolSqrtPriceX96.value).toBe(realSqrt.toString());
    expect(record.poolTick?.status).toBe("ok");
    expect(record.poolTick?.status === "ok" && record.poolTick.value).toBe(-74959);
  });

  it("persists the configured pool fee tier with zero RPC calls (a known config constant, not a DataPoint)", async () => {
    const deps = fullyWorkingDeps();
    deps.readSpotPrice = async () => ({
      poolAddress: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3" as `0x${string}`,
      sqrtPriceX96: realisticSqrtPriceX96(),
      tick: -74959,
      token0: aapl.tokenAddressMainnet as `0x${string}`,
      token1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as `0x${string}`,
      rawPriceToken1PerToken0: 0,
    });
    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run", deps);
    expect(record.poolFeeTierBps).toBe(aapl.poolFeeTier);
    expect(typeof record.poolFeeTierBps).toBe("number");
  });

  it("captures pool liquidity via one additional RPC call, correctly serialized as a string", async () => {
    const deps = fullyWorkingDeps();
    deps.readSpotPrice = async () => ({
      poolAddress: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3" as `0x${string}`,
      sqrtPriceX96: realisticSqrtPriceX96(),
      tick: -74959,
      token0: aapl.tokenAddressMainnet as `0x${string}`,
      token1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as `0x${string}`,
      rawPriceToken1PerToken0: 0,
    });
    let liquidityCallCount = 0;
    deps.readLiquidity = async (_client, poolAddress) => {
      liquidityCallCount++;
      expect(poolAddress).toBe("0xf4ACdAEEB7022862A763C9B1B885e11191c889E3");
      return 123456789012345678901234n; // deliberately larger than Number.MAX_SAFE_INTEGER
    };
    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run", deps);

    expect(liquidityCallCount).toBe(1);
    expect(record.poolLiquidity?.status).toBe("ok");
    expect(record.poolLiquidity?.status === "ok" && record.poolLiquidity.value).toBe("123456789012345678901234");
    // Round-trips exactly through JSON without precision loss — the whole point of serializing as a string.
    expect(record.poolLiquidity?.status === "ok" && BigInt(record.poolLiquidity.value)).toBe(123456789012345678901234n);
  });

  it("captures both token balances via two additional RPC calls against the correct token/owner pairs", async () => {
    const deps = fullyWorkingDeps();
    const token0 = aapl.tokenAddressMainnet as `0x${string}`;
    const token1 = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as `0x${string}`;
    const poolAddress = "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3" as `0x${string}`;
    deps.readSpotPrice = async () => ({
      poolAddress,
      sqrtPriceX96: realisticSqrtPriceX96(),
      tick: -74959,
      token0,
      token1,
      rawPriceToken1PerToken0: 0,
    });
    const calls: Array<{ token: string; owner: string }> = [];
    deps.readBalanceOf = async (_client, tokenAddress, owner) => {
      calls.push({ token: tokenAddress, owner });
      return tokenAddress === token0 ? 1000000000000000000000n : 500000000n;
    };
    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run", deps);

    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.owner === poolAddress)).toBe(true);
    expect(calls.map((c) => c.token).sort()).toEqual([token0, token1].sort());
    expect(record.poolToken0Balance?.status).toBe("ok");
    expect(record.poolToken0Balance?.status === "ok" && record.poolToken0Balance.value).toBe("1000000000000000000000");
    expect(record.poolToken1Balance?.status).toBe("ok");
    expect(record.poolToken1Balance?.status === "ok" && record.poolToken1Balance.value).toBe("500000000");
  });

  it("liquidity failure is independent — does not affect balances, canonical price, or anything else", async () => {
    const deps = fullyWorkingDeps();
    deps.readSpotPrice = async () => ({
      poolAddress: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3" as `0x${string}`,
      sqrtPriceX96: realisticSqrtPriceX96(),
      tick: -74959,
      token0: aapl.tokenAddressMainnet as `0x${string}`,
      token1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as `0x${string}`,
      rawPriceToken1PerToken0: 0,
    });
    deps.readLiquidity = async () => {
      throw new Error("simulated liquidity() revert");
    };
    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run", deps);

    expect(record.poolLiquidity?.status).toBe("unavailable");
    expect(record.poolLiquidity?.status === "unavailable" && record.poolLiquidity.detail).toContain("simulated liquidity() revert");
    // Canonical price path and every other field are completely unaffected.
    expect(record.secondaryPrice.status).toBe("ok");
    expect(record.premiumDiscountPct.status).toBe("ok");
    expect(record.poolToken0Balance?.status).toBe("ok");
    expect(record.poolToken1Balance?.status).toBe("ok");
    expect(record.poolSqrtPriceX96?.status).toBe("ok");
  });

  it("a single token-balance failure is independent — the other balance, liquidity, and canonical price all remain unaffected", async () => {
    const deps = fullyWorkingDeps();
    const token0 = aapl.tokenAddressMainnet as `0x${string}`;
    deps.readSpotPrice = async () => ({
      poolAddress: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3" as `0x${string}`,
      sqrtPriceX96: realisticSqrtPriceX96(),
      tick: -74959,
      token0,
      token1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as `0x${string}`,
      rawPriceToken1PerToken0: 0,
    });
    deps.readBalanceOf = async (_client, tokenAddress) => {
      if (tokenAddress === token0) throw new Error("simulated balanceOf revert for token0");
      return 500000000n;
    };
    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run", deps);

    expect(record.poolToken0Balance?.status).toBe("unavailable");
    expect(record.poolToken1Balance?.status).toBe("ok");
    expect(record.poolLiquidity?.status).toBe("ok");
    expect(record.secondaryPrice.status).toBe("ok");
    expect(record.premiumDiscountPct.status).toBe("ok");
  });

  it("when no pool resolves this run, all five telemetry DataPoints are honestly unavailable — never zero, never fabricated", async () => {
    const deps = fullyWorkingDeps();
    deps.resolvePool = async () => null; // factory.getPool found no pool this run
    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run", deps);

    expect(record.poolSqrtPriceX96?.status).toBe("unavailable");
    expect(record.poolTick?.status).toBe("unavailable");
    expect(record.poolLiquidity?.status).toBe("unavailable");
    expect(record.poolToken0Balance?.status).toBe("unavailable");
    expect(record.poolToken1Balance?.status).toBe("unavailable");
    // Fee tier is a config constant with no failure mode — still present.
    expect(record.poolFeeTierBps).toBe(aapl.poolFeeTier);
    // None of these ever silently becomes a fabricated zero/empty string.
    expect(record.poolLiquidity?.status === "unavailable").toBe(true);
  });

  it("a total telemetry-section failure cannot prevent the ticker snapshot from being written, and canonical fields remain fully intact", async () => {
    const deps = fullyWorkingDeps();
    deps.readSpotPrice = async () => ({
      poolAddress: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3" as `0x${string}`,
      sqrtPriceX96: realisticSqrtPriceX96(),
      tick: -74959,
      token0: aapl.tokenAddressMainnet as `0x${string}`,
      token1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as `0x${string}`,
      rawPriceToken1PerToken0: 0,
    });
    // Every telemetry-dependent dep throws — simulating a maximally hostile run.
    deps.readLiquidity = async () => {
      throw new Error("total telemetry outage");
    };
    deps.readBalanceOf = async () => {
      throw new Error("total telemetry outage");
    };
    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run", deps);

    // The function returned a real record at all — did not throw.
    expect(record.recordType).toBe("ticker_snapshot");
    expect(record.secondaryPrice.status).toBe("ok");
    expect(record.premiumDiscountPct.status).toBe("ok");
    expect(record.robinhoodAssetStatus.status).toBe("ok");
    expect(record.holderConcentration.status).toBe("ok");
    expect(record.poolLiquidity?.status).toBe("unavailable");
    expect(record.poolToken0Balance?.status).toBe("unavailable");
    expect(record.poolToken1Balance?.status).toBe("unavailable");
  });

  it("historical/additive compatibility: an old record shape (no telemetry fields at all) is still a structurally valid TickerSnapshotRecord", async () => {
    // Simulates reading a pre-P5-C0 historical record back from disk —
    // exactly what readJsonLines would hand back for an old line.
    const oldRecord: Omit<Awaited<ReturnType<typeof captureTickerSnapshot>>, "poolSqrtPriceX96" | "poolTick" | "poolFeeTierBps" | "poolLiquidity" | "poolToken0Balance" | "poolToken1Balance" | "poolToken0Address" | "poolToken1Address" | "poolToken0Decimals" | "poolToken1Decimals"> = {
      recordType: "ticker_snapshot",
      runId: "old-run",
      capturedAt: "2026-08-01T00:00:00.000Z",
      ticker: "AAPL",
      canonicalTokenAddress: aapl.tokenAddressMainnet,
      configuredPoolAddress: aapl.poolAddressMainnet,
      robinhoodAssetStatus: { status: "ok", value: "ACTIVE", asOf: "x", source: "s" },
      robinhoodPrice: { status: "ok", value: { bid: "1", ask: "1", mid: 1, isTradingHalt: false, generatedAt: "x" }, asOf: "x", source: "s" },
      chainlinkReference: { status: "ok", value: { normalizedPrice: 1, decimals: 8, updatedAt: "x" }, asOf: "x", source: "s" },
      oraclePaused: { status: "ok", value: false, asOf: "x", source: "s" },
      secondaryPrice: { status: "ok", value: 1, asOf: "x", source: "s" },
      premiumDiscountPct: { status: "ok", value: 0, asOf: "x", source: "s" },
      holderConcentration: { status: "ok", value: { holderRows: 1, top1Pct: 1, top5Pct: 1, top10Pct: 1 }, asOf: "x", source: "s" },
    };
    // TypeScript accepts this object as a valid TickerSnapshotRecord
    // (all six new fields are optional) — this assignment itself is the
    // compile-time proof of backward compatibility.
    const asFullRecord: Awaited<ReturnType<typeof captureTickerSnapshot>> = oldRecord;
    expect(asFullRecord.poolLiquidity).toBeUndefined();
    expect(asFullRecord.poolFeeTierBps).toBeUndefined();
    expect(asFullRecord.poolToken0Address).toBeUndefined();
    expect(asFullRecord.poolToken0Decimals).toBeUndefined();
  });

  it("P6-A0: persists the pool's authoritative live token0/token1 addresses, matching the same read secondaryPrice uses", async () => {
    const deps = fullyWorkingDeps();
    const token0 = aapl.tokenAddressMainnet as `0x${string}`;
    const token1 = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as `0x${string}`;
    deps.readSpotPrice = async () => ({
      poolAddress: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3" as `0x${string}`,
      sqrtPriceX96: realisticSqrtPriceX96(),
      tick: -74959,
      token0,
      token1,
      rawPriceToken1PerToken0: 0,
    });
    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run", deps);

    expect(record.poolToken0Address?.status).toBe("ok");
    expect(record.poolToken0Address?.status === "ok" && record.poolToken0Address.value).toBe(token0);
    expect(record.poolToken1Address?.status).toBe("ok");
    expect(record.poolToken1Address?.status === "ok" && record.poolToken1Address.value).toBe(token1);
  });

  it("P6-A0: persists decimals corresponding to the correct token address/order, not swapped", async () => {
    const deps = fullyWorkingDeps();
    const token0 = aapl.tokenAddressMainnet as `0x${string}`;
    const token1 = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as `0x${string}`;
    deps.readSpotPrice = async () => ({
      poolAddress: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3" as `0x${string}`,
      sqrtPriceX96: realisticSqrtPriceX96(),
      tick: -74959,
      token0,
      token1,
      rawPriceToken1PerToken0: 0,
    });
    // Deliberately asymmetric decimals per address, so a swapped-order bug would be caught.
    deps.readDecimals = async (_client, tokenAddress) => (tokenAddress === token0 ? 18 : 6);
    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run", deps);

    expect(record.poolToken0Decimals?.status).toBe("ok");
    expect(record.poolToken0Decimals?.status === "ok" && record.poolToken0Decimals.value).toBe(18);
    expect(record.poolToken1Decimals?.status).toBe("ok");
    expect(record.poolToken1Decimals?.status === "ok" && record.poolToken1Decimals.value).toBe(6);
  });

  it("P6-A0: when no pool resolves this run, the four new metadata fields are honestly unavailable, never fabricated", async () => {
    const deps = fullyWorkingDeps();
    deps.resolvePool = async () => null;
    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run", deps);

    expect(record.poolToken0Address?.status).toBe("unavailable");
    expect(record.poolToken1Address?.status).toBe("unavailable");
    expect(record.poolToken0Decimals?.status).toBe("unavailable");
    expect(record.poolToken1Decimals?.status).toBe("unavailable");
  });

  it("P6-A0: a decimals-read failure leaves addresses, tick, sqrtPriceX96, liquidity, and balances all unaffected", async () => {
    const deps = fullyWorkingDeps();
    const token0 = aapl.tokenAddressMainnet as `0x${string}`;
    const token1 = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as `0x${string}`;
    deps.readSpotPrice = async () => ({
      poolAddress: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3" as `0x${string}`,
      sqrtPriceX96: realisticSqrtPriceX96(),
      tick: -74959,
      token0,
      token1,
      rawPriceToken1PerToken0: 0,
    });
    deps.readDecimals = async () => {
      throw new Error("simulated decimals() revert");
    };
    const record = await captureTickerSnapshot(aapl, registry, fakeClient, "test-run", deps);

    // Decimals honestly unavailable (coupled to the shared secondaryPrice
    // computation failing, as documented) ...
    expect(record.poolToken0Decimals?.status).toBe("unavailable");
    expect(record.poolToken1Decimals?.status).toBe("unavailable");
    // ... but addresses, tick, sqrtPriceX96, liquidity, and balances are
    // completely unaffected, since they come from independent reads.
    expect(record.poolToken0Address?.status).toBe("ok");
    expect(record.poolToken1Address?.status).toBe("ok");
    expect(record.poolTick?.status).toBe("ok");
    expect(record.poolSqrtPriceX96?.status).toBe("ok");
    expect(record.poolLiquidity?.status).toBe("ok");
    expect(record.poolToken0Balance?.status).toBe("ok");
    expect(record.poolToken1Balance?.status).toBe("ok");
  });

  it("P6-A0: historical/additive compatibility — an old record shape lacking the four new metadata fields is still structurally valid", async () => {
    const oldRecord: Omit<Awaited<ReturnType<typeof captureTickerSnapshot>>, "poolToken0Address" | "poolToken1Address" | "poolToken0Decimals" | "poolToken1Decimals"> = {
      recordType: "ticker_snapshot",
      runId: "old-run",
      capturedAt: "2026-09-13T00:00:00.000Z",
      ticker: "AAPL",
      canonicalTokenAddress: aapl.tokenAddressMainnet,
      configuredPoolAddress: aapl.poolAddressMainnet,
      robinhoodAssetStatus: { status: "ok", value: "ACTIVE", asOf: "x", source: "s" },
      robinhoodPrice: { status: "ok", value: { bid: "1", ask: "1", mid: 1, isTradingHalt: false, generatedAt: "x" }, asOf: "x", source: "s" },
      chainlinkReference: { status: "ok", value: { normalizedPrice: 1, decimals: 8, updatedAt: "x" }, asOf: "x", source: "s" },
      oraclePaused: { status: "ok", value: false, asOf: "x", source: "s" },
      secondaryPrice: { status: "ok", value: 1, asOf: "x", source: "s" },
      premiumDiscountPct: { status: "ok", value: 0, asOf: "x", source: "s" },
      holderConcentration: { status: "ok", value: { holderRows: 1, top1Pct: 1, top5Pct: 1, top10Pct: 1 }, asOf: "x", source: "s" },
      // This "old" fixture DOES already have the original P5-C0 fields,
      // simulating a record written after P5-C0 but before P6-A0.
      poolSqrtPriceX96: { status: "ok", value: "123", asOf: "x", source: "s" },
      poolTick: { status: "ok", value: -1000, asOf: "x", source: "s" },
      poolFeeTierBps: 3000,
      poolLiquidity: { status: "ok", value: "456", asOf: "x", source: "s" },
      poolToken0Balance: { status: "ok", value: "789", asOf: "x", source: "s" },
      poolToken1Balance: { status: "ok", value: "1011", asOf: "x", source: "s" },
    };
    const asFullRecord: Awaited<ReturnType<typeof captureTickerSnapshot>> = oldRecord;
    expect(asFullRecord.poolToken0Address).toBeUndefined();
    expect(asFullRecord.poolToken1Address).toBeUndefined();
    expect(asFullRecord.poolToken0Decimals).toBeUndefined();
    expect(asFullRecord.poolToken1Decimals).toBeUndefined();
    // The original P5-C0 fields this fixture DOES set remain intact and unaffected.
    expect(asFullRecord.poolLiquidity?.status === "ok" && asFullRecord.poolLiquidity.value).toBe("456");
  });
});
