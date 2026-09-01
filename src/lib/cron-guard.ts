import { timingSafeEqual } from "crypto";
import { ApiError } from "@/lib/api";
import { getSettings } from "@/lib/settings";

/** Constant-time string comparison (avoids timing side-channels on the secret). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Verify the cron secret (query ?secret= or x-cron-secret header) against the
 * DB setting (fallback: CRON_SECRET env). 503 when unconfigured, 401 on
 * mismatch.
 */
export async function checkCronSecret(req: {
  nextUrl: { searchParams: URLSearchParams };
  headers: Headers;
}): Promise<void> {
  const settings = await getSettings();
  const secret = settings.cronSecret || process.env.CRON_SECRET || "";
  if (!secret) {
    throw new ApiError(503, "Cron secret not configured — set cron.secret in admin settings.", "CRON_NOT_CONFIGURED");
  }
  const provided = req.nextUrl.searchParams.get("secret") ?? req.headers.get("x-cron-secret") ?? "";
  if (!safeEqual(provided, secret)) {
    throw new ApiError(401, "Invalid cron secret.", "UNAUTHORIZED");
  }
}

export type CronJobRun<T> = {
  result: T;
  throttled?: boolean;
  coalesced?: boolean;
  retryInSeconds?: number;
};

/**
 * Per-process throttle + coalesce for a cron job: at most one real run per
 * window (overlapping scheduler triggers get { throttled: true }), and
 * concurrent triggers share the in-flight run ({ coalesced: true }).
 * Without this, admin "Run now" + scheduler overlap caused duplicate work
 * and P2002 aborts in the schedule sync.
 */
export function makeCronJob(throttleMinutes: number) {
  const THROTTLE_MS = Math.max(1, throttleMinutes) * 60_000;
  let lastRunAt = 0;
  let inFlight: Promise<unknown> | null = null;

  return {
    throttleMs: THROTTLE_MS,
    async run<T>(fn: () => Promise<T>): Promise<CronJobRun<T>> {
      const elapsed = Date.now() - lastRunAt;
      if (lastRunAt > 0 && elapsed < THROTTLE_MS) {
        return {
          result: undefined as unknown as T,
          throttled: true,
          retryInSeconds: Math.ceil((THROTTLE_MS - elapsed) / 1000),
        };
      }
      if (inFlight) {
        const result = (await inFlight) as T;
        return { result, coalesced: true };
      }
      const p = fn().finally(() => {
        inFlight = null;
        lastRunAt = Date.now();
      });
      inFlight = p;
      const result = (await p) as T;
      return { result };
    },
  };
}
