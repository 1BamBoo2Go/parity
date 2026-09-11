/**
 * serveDashboard.ts — starts the Parity read-only dashboard.
 *
 * Run: npx tsx scripts/serveDashboard.ts
 * Or:  npm run dashboard
 *
 * Reads whatever has already been persisted to data/snapshots/ by
 * scripts/captureSnapshot.ts (see Slice P1.2b). If no snapshot has been
 * captured yet, every ticker will honestly show "No data yet" rather than
 * fabricating anything — run `npm run snapshot` at least once first for a
 * populated dashboard.
 */
import { createApp } from "../src/web/server.js";

const PORT = Number(process.env.PORT) || 3000;

const app = createApp();
app.listen(PORT, () => {
  console.log(`Parity dashboard listening on http://localhost:${PORT}`);
  console.log(`If every ticker shows "No data yet", run "npm run snapshot" first.`);
});
