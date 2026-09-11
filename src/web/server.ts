import express, { type Express, type Request, type Response } from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getGridViewModel, getDetailViewModel, getHistoryViewModelFor } from "../readmodel/dashboardReadModel.js";
import type { SnapshotReaderOptions } from "../readmodel/snapshotReader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "..", "public");

const DEFAULT_HISTORY_LIMIT = 500;
const MAX_HISTORY_LIMIT = 5000;

/**
 * Build the Express app. This is a thin read-only layer: every route below
 * calls straight into src/readmodel/, which itself only reads already-
 * persisted snapshot data and already-tested view-model builders. No
 * market-intelligence calculation happens anywhere in this file.
 *
 * `dataDir` is injectable so tests can point the app at a temporary,
 * disposable snapshot directory instead of the real one.
 */
export function createApp(readerOptions: SnapshotReaderOptions = {}): Express {
  const app = express();

  // --- Read-only JSON API -----------------------------------------------

  app.get("/api/tickers", (_req: Request, res: Response) => {
    res.json({ tickers: getGridViewModel(readerOptions) });
  });

  app.get("/api/tickers/:symbol", (req: Request, res: Response) => {
    const symbolParam = req.params.symbol;
    if (typeof symbolParam !== "string") {
      res.status(400).json({ error: "missing_symbol" });
      return;
    }
    const result = getDetailViewModel(symbolParam.toUpperCase(), readerOptions);
    if (result.kind === "unsupported_ticker") {
      res.status(404).json({ error: "unsupported_ticker", symbol: symbolParam });
      return;
    }
    res.json(result.detail);
  });

  app.get("/api/tickers/:symbol/history", (req: Request, res: Response) => {
    const symbolParam = req.params.symbol;
    if (typeof symbolParam !== "string") {
      res.status(400).json({ error: "missing_symbol" });
      return;
    }
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_HISTORY_LIMIT) : DEFAULT_HISTORY_LIMIT;
    const result = getHistoryViewModelFor(symbolParam.toUpperCase(), limit, readerOptions);
    if (result.kind === "unsupported_ticker") {
      res.status(404).json({ error: "unsupported_ticker", symbol: symbolParam });
      return;
    }
    res.json(result.history);
  });

  // --- Static frontend ----------------------------------------------------
  // Plain HTML/CSS/vanilla JS, no build step, no framework — appropriately
  // scoped for a V1 read-only internal dashboard. Nothing server-side ever
  // needs to be embedded into these files (no secrets, no API keys — every
  // third-party credential, if any is configured, is used only during
  // snapshot capture, never here).
  app.use(express.static(PUBLIC_DIR));
  app.get("/", (_req: Request, res: Response) => {
    res.sendFile(join(PUBLIC_DIR, "index.html"));
  });

  return app;
}
