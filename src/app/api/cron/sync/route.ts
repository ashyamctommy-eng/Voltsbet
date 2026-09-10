import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { checkCronSecret } from "@/lib/cron-guard";
import { syncGames } from "@/lib/sync";
import { refreshLiveScores } from "@/lib/live-scores";
import { reconcileOrphanLiveGames } from "@/lib/orphan-live";
import { clearPrematchFeedCache } from "@/lib/feed";
import { prisma } from "@/lib/prisma";

/**
 * GET|POST /api/cron/sync — the single source of truth for background work.
 * Driven by **Railway Cron** (native scheduler), protected by CRON_SECRET
 * (query `?secret=` or `x-cron-secret` header; Admin → Automation).
 *
 *   GET https://voltbets.me/api/cron/sync?secret=<cron.secret>
 *
 * Each run performs, in order:
 *  1. PRE-MATCH PASS (paid, throttled) — `syncGames()` refreshes fixtures +
 *     odds from The Odds API for the whitelisted leagues.
 *  2. LIVE SCORE SWEEP — `refreshLiveScores()` upserts scores **by
 *     `externalId`** via Prisma and applies the state machine:
 *       completed === false && kickoff reached → status = "LIVE"
 *       completed === true                      → status = "FINISHED"
 *     (plus in-play odds on their own throttle/lookback window).
 *  3. STALE SWEEP — `reconcileOrphanLiveGames()` force-flips API rows
 *     (`externalId` set) stuck at LIVE past LIVE_STALE_FINISH_HOURS
 *     (default 4h) to FINISHED, and deletes seed/manual placeholders stuck
 *     LIVE with zero bets.
 *  4. Cache bust — drops the in-process homepage feed cache.
 *
 * Quota conservation:
 *  - The PAID pass is throttled to one run per SYNC_THROTTLE_MINUTES
 *    (default 60) — checked both in-process and against the DB marker
 *    `Setting: odds.lastSyncAt`, so restarts/multiple instances can't
 *    double-spend. Escape hatch: `?force=1`.
 *  - Live sweeps keep their own throttle (LIVE_SCORES_THROTTLE_SECONDS,
 *    default 300) mirrored in the DB (`Setting: live.lastSweepAt`), so cron
 *    hits and /live visitor sweeps share one budget.
 *  - Steps 2–4 ALWAYS run even when the pre-match pass is throttled —
 *    scores and statuses therefore stay fresh on a frequent cron schedule
 *    without paying for a full odds sync every minute.
 *
 * 200 with counts · 401 without the secret · 503 if unconfigured.
 */
const SYNC_THROTTLE_MS = (Number(process.env.SYNC_THROTTLE_MINUTES) || 60) * 60 * 1000;
let lastSyncAt = 0;
let inFlight: Promise<SyncOutcome> | null = null;

type SyncOutcome = {
  ok: boolean;
  synced: unknown;
  live: unknown;
  staleSweep: unknown;
  at: string;
  throttled?: boolean;
  retryInSeconds?: number;
  coalesced?: boolean;
};

/** Paid pre-match pass is due only if BOTH the process and the DB agree the
 *  throttle window has elapsed (DB marker survives restarts / other instances). */
async function isPrematchDue(now: number, force: boolean): Promise<{ due: boolean; dbLastSyncAt: number | null }> {
  if (force) return { due: true, dbLastSyncAt: null };
  let dbLastSyncAt: number | null = null;
  try {
    const row = await prisma.setting.findUnique({ where: { key: "odds.lastSyncAt" } });
    if (row?.value) {
      const t = new Date(row.value).getTime();
      if (Number.isFinite(t)) dbLastSyncAt = t;
    }
  } catch {
    /* marker unavailable — fall back to the in-process guard */
  }
  const inProcOk = lastSyncAt === 0 || now - lastSyncAt >= SYNC_THROTTLE_MS;
  const dbOk = dbLastSyncAt === null || now - dbLastSyncAt >= SYNC_THROTTLE_MS;
  return { due: inProcOk && dbOk, dbLastSyncAt };
}

async function runSync(force: boolean): Promise<SyncOutcome> {
  const now = Date.now();
  const { due, dbLastSyncAt } = await isPrematchDue(now, force);

  // 1) Pre-match odds/fixtures (paid) — only when the window has elapsed.
  let synced: unknown;
  if (due) {
    const r = await Promise.allSettled([syncGames()]);
    synced = r[0].status === "fulfilled" ? r[0].value : { error: r[0].reason instanceof Error ? r[0].reason.message : String(r[0].reason) };
  } else {
    const last = Math.max(lastSyncAt, dbLastSyncAt ?? 0);
    synced = {
      skipped: true,
      reason: "throttled",
      retryInSeconds: Math.max(1, Math.ceil((SYNC_THROTTLE_MS - (now - last)) / 1000)),
    };
  }

  // 2) Live score sweep + state machine (throttled internally, DB-shared).
  const liveRes = await Promise.allSettled([refreshLiveScores()]);
  const live = liveRes[0].status === "fulfilled" ? liveRes[0].value : { error: liveRes[0].reason instanceof Error ? liveRes[0].reason.message : String(liveRes[0].reason) };

  // 3) Stale sweep — ALWAYS, independent of the score throttle (DB-only, 0 credits).
  let staleSweep: unknown;
  try {
    staleSweep = await reconcileOrphanLiveGames();
  } catch (e) {
    staleSweep = { error: e instanceof Error ? e.message : String(e) };
  }

  // 4) In-process homepage feed cache.
  clearPrematchFeedCache();

  return { ok: true, synced, live, staleSweep, at: new Date().toISOString() };
}

export const GET = handle(async (req: NextRequest) => {
  await checkCronSecret(req);
  const force = req.nextUrl.searchParams.get("force") === "1";

  // Coalesce concurrent triggers onto the running sweep.
  if (inFlight) {
    const result = await inFlight;
    return ok({ ...result, coalesced: true });
  }

  inFlight = runSync(force);
  try {
    return ok(await inFlight);
  } finally {
    inFlight = null;
    lastSyncAt = Date.now();
  }
});

export const POST = GET;
