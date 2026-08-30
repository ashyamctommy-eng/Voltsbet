import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { checkCronSecret } from "@/lib/cron-guard";
import { syncGames } from "@/lib/sync";
import { refreshLiveScores } from "@/lib/live-scores";
import { clearPrematchFeedCache } from "@/lib/feed";

/**
 * Cron endpoint — automated pre-match sync + live-score refresh.
 *
 * Runs the configured sync provider (the-odds-api / api-football) to refresh
 * fixtures + odds in the DB, then pulls fresh in-play scores (BetsAPI live
 * engine, throttled). The homepage feed reads the API directly (no sync
 * needed to display); this keeps the DB fresh for /live, fixture pages,
 * settlement and the admin Games page.
 *
 * Quota conservation:
 *  - THROTTLE: at most ONE sync per SYNC_THROTTLE_MINUTES (default 60) —
 *    overlapping/duplicate cron triggers return { throttled: true } instead
 *    of burning quota. Escape hatch: ?force=1.
 *  - COALESCE: concurrent triggers share a single in-flight sync.
 *  - The provider's in-memory odds cache (30 min TTL) means repeated admin
 *    syncs / cold bootstraps within the window cost 0 additional requests.
 *
 * Budget: a full sync is ~1 request per league per market (≈ 44 credits for
 * the ~22 in-season leagues). Paid plans handle 3–4×/day; on the free 500/mo
 * tier schedule every-other-day or rely on ?force sparingly.
 *
 * Protect with the cron secret (Admin → Website Settings → Automation, or
 * CRON_SECRET env). Call from any scheduler, e.g.:
 *
 *   GET https://your-app/api/cron/sync?secret=<cron.secret>
 *
 * 200 with counts · 401 without the secret · 503 if unconfigured.
 */
const SYNC_THROTTLE_MS = (Number(process.env.SYNC_THROTTLE_MINUTES) || 60) * 60 * 1000;
let lastSyncAt = 0;
let inFlight: Promise<Record<string, unknown>> | null = null;

type SyncOutcome = { ok: boolean; synced: unknown; live: unknown; at: string; throttled?: boolean; retryInSeconds?: number; coalesced?: boolean };

async function runSync(): Promise<SyncOutcome> {
  const [sync, live] = await Promise.allSettled([
    syncGames(),
    refreshLiveScores(),
  ]);
  const syncResult = sync.status === "fulfilled" ? sync.value : { error: sync.reason instanceof Error ? sync.reason.message : String(sync.reason) };
  const liveResult = live.status === "fulfilled" ? live.value : { error: live.reason instanceof Error ? live.reason.message : String(live.reason) };
  clearPrematchFeedCache();
  return { ok: true, synced: syncResult, live: liveResult, at: new Date().toISOString() };
}

export const GET = handle(async (req: NextRequest) => {
  await checkCronSecret(req);
  const force = req.nextUrl.searchParams.get("force") === "1";

  // Once-per-window guard: overlapping scheduler triggers don't re-sync.
  if (!force) {
    const elapsed = Date.now() - lastSyncAt;
    if (lastSyncAt > 0 && elapsed < SYNC_THROTTLE_MS) {
      return ok({
        ok: true, throttled: true,
        retryInSeconds: Math.ceil((SYNC_THROTTLE_MS - elapsed) / 1000),
        lastSyncAt: new Date(lastSyncAt).toISOString(),
      });
    }
  }

  // Coalesce concurrent triggers onto the running sync.
  if (inFlight) {
    const result = await inFlight;
    return ok({ ...result, coalesced: true });
  }

  inFlight = runSync();
  try {
    return ok(await inFlight);
  } finally {
    inFlight = null;
    lastSyncAt = Date.now();
  }
});

export const POST = GET;
