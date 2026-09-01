/**
 * Cache-first match schedule route.
 *
 *   GET /api/matches?date=YYYY-MM-DD&limit=30&page=2
 *
 * Serves the 7-day fixture calendar from the LOCAL database first (filtered
 * to the requested calendar day). Only when the DB has ZERO matches for that
 * timeframe does it hit an external API (the Odds API cold bootstrap) — so
 * repeated calendar views cost 0 external requests once the schedule sync
 * (/api/cron/schedule) has populated the week.
 *
 * Pagination: limit (default 30, max 500) + page (1-based) → the response
 * carries total + totalPages for full Prev / 1 … N / Next controls.
 *
 * Past-match filter: fixtures that already kicked off (startAt <= now) are
 * NOT pre-match — they belong on /live (LIVE/HALF_TIME rows) or the results
 * archive (FINISHED). Pre-match listings therefore only show startAt > now,
 * plus any row the live engine is actively tracking.
 */
import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getPrematchFeed, apiMatchToFeedGame } from "@/lib/feed";

/** Local-midnight calendar window for a ?date=YYYY-MM-DD param. */
function localDayWindow(date: string): { from: Date; to: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const from = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); // local midnight
  if (Number.isNaN(from.getTime())) return null;
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
  return { from, to };
}

function localDateString(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const dynamic = "force-dynamic";

export const GET = handle(async (req: NextRequest) => {
  const date = req.nextUrl.searchParams.get("date") ?? localDateString(0);
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 30, 1), 500);
  const page = Math.max(Number(req.nextUrl.searchParams.get("page")) || 1, 1);

  const win = localDayWindow(date);
  if (!win) {
    return ok({ date, source: "db", count: 0, total: 0, totalPages: 0, page, matches: [], error: "Invalid date — use YYYY-MM-DD" });
  }

  const now = new Date();
  const baseWhere = {
    startAt: { gte: win.from, lt: win.to },
    status: { notIn: ["CANCELLED"] },
    // Pre-match view excludes fixtures that already kicked off (they belong
    // on /live or the results archive) — except rows the live engine is
    // actively tracking, which keep showing wherever they are served.
    OR: [
      { startAt: { gte: now } },
      { status: { in: ["LIVE", "HALF_TIME", "FINISHED"] } },
    ],
  };

  const [total, rows] = await Promise.all([
    prisma.game.count({ where: baseWhere }),
    prisma.game.findMany({
      where: baseWhere,
      include: {
        sport: true,
        markets: { include: { outcomes: true }, orderBy: { sortOrder: "asc" } },
      },
      orderBy: [{ startAt: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  let matches = rows;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  let source: "db" | "api" = "db";

  // External fallback ONLY when the local calendar is empty for this day AND
  // the date is within the rolling 7-day schedule window (a far-future date
  // must not be answered with today's feed).
  if (total === 0 && date >= localDateString(0) && date <= localDateString(7)) {
    const feed = await getPrematchFeed(limit).catch(() => null);
    if (feed?.matches.length) {
      matches = feed.matches.map(apiMatchToFeedGame) as typeof matches;
      source = "api";
    }
  }

  return ok({
    date,
    source,
    page,
    limit,
    count: matches.length,
    total,
    totalPages: source === "api" ? 1 : totalPages,
    matches,
  });
});
