import type { NextFunction, Request, Response } from "express";

/**
 * P5-A4 — minimal in-process rate limiting for the external Risk API.
 *
 * ARCHITECTURE: no dependency added. Evidence considered before writing
 * this: package.json has exactly two production dependencies (express,
 * viem) and no rate-limiting library anywhere in the tree (checked via
 * a full grep across package.json/package-lock.json). The policy itself
 * — a single fixed window, one counter per client key — is small enough
 * that a dependency would add more surface (config surface, transitive
 * deps, a new failure mode to reason about) than it would remove. This
 * is appropriate ONLY for the current single-process deployment; a
 * multi-instance deployment would need a shared store (Redis etc.) and
 * is explicitly out of scope here.
 *
 * DESIGN — fixed window, per key, swept opportunistically on request
 * traffic rather than a background timer:
 *   - No setInterval/background timer exists anywhere in this module.
 *     Every incoming request (regardless of outcome) triggers a single,
 *     cheap O(distinct recent clients) sweep that evicts any bucket
 *     whose window has fully elapsed. Memory only grows in proportion to
 *     *concurrent* recent traffic, exactly the thing being bounded, and
 *     there is no timer/interval handle for a test (or a long-running
 *     process) to ever need to explicitly stop or leak.
 *   - Time is fully injectable (`now`), and the client key is fully
 *     injectable (`keyFn`) — this is what makes deterministic,
 *     wall-clock-free tests with independently-behaving simulated
 *     clients possible without weakening the real security default.
 *
 * IP / PROXY ASSUMPTION — stated explicitly, not silently assumed:
 * `keyFn` defaults to `req.ip`. Express's `req.ip` reads directly from
 * the TCP socket's remote address UNLESS `app.set("trust proxy", ...)`
 * has been configured — which this application deliberately does NOT
 * do (confirmed absent anywhere in src/web/server.ts). That means
 * `req.ip` here reflects the actual connecting peer, not a
 * client-controlled `X-Forwarded-For` header — safe against IP
 * spoofing by design, at the cost of being wrong (crediting every
 * client to one IP) if this process is ever deployed behind a reverse
 * proxy WITHOUT separately enabling and correctly configuring trust
 * proxy. There is no evidence in this repository of such a proxy in
 * front of the current deployment; if one is added later, `trust proxy`
 * must be enabled deliberately, with a specific trusted-hop count, not
 * blindly — enabling it without a real, verified proxy in front of this
 * process would let ANY client forge its own rate-limit identity via a
 * spoofed `X-Forwarded-For` header.
 *
 * NO INTELLIGENCE/BUSINESS LOGIC: this module knows nothing about
 * TickerIntelligence, RiskViewModel, symbols, or maturity/classification.
 * It is a generic request counter, reusable by any route.
 */

export interface RateLimiterOptions {
  /** Window duration in milliseconds. Production default: 60_000 (one minute). */
  windowMs?: number;
  /** Maximum requests permitted per key within one window. Production default: 60. */
  maxRequests?: number;
  /** Injectable clock, defaulting to Date.now. Tests supply a controllable clock instead of real sleeps. */
  now?: () => number;
  /**
   * Injectable client-key extractor, defaulting to `req.ip`. Tests may
   * override this (e.g. to read a test-only header) to simulate multiple
   * independent clients deterministically without relying on any
   * proxy/forwarded-header trust in the actual production code path.
   */
  keyFn?: (req: Request) => string;
}

export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 60;

interface Bucket {
  count: number;
  windowStart: number;
}

/**
 * Creates fresh, independent limiter state and Express middleware. Each
 * call owns its own Map — safe to construct once per app instance (as
 * createApp already does per test), with no shared global state between
 * instances and nothing to explicitly tear down.
 */
export function createRateLimiter(options: RateLimiterOptions = {}) {
  const windowMs = options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
  const maxRequests = options.maxRequests ?? DEFAULT_RATE_LIMIT_MAX_REQUESTS;
  const now = options.now ?? Date.now;
  const keyFn = options.keyFn ?? ((req: Request) => req.ip ?? "unknown");

  const buckets = new Map<string, Bucket>();

  function sweepExpired(nowMs: number): void {
    for (const [key, bucket] of buckets) {
      if (nowMs - bucket.windowStart >= windowMs) {
        buckets.delete(key);
      }
    }
  }

  function middleware(req: Request, res: Response, next: NextFunction): void {
    const nowMs = now();
    // Opportunistic, request-driven cleanup — see module doc. Runs before
    // the current key is read/written so a just-expired bucket for THIS
    // key is also cleared by the same pass, not just other keys'.
    sweepExpired(nowMs);

    const key = keyFn(req);
    let bucket = buckets.get(key);
    if (!bucket || nowMs - bucket.windowStart >= windowMs) {
      bucket = { count: 0, windowStart: nowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > maxRequests) {
      const windowEndsAt = bucket.windowStart + windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((windowEndsAt - nowMs) / 1000));
      res.set("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: "rate_limit_exceeded", apiVersion: "v1" });
      return;
    }

    next();
  }

  return { middleware };
}
