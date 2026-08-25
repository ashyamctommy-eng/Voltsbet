/**
 * The Odds API-backed 7-day match SCHEDULE cache + auto-purge.
 *
 * Complements (does not replace) the Odds API odds sync:
 *   - syncWeeklyFixtures(): walks the in-season FEED_LEAGUES via the FREE
 *     /v4/sports/{sport}/events endpoint (0 quota cost) and upserts the
 *     rolling [today, today+7] fixture calendar into `Game`. New rows get
 *     source="SCHEDULE"; events whose Odds API id already exists (or whose
 *     team-pair + kickoff matches) are merged onto the priced games so the
 *     calendar and the odds stay ONE row each.
 *   - purgeExpiredFixtures(): daily midnight job — deletes games that kicked
 *     off more than `maxAgeHours` ago and are not in play (markets cascade).
 *
 * Provider bake-off (verified live 2026-08-25, all three with real keys):
 * The Odds API /events won — 0 quota cost, deepest horizon (303 events,
 * EPL→Sep 6, Serie A→Sep 7), no third provider/token. BetsAPI `upcoming`
 * lists TODAY only (a live engine, not a calendar). Sportmonks trial
 * coverage was thin (7 leagues, missing EFL Cup entirely). See
 * memory/2026-08-25.md for the full comparison.
 */
import { prisma } from "@/lib/prisma";
import { FEED_LEAGUES, LEAGUE_TITLES } from "@/lib/feed";

const API_KEY = process.env.ODDS_API_KEY ?? "";
const BASE = "https://api.the-odds-api.com/v4";
const DAYS_AHEAD = 7;
const MAX_AGE_HOURS = Number(process.env.PURGE_MAX_AGE_HOURS) || 2;
const INPLAY_STATUSES = ["LIVE", "HALF_TIME"];

function localDateISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local-midnight window boundaries for the rolling [today, today+7] range. */
function windowBoundaries(): { from: Date; to: Date } {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + DAYS_AHEAD + 1);
  return { from, to };
}

type OddsEvent = {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
};

export type ScheduleSyncResult = {
  ok: boolean;
  from?: string;
  to?: string;
  fetched?: number;
  created?: number;
  updated?: number;
  skipped?: number;
  leagues?: number;
  errors?: string[];
  error?: string;
};

/**
 * Bulk-fetch the rolling 7-day fixture calendar from The Odds API /events
 * (0 quota cost) and upsert into the DB. One request per in-season league.
 */
export async function syncWeeklyFixtures(): Promise<ScheduleSyncResult> {
  if (!API_KEY) {
    return { ok: false, error: "ODDS_API_KEY not set" };
  }
  const from = localDateISO(0);
  const to = localDateISO(DAYS_AHEAD);
  const { from: winFrom, to: winTo } = windowBoundaries();

  const sport = await prisma.sport.findFirst({ where: { slug: "football" } });
  if (!sport) {
    return { ok: false, from, to, error: "football sport not seeded" };
  }

  const seen = new Set<string>();
  const errors: string[] = [];
  let fetched = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const leagueKey of FEED_LEAGUES) {
    const url = `${BASE}/sports/${leagueKey}/events?apiKey=${encodeURIComponent(API_KEY)}`;
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    } catch {
      errors.push(`${leagueKey}: fetch failed`);
      continue;
    }
    if (!res.ok) {
      // Unpriced/absent leagues return 404 — not an error worth failing on.
      if (res.status === 404) continue;
      errors.push(`${leagueKey}: HTTP ${res.status}`);
      continue;
    }
    const events = (await res.json().catch(() => null)) as OddsEvent[] | null;
    if (!Array.isArray(events)) continue;

    const title = LEAGUE_TITLES[leagueKey] ?? null;
    for (const ev of events) {
      if (seen.has(ev.id)) continue; // same event under a second key
      seen.add(ev.id);
      fetched++;

      const startAt = new Date(ev.commence_time);
      if (Number.isNaN(startAt.getTime())) {
        skipped++;
        continue;
      }
      // Keep the table lean: only the rolling 7-day window (events beyond it
      // are picked up by later daily runs).
      if (startAt < winFrom || startAt >= winTo) {
        skipped++;
        continue;
      }
      if (!ev.home_team || !ev.away_team) {
        skipped++;
        continue;
      }

      const payload = {
        competitionName: title,
        homeName: ev.home_team,
        awayName: ev.away_team,
        startAt,
      };

      // 1) exact upsert key — same Odds API event id the odds sync uses
      const byExt = await prisma.game.findUnique({ where: { externalId: ev.id } });
      if (byExt) {
        // Don't clobber status (LIVE/FINISHED from the live engine or scores
        // sync) — /events carries no status field.
        await prisma.game.update({ where: { id: byExt.id }, data: payload });
        updated++;
        continue;
      }
      // 2) merge onto an existing game (same teams, ~kickoff)
      const byMatch = await prisma.game.findFirst({
        where: {
          homeName: ev.home_team,
          awayName: ev.away_team,
          startAt: {
            gte: new Date(startAt.getTime() - 3 * 3600_000),
            lte: new Date(startAt.getTime() + 3 * 3600_000),
          },
        },
      });
      if (byMatch) {
        await prisma.game.update({ where: { id: byMatch.id }, data: payload });
        updated++;
        continue;
      }
      // 3) brand-new schedule row (no odds yet — prices attach later)
      await prisma.game.create({
        data: {
          ...payload,
          status: "SCHEDULED",
          sportId: sport.id,
          source: "SCHEDULE",
          externalId: ev.id,
        },
      });
      created++;
    }
  }

  return {
    ok: true,
    from,
    to,
    fetched,
    created,
    updated,
    skipped,
    leagues: FEED_LEAGUES.length,
    ...(errors.length ? { errors } : {}),
  };
}

/** Daily midnight purge — delete expired, not-in-play games (markets cascade). */
export async function purgeExpiredFixtures(): Promise<{ deleted: number; keptWithBets: number; cutoff: Date; maxAgeHours: number }> {
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600_000);
  // Games with bet selections are never purged (BetSelection.game is
  // Restrict — and bet history/results must survive the cleanup).
  const del = await prisma.game.deleteMany({
    where: {
      startAt: { lt: cutoff },
      status: { notIn: INPLAY_STATUSES },
      selections: { none: {} },
    },
  });
  const keptWithBets = await prisma.game.count({
    where: {
      startAt: { lt: cutoff },
      status: { notIn: INPLAY_STATUSES },
      selections: { some: {} },
    },
  });
  return { deleted: del.count, keptWithBets, cutoff, maxAgeHours: MAX_AGE_HOURS };
}
