/**
 * Sportmonks-backed 7-day match SCHEDULE cache + auto-purge.
 *
 * Complements (does not replace) the Odds API odds sync:
 *   - syncWeeklyFixtures(): bulk-fetches the rolling 7-day fixture calendar
 *     (today → today+7) from Sportmonks v3 and upserts it into the `Game`
 *     table (fixture data only — venue/status/times; NO odds — prices stay
 *     with the Odds API sync). Schedule-only rows get source="SCHEDULE" and
 *     are merged onto existing Odds API rows by team-pair + kickoff so the
 *     calendar and the priced games stay ONE row each.
 *   - purgeExpiredFixtures(): daily midnight job — deletes games that kicked
 *     off more than `maxAgeHours` ago and are not in play (markets cascade).
 *
 * Free-tier notes (verified 2026-08-25): Sportmonks fixtures/livescores are
 * included on the Starter trial; the `odds` include is 403-gated (ignored
 * here). Trial league coverage is limited (2 Extra Leagues add-on) — the
 * schedule covers what the plan covers.
 */
import { prisma } from "@/lib/prisma";

const TOKEN = process.env.SPORTMONKS_API_TOKEN ?? "";
const BASE = "https://api.sportmonks.com/v3";
const DAYS_AHEAD = 7;
const MAX_AGE_HOURS = Number(process.env.PURGE_MAX_AGE_HOURS) || 2;

/** Sportmonks state codes → local Game status keys. */
const STATUS_MAP: Record<string, string> = {
  NS: "SCHEDULED", LIVE: "LIVE", "1H": "LIVE", "2H": "LIVE", HT: "HALF_TIME",
  ET: "LIVE", PEN_LIVE: "LIVE", FT: "FINISHED", FT_PEN: "FINISHED",
  AWD: "FINISHED", WO: "FINISHED", POSTP: "POSTPONED", CANC: "CANCELLED",
  ABD: "ABANDONED", SUS: "SUSPENDED", DELAY: "DELAYED", INT: "INTERRUPTED",
};
const INPLAY_STATUSES = ["LIVE", "HALF_TIME"];

function localDateISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type ScheduleFixture = {
  id: number;
  name?: string;
  starting_at?: string; // "2026-08-25 16:05:00" — UTC, no zone suffix
  status?: string;
  league?: { id?: number; name?: string } | null;
  participants?: { id?: number; name?: string; meta?: { location?: string } }[];
};

export type ScheduleSyncResult = {
  ok: boolean;
  from?: string;
  to?: string;
  fetched?: number;
  created?: number;
  updated?: number;
  skipped?: number;
  error?: string;
};

/** Bulk-fetch the rolling 7-day fixture calendar and upsert into the DB. */
export async function syncWeeklyFixtures(): Promise<ScheduleSyncResult> {
  if (!TOKEN) {
    return { ok: false, error: "SPORTMONKS_API_TOKEN not set" };
  }
  const from = localDateISO(0);
  const to = localDateISO(DAYS_AHEAD);
  const all: ScheduleFixture[] = [];

  // Paginate (per_page max 100) until a short page or an error.
  for (let page = 1; page <= 5; page++) {
    const url =
      `${BASE}/football/fixtures/between/${from}/${to}` +
      `?include=participants;league;state;venue&per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: { Authorization: TOKEN },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      return { ok: false, from, to, error: `Sportmonks HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}` };
    }
    const json = (await res.json()) as { data?: ScheduleFixture[] };
    const batch = json?.data ?? [];
    all.push(...batch);
    if (batch.length < 100) break;
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const f of all) {
    const parts = f.participants ?? [];
    const byLoc = (loc: string) => parts.find((p) => p.meta?.location === loc)?.name;
    const home = byLoc("home") ?? parts[0]?.name;
    const away = byLoc("away") ?? parts[1]?.name;
    if (!home || !away) {
      skipped++;
      continue;
    }
    // Sportmonks starting_at is UTC with no zone suffix — treat as UTC.
    const startAt = f.starting_at ? new Date(f.starting_at.replace(" ", "T") + "Z") : null;
    if (!startAt || isNaN(startAt.getTime())) {
      skipped++;
      continue;
    }
    const status = STATUS_MAP[f.status ?? "NS"] ?? "SCHEDULED";
    const competitionName = f.league?.name ?? null;
    const externalId = `smk-${f.id}`;
    const payload = {
      competitionName,
      homeName: home,
      awayName: away,
      startAt,
      status,
    };

    // 1) exact upsert key (previous schedule sync)
    const byExt = await prisma.game.findUnique({ where: { externalId } });
    if (byExt) {
      await prisma.game.update({ where: { id: byExt.id }, data: payload });
      updated++;
      continue;
    }
    // 2) merge onto an existing Odds-API synced game (same teams, ~kickoff)
    const byMatch = await prisma.game.findFirst({
      where: {
        homeName: home,
        awayName: away,
        startAt: { gte: new Date(startAt.getTime() - 3 * 3600_000), lte: new Date(startAt.getTime() + 3 * 3600_000) },
      },
    });
    if (byMatch) {
      await prisma.game.update({ where: { id: byMatch.id }, data: payload });
      updated++;
      continue;
    }
    // 3) brand-new schedule row (no odds yet — prices attach later)
    const sport = await prisma.sport.findUnique({ where: { slug: "football" } });
    await prisma.game.create({
      data: {
        ...payload,
        sportId: sport?.id ?? (await prisma.sport.findFirstOrThrow({ where: { slug: "football" } })).id,
        source: "SCHEDULE",
        externalId,
      },
    });
    created++;
  }

  return { ok: true, from, to, fetched: all.length, created, updated, skipped };
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
