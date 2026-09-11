/**
 * Conservative retry/backoff for upstream 429 (rate limited) responses.
 *
 * Added after the external live P0 run hit real HTTP 429s from Robinhood's
 * /rhj/prices endpoint for USO and SPCX (a real rate limit, not a bug).
 * This is deliberately conservative: a small, bounded number of retries
 * with exponential backoff, honoring a `Retry-After` header when the
 * upstream provides one. It does NOT retry on any other status code — a
 * 403, 404, or 500 is a real failure and should surface immediately, not be
 * retried into a longer failure.
 */

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls `attempt()` (expected to perform one fetch and return the Response).
 * If the response is a 429, waits (honoring Retry-After if present, else
 * exponential backoff) and retries, up to `maxRetries` additional attempts.
 * Any non-429 response (ok or not) is returned immediately without retry.
 */
export async function fetchWithRateLimitRetry(
  attempt: () => Promise<Response>,
  options: RetryOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;

  let lastResponse: Response;
  for (let attemptNumber = 0; attemptNumber <= maxRetries; attemptNumber++) {
    lastResponse = await attempt();
    if (lastResponse.status !== 429) {
      return lastResponse;
    }
    if (attemptNumber === maxRetries) {
      break; // exhausted retries; return the final 429 response as-is
    }
    const retryAfterHeader = lastResponse.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
    const delayMs = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : baseDelayMs * 2 ** attemptNumber;
    await sleep(delayMs);
  }
  return lastResponse!;
}

/** Simple fixed pacing delay, used between sequential requests to the same upstream — not a retry, just conservative spacing to avoid tripping rate limits in the first place. */
export async function pace(ms = 350): Promise<void> {
  await sleep(ms);
}
