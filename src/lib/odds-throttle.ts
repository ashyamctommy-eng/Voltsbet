/**
 * The Odds API rate limiting — the FREE tier allows 1 request/second.
 * Back-to-back league loops (22 leagues × 2 markets) exceed that on fast
 * networks (Railway) and the API answers `429 EXCEEDED_FREQ_LIMIT`.
 *
 * Every loop that hits api.the-odds-api.com must:
 *   - `await oddsThrottle()` before each request (or use fetchOddsRetry,
 *     which throttles internally), and
 *   - tolerate transient 429s (fetchOddsRetry retries with backoff).
 *
 * Tune the spacing with ODDS_API_RATE_LIMIT_MS (default 1100 = 1 req/sec).
 * Paid plans raise the limit — set e.g. 250 for 4 req/sec after upgrading.
 */

const MIN_SPACING_MS = Number(process.env.ODDS_API_RATE_LIMIT_MS) || 1100;
let lastRequestAt = 0;

/** Space requests at least MIN_SPACING_MS apart (shared across callers). */
export async function oddsThrottle(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + MIN_SPACING_MS - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

/**
 * Throttled fetch with retry on transient 429 (rate limit) and network
 * errors. Returns the final Response; callers still handle !ok (e.g. 422
 * quota exhaustion or 404 unknown league).
 */
export async function fetchOddsRetry(url: string, init?: RequestInit, retries = 3): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    await oddsThrottle();
    try {
      const res = await fetch(url, init);
      last = res;
      if (res.status === 429) {
        // Rate-limited — back off and retry (1.5s, 3s, 4.5s…).
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      return res;
    } catch {
      // Network hiccup (timeout / reset) — short pause, retry.
      await new Promise((r) => setTimeout(r, 750 * attempt));
      continue;
    }
  }
  if (last) return last; // retries exhausted — let the caller see the 429
  throw new Error(`fetchOddsRetry: request failed after ${retries} attempts: ${url.slice(0, 120)}`);
}
