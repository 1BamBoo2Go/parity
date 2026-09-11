/**
 * proveP0.ts — the actual live ground-truth proof script.
 *
 * Run: npx tsx scripts/proveP0.ts
 *
 * This script makes REAL network calls against Robinhood's official REST
 * API, Robinhood Chain's public RPC, and Blockscout's public REST API. It
 * does not mock, fake, or fall back to fixture data at any point — if a
 * call fails, it is reported as a failure, with the real error, not papered
 * over. Nothing here invents a value when live data was not obtained.
 *
 * REVISION HISTORY (kept here deliberately, not just in commit messages,
 * because this file's correctness has already had one real, external,
 * live-run-discovered bug and that history is part of its provenance):
 *   - First external live run (network-unrestricted VPS) proved every host
 *     reachable and every registry/price/feed/pool read live-succeeding,
 *     but exposed a real decimals/orientation bug in secondary-price
 *     computation (nonsense values like AAPL +970,533,841.6960%) and a
 *     wrong Blockscout endpoint (legacy action-API returned 403). Both are
 *     fixed in this revision — see src/domain/poolPrice.ts and
 *     src/sources/blockscoutHolders.ts.
 *   - P0 external verification PASSED (22 ok / 5 unsupported / 0 real
 *     failures) and was committed at 40f08cf6ff41e4cd928a624b0641d7fe8b948979.
 *   - Slice P1 expanded CANDIDATE_TICKERS (src/config/tickers.ts) with five
 *     new candidates (TSLA, NVDA, MSFT, SPY, QQQ) of deliberately varying
 *     evidence strength. This script needed NO changes to cover them — it
 *     already iterates CANDIDATE_TICKERS generically — except that
 *     isKnownUnsupported() was corrected to key off an explicit
 *     `knownUnsupportedReason` field rather than inferring "unsupported"
 *     from null addresses, specifically so MSFT/SPY/QQQ's missing-feed
 *     research gap (their feed likely exists, its address just hasn't been
 *     found yet) is never confused with HOOD's confirmed, permanent absence.
 */
import { fetchRobinhoodAssets, findDeploymentOnChain } from "../src/sources/robinhoodRegistry.js";
import { fetchRobinhoodPrice } from "../src/sources/robinhoodPrices.js";
import { createRobinhoodChainClient } from "../src/sources/evmClient.js";
import { readChainlinkFeed, readStockTokenMultiplierState } from "../src/sources/chainlinkFeed.js";
import { resolvePoolAddress, readPoolSpotPrice, UNISWAP_V3_FACTORY_MAINNET } from "../src/sources/uniswapV3Pool.js";
import { fetchTopHolders, computeConcentrationBands } from "../src/sources/blockscoutHolders.js";
import { readTotalSupply, readErc20Decimals } from "../src/sources/erc20.js";
import { CANDIDATE_TICKERS, isKnownUnsupported } from "../src/config/tickers.js";
import { midPrice, computePremiumDiscountPct, assertPlausiblePremiumDiscountPct } from "../src/domain/calc.js";
import { computeStockTokenPriceInQuoteAsset } from "../src/domain/poolPrice.js";
import { pace } from "../src/sources/httpRetry.js";
import { UpstreamFetchError } from "../src/sources/robinhoodRegistry.js";

const USDG_MAINNET = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const; // source: useWield/wield-contracts README

type StepStatus = "ok" | "fail" | "unsupported";

interface StepResult {
  step: string;
  status: StepStatus;
  detail: string;
}

interface TickerLiveData {
  chainlinkReferencePrice?: number;
  secondaryPoolPrice?: number; // already decimals/orientation-normalized: USDG per 1 stock token
}

const results: StepResult[] = [];
const liveData = new Map<string, TickerLiveData>();

function record(step: string, status: StepStatus, detail: string) {
  results.push({ step, status, detail });
  const label = status === "ok" ? "OK  " : status === "unsupported" ? "SKIP" : "FAIL";
  console.log(`[${label}] ${step}: ${detail}`);
}

async function main() {
  console.log("=== Parity P0 Live Ground-Truth Proof ===\n");

  // STEP 2 — Robinhood registry
  let registry: Awaited<ReturnType<typeof fetchRobinhoodAssets>> | undefined;
  try {
    registry = await fetchRobinhoodAssets();
    record("Step 2: Robinhood registry (/rhj/assets)", "ok", `Fetched ${registry.assets.length} assets live.`);
  } catch (err) {
    record("Step 2: Robinhood registry (/rhj/assets)", "fail", err instanceof Error ? err.message : String(err));
  }
  for (const t of CANDIDATE_TICKERS) {
    const asset = registry?.assets.find((a) => a.tokenSymbol === t.symbol);
    if (!asset) {
      // A known-unsupported candidate (HOOD) being absent from the registry
      // is an EXPECTED condition, not a system failure — represent it as such.
      record(
        `Step 2: registry lookup ${t.symbol}`,
        isKnownUnsupported(t) ? "unsupported" : "fail",
        isKnownUnsupported(t)
          ? "Absent from live registry, matching this ticker's known-unsupported config (no feed, no pool configured)."
          : "Not found in live registry response — unexpected for a ticker we expected to be supported.",
      );
      continue;
    }
    const mainnetDeployment = findDeploymentOnChain(asset, 4663);
    const testnetDeployment = findDeploymentOnChain(asset, 46630);
    record(
      `Step 2: registry lookup ${t.symbol}`,
      "ok",
      `status=${asset.status} multiplier=${asset.currentMultiplier} mainnet=${mainnetDeployment?.contractAddress ?? "none"} testnet=${testnetDeployment?.contractAddress ?? "none"}`,
    );
  }

  // STEP 3 — Robinhood price/market-state, with conservative pacing between requests
  for (const t of CANDIDATE_TICKERS) {
    try {
      const quote = await fetchRobinhoodPrice(t.symbol);
      const mid = midPrice(Number(quote.bid), Number(quote.ask));
      record(
        `Step 3: price ${t.symbol}`,
        "ok",
        `bid=${quote.bid} ask=${quote.ask} mid=${mid} isTradingHalt=${quote.isTradingHalt} generatedAt=${quote.generatedAt}`,
      );
    } catch (err) {
      // NARROW reclassification: a 404 for a ticker ALREADY known-unsupported
      // in our own config (HOOD — no feed, no pool) is exactly the expected
      // shape of "this ticker isn't really live here," not a system failure.
      // This check is deliberately scoped to isKnownUnsupported(t) so that an
      // unexpected 404 for a ticker we believed was supported still surfaces
      // as a real failure needing investigation, per instruction.
      const status = err instanceof UpstreamFetchError ? err.status : undefined;
      const isExpectedHoodStyleGap = status === 404 && isKnownUnsupported(t);
      record(
        `Step 3: price ${t.symbol}`,
        isExpectedHoodStyleGap ? "unsupported" : "fail",
        isExpectedHoodStyleGap
          ? `HTTP 404, matching this ticker's known-unsupported config (no feed, no pool) — not a system failure.`
          : err instanceof Error
            ? err.message
            : String(err),
      );
    }
    await pace(350); // conservative spacing — this endpoint rate-limited us (429) in an earlier external run
  }

  // STEP 4 — Chainlink feed reads
  const client = createRobinhoodChainClient("mainnet");
  for (const t of CANDIDATE_TICKERS) {
    if (!t.chainlinkFeedMainnet) {
      record(`Step 4: Chainlink feed ${t.symbol}`, "unsupported", "No published feed (per config provenance).");
      continue;
    }
    try {
      const reading = await readChainlinkFeed(client, t.chainlinkFeedMainnet as `0x${string}`);
      const multiplierState = await readStockTokenMultiplierState(client, t.tokenAddressMainnet as `0x${string}`);
      liveData.set(t.symbol, { ...liveData.get(t.symbol), chainlinkReferencePrice: reading.normalizedPrice });
      record(
        `Step 4: Chainlink feed ${t.symbol}`,
        "ok",
        `normalizedPrice=${reading.normalizedPrice} decimals=${reading.decimals} updatedAt=${reading.updatedAt.toISOString()} ` +
          `uiMultiplier(raw,1e18-scaled)=${multiplierState.uiMultiplier} oraclePaused=${multiplierState.oraclePaused}`,
      );
    } catch (err) {
      record(`Step 4: Chainlink feed ${t.symbol}`, "fail", err instanceof Error ? err.message : String(err));
    }
  }

  // STEP 5 — Secondary-market pool resolution + CORRECTLY NORMALIZED spot price
  for (const t of CANDIDATE_TICKERS) {
    if (!t.tokenAddressMainnet || !t.poolFeeTier) {
      record(`Step 5: pool ${t.symbol}`, "unsupported", "No token address or fee tier configured.");
      continue;
    }
    try {
      const poolAddress = await resolvePoolAddress(
        client,
        UNISWAP_V3_FACTORY_MAINNET,
        t.tokenAddressMainnet as `0x${string}`,
        USDG_MAINNET,
        t.poolFeeTier,
      );
      if (!poolAddress) {
        record(
          `Step 5: pool ${t.symbol}`,
          "unsupported",
          `factory.getPool returned no pool for ${t.symbol}/USDG at fee ${t.poolFeeTier} — do not substitute another pair.`,
        );
        continue;
      }
      const spot = await readPoolSpotPrice(client, poolAddress);
      // THE FIX: read each token's own decimals — never assume — then
      // orientation-normalize via computeStockTokenPriceInQuoteAsset, which
      // refuses to guess and throws if the pool doesn't actually contain
      // the exact (stock, USDG) pair we expected.
      const [decimals0, decimals1] = await Promise.all([
        readErc20Decimals(client, spot.token0),
        readErc20Decimals(client, spot.token1),
      ]);
      const normalizedPrice = computeStockTokenPriceInQuoteAsset({
        sqrtPriceX96: spot.sqrtPriceX96,
        token0: spot.token0,
        token1: spot.token1,
        decimals0,
        decimals1,
        expectedStockTokenAddress: t.tokenAddressMainnet,
        expectedQuoteAssetAddress: USDG_MAINNET,
      });
      liveData.set(t.symbol, { ...liveData.get(t.symbol), secondaryPoolPrice: normalizedPrice });
      record(
        `Step 5: pool ${t.symbol}`,
        "ok",
        `pool=${poolAddress} token0=${spot.token0}(dec${decimals0}) token1=${spot.token1}(dec${decimals1}) ` +
          `normalizedSecondaryPrice(USDG per 1 ${t.symbol})=${normalizedPrice}`,
      );
    } catch (err) {
      record(`Step 5: pool ${t.symbol}`, "fail", err instanceof Error ? err.message : String(err));
    }
  }

  // STEP 6 — First real, VALIDATED Parity calculation
  for (const t of CANDIDATE_TICKERS) {
    const data = liveData.get(t.symbol);
    if (!data?.chainlinkReferencePrice || !data?.secondaryPoolPrice) {
      record(
        `Step 6: premium/discount ${t.symbol}`,
        "unsupported",
        "Requires BOTH a live Chainlink reference AND a live, normalized secondary pool price; at least one is missing.",
      );
      continue;
    }
    try {
      const pct = computePremiumDiscountPct(data.secondaryPoolPrice, data.chainlinkReferencePrice);
      // Sanity circuit breaker — this is what would have caught the
      // external run's +970,533,841.6960% before it was ever displayed.
      assertPlausiblePremiumDiscountPct(pct);
      record(
        `Step 6: premium/discount ${t.symbol}`,
        "ok",
        `reference=${data.chainlinkReferencePrice} secondary=${data.secondaryPoolPrice} premiumDiscountPct=${pct.toFixed(4)}%`,
      );
    } catch (err) {
      record(`Step 6: premium/discount ${t.symbol}`, "fail", err instanceof Error ? err.message : String(err));
    }
  }

  // STEP 7 — Holder concentration (at least one ticker), via the corrected Blockscout client
  const holderTarget = CANDIDATE_TICKERS.find((t) => t.tokenAddressMainnet)!;
  try {
    const [holders, totalSupply] = await Promise.all([
      fetchTopHolders(holderTarget.tokenAddressMainnet!),
      readTotalSupply(client, holderTarget.tokenAddressMainnet as `0x${string}`),
    ]);
    const bands = computeConcentrationBands(holders, totalSupply);
    record(
      `Step 7: holder concentration ${holderTarget.symbol}`,
      "ok",
      `holderRows=${holders.length} totalSupply=${totalSupply} ` +
        `top1=${bands.top1Pct.toFixed(2)}% top5=${bands.top5Pct.toFixed(2)}% top10=${bands.top10Pct.toFixed(2)}%`,
    );
  } catch (err) {
    record(`Step 7: holder concentration ${holderTarget.symbol}`, "fail", err instanceof Error ? err.message : String(err));
  }

  console.log("\n=== Summary ===");
  const ok = results.filter((r) => r.status === "ok").length;
  const unsupported = results.filter((r) => r.status === "unsupported").length;
  const failed = results.filter((r) => r.status === "fail");
  console.log(`${ok} ok / ${unsupported} unsupported (expected) / ${failed.length} real failures, out of ${results.length} total steps.`);
  if (failed.length > 0) {
    console.log("\nReal failures (these, not the 'unsupported' rows above, are what block P0):");
    for (const f of failed) console.log(`  - ${f.step}: ${f.detail}`);
    if (!process.env.BLOCKSCOUT_API_KEY) {
      console.log(
        "\nNote: BLOCKSCOUT_API_KEY is not set. If Step 7 failed, get a free key at https://dev.blockscout.com " +
          "and re-run with BLOCKSCOUT_API_KEY=<your key> npm run prove:p0 — see src/sources/blockscoutHolders.ts.",
      );
    }
  }
  if (failed.length === 0 && ok > 0) {
    console.log("\nNo real failures. If Step 6 shows at least one 'ok' premium/discount and Step 7 shows an 'ok' holder concentration, P0's live-proof requirement is satisfied.");
  }
}

main().catch((err) => {
  console.error("Unhandled error in proveP0:", err);
  process.exit(1);
});
