// Simple in-memory sliding-window rate limiter (per process).
// Fine for single-instance deployments; swap for Redis in multi-instance setups.

const buckets = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    const retryAfterMs = windowMs - (now - arr[0]);
    return { ok: false, retryAfterMs: Math.max(retryAfterMs, 1000) };
  }
  arr.push(now);
  buckets.set(key, arr);
  // opportunistic cleanup
  if (buckets.size > 10000) {
    for (const [k, v] of buckets) {
      if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
    }
  }
  return { ok: true, retryAfterMs: 0 };
}
