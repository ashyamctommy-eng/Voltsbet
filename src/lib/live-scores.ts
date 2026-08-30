/**
 * On-demand live-score refresh for the /live route.
 *
 * Every page render (client polls every `live.refreshSeconds`, plus manual
 * navigations) calls refreshLiveScores(); the in-process throttle guarantees
 * at most ONE BetsAPI inplay request per window, so visitors can't hammer the
 * quota. Scores/timers/status are upserted onto existing DB games; games not
 * in the inplay feed are left untouched (settlement is the sync's job).
 *
 * Quota math: 1 request per window → at 60s that is 60/hr (BASIC plans are
 * capped around ~16/hr — set live.refreshSeconds higher if you're on a tight
 * plan, or use the paid tier).
 */
import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { BetsApiProvider } from "./providers/betsapi";
import type { ApiScore } from "./providers/odds-api";

let lastRefresh = 0;

export async function refreshLiveScores(): Promise<{
  updated: number;
  skipped: boolean;
}> {
  const s = await getSettings();
  const windowMs = Math.max(10, (s.liveRefreshSeconds || 60) * 1000);
  const now = Date.now();
  if (now - lastRefresh < windowMs) return { updated: 0, skipped: true };

  // Record the attempt even on failure — acts as a backoff so a quota window
  // doesn't get re-hit on every poll.
  lastRefresh = now;

  try {
    const provider = new BetsApiProvider();
    const scores = (await provider.fetchLiveScores(["1"])) as ApiScore[];
    let updated = 0;
    for (const score of scores) {
      const game = await prisma.game.findUnique({ where: { externalId: score.externalId } });
      if (!game) continue;
      await prisma.game.update({
        where: { id: game.id },
        data: {
          ...(score.homeScore !== undefined ? { homeScore: score.homeScore } : {}),
          ...(score.awayScore !== undefined ? { awayScore: score.awayScore } : {}),
          status: score.status === "finished" ? "FINISHED" : score.status === "live" ? "LIVE" : game.status,
          // A finished game is never live — stale live:true used to keep
          // finished matches on the "live" surfaces (home feed, slideshow).
          ...(score.status === "finished" ? { live: false } : {}),
          ...(score.status === "live" ? { live: true, clock: score.clock ?? null, period: score.period ?? null } : {}),
        },
      });
      updated++;
    }
    return { updated, skipped: false };
  } catch {
    return { updated: 0, skipped: false };
  }
}
