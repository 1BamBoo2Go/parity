/**
 * captureSnapshot.ts — the scheduler-safe snapshot capture command.
 *
 * Run: npx tsx scripts/captureSnapshot.ts
 * Cron-friendly example (every 15 minutes) — run every-15-minutes syntax,
 * five stars/slashes read left to right as minute-hour-day-month-weekday:
 *   (star)/15 (star) (star) (star) (star) cd /path/to/parity && npx tsx scripts/captureSnapshot.ts >> data/snapshot-cron.log 2>&1
 *
 * DESIGN FOR UNATTENDED OPERATION:
 *   - A partial upstream failure (one ticker's Chainlink read fails, or
 *     Blockscout is briefly down) is NORMAL, EXPECTED operation for a
 *     scheduled job hitting live infrastructure repeatedly over weeks. It
 *     is recorded honestly in the output files and does NOT produce a
 *     non-zero exit code — a cron job should not page anyone, or fill an
 *     inbox with failure emails, because one ticker's RPC call timed out
 *     once.
 *   - A non-zero exit code is reserved for something actually exceptional:
 *     an unhandled exception escaping captureRun() itself (a real bug, not
 *     an ordinary upstream hiccup), or the process being unable to write
 *     to the data directory at all.
 *   - This script performs ONLY reads. No wallet, no signing, no
 *     transactions, exactly as required.
 */
import { captureRun } from "../src/snapshot/captureRun.js";

async function main() {
  const startedAt = new Date();
  console.log(`[${startedAt.toISOString()}] Starting Parity snapshot capture run...`);

  const result = await captureRun();

  console.log(`[${new Date().toISOString()}] Run ${result.runId} complete.`);
  console.log(`  Registry captured: ${result.registryCaptured}`);
  console.log(`  Gas context captured: ${result.gasCaptured}`);
  console.log(`  Ticker snapshots written: ${result.tickerRecords.length}`);
  if (result.tickerErrors.length > 0) {
    console.log(`  Non-fatal errors this run (recorded, did not stop the run):`);
    for (const e of result.tickerErrors) {
      console.log(`    - ${e.symbol}: ${e.error}`);
    }
  } else {
    console.log(`  No errors this run.`);
  }

  // Best-effort visibility into a couple of key fields, for a human
  // glancing at cron logs — not a substitute for querying the JSONL files.
  for (const record of result.tickerRecords) {
    const pct = record.premiumDiscountPct.status === "ok" ? `${record.premiumDiscountPct.value.toFixed(4)}%` : `unavailable (${record.premiumDiscountPct.reason})`;
    console.log(`  ${record.ticker}: premiumDiscountPct=${pct}`);
  }
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] FATAL — unhandled error escaped captureRun():`, err);
  process.exit(1);
});
