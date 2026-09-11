import { describe, it, expect } from "vitest";
import { computeTopNConcentrationPct, computeConcentrationBands, type TokenHolder } from "../src/sources/blockscoutHolders.js";

const holders: TokenHolder[] = [
  { address: "0x1", value: "500" },
  { address: "0x2", value: "200" },
  { address: "0x3", value: "100" },
  { address: "0x4", value: "100" },
  { address: "0x5", value: "50" },
  { address: "0x6", value: "50" },
];
// total accounted here = 1000; assume totalSupply is larger to include "everyone else"
const totalSupply = 2000n;

describe("computeTopNConcentrationPct", () => {
  it("computes top-1 concentration correctly, sorted by balance descending regardless of input order", () => {
    const shuffled = [...holders].reverse();
    const pct = computeTopNConcentrationPct(shuffled, totalSupply, 1);
    expect(pct).toBeCloseTo(25, 2); // 500 / 2000
  });

  it("computes top-5 concentration correctly", () => {
    const pct = computeTopNConcentrationPct(holders, totalSupply, 5);
    // top 5 = 500+200+100+100+50 = 950 / 2000 = 47.5%
    expect(pct).toBeCloseTo(47.5, 2);
  });

  it("refuses a non-positive total supply", () => {
    expect(() => computeTopNConcentrationPct(holders, 0n)).toThrow();
    expect(() => computeTopNConcentrationPct(holders, -1n)).toThrow();
  });
});

describe("computeConcentrationBands", () => {
  it("computes top1/top5/top10 in one pass, consistently with the individual calls", () => {
    const bands = computeConcentrationBands(holders, totalSupply);
    expect(bands.top1Pct).toBeCloseTo(25, 2);
    expect(bands.top5Pct).toBeCloseTo(47.5, 2);
    // top10 with only 6 holders present = sum of all six = 1000 / 2000 = 50%
    expect(bands.top10Pct).toBeCloseTo(50, 2);
  });
});
