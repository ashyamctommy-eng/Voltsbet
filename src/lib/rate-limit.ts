// Simple in-memory sliding-window rate limiter (per process).
// Fine for single-instance deployments; swap for Redis in multi-instance setups.

const buckets = new Map<string, number[]>();

/** Hard ceiling on tracked keys (see cleanup below). */
const MAX_BUCKETS = 10000;

export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    const retryAfterMs = windowMs - (now - arr[0]);
    return { ok: false, retryAfterMs: Math.max(retryAfterMs, 1000) };
  }
  arr.push(now);
  buckets.set(key, arr);
  // Cleanup is now HARD-bounded. The old version only pruned when size > 10000
  // and then only dropped keys whose timestamps were ALL stale — under a flood
  // of unique keys (the per-IP key is caller-influenced) the map grew anyway
  // and the O(n) prune ran on every request. Now we also evict oldest-inserted
  // keys so memory can never run away.
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, v] of buckets) {
      if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
    }
    if (buckets.size > MAX_BUCKETS) {
      let excess = buckets.size - MAX_BUCKETS;
      for (const k of buckets.keys()) {
        if (excess-- <= 0) break;
        buckets.delete(k);
      }
    }
  }
  return { ok: true, retryAfterMs: 0 };
}
