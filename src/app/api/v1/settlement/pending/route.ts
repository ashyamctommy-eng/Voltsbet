/**
 * GET /api/v1/settlement/pending
 *
 * The settlement worker's WORK LIST: which matches are worth scraping.
 *
 * WHY THIS EXISTS
 * Without it the worker scrapes a whole day of fixtures and throws almost all
 * of it away — burning the proxy budget (and the block rate) on matches nobody
 * bet on. Here the app answers the only question that matters: "which games
 * still have UNSETTLED selections on markets that need external statistics?"
 * Typically that is a handful of fixtures, not a hundred.
 *
 * A game qualifies when all of these hold:
 *   - it has at least one unsettled BetSelection whose bet is still OPEN
 *     (so there is money at stake, and the selection is not already decided);
 *   - that selection is on a stat-dependent market — corners, cards, or the
 *     half-time family (see STAT_DEPENDENT_MARKET_KEYS);
 *   - kickoff was at least `minAgeMinutes` ago (default 110) but no more than
 *     `maxAgeHours` ago (default 30, so ancient games are not chased for ever);
 *   - the game is not CANCELLED or POSTPONED.
 *
 * AUTH: same HMAC scheme as the POST receiver. A GET has no body, so the worker
 * signs the empty string: HMAC_SHA256(secret, "<unix-ts>.").
 *
 * The response carries NO database ids the worker can act on for scraping —
 * our `externalId` belongs to the odds feed, not to the scrape source. What the
 * worker needs is the identity BOTH sides share: the two team names and the
 * kickoff. It resolves those to its own source's event id (see
 * worker/settle_worker.py, resolve_pending_to_events).
 */
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { CARD_MARKET_KEYS, CORNER_MARKET_KEYS, HALF_TIME_MARKET_KEYS, STAT_DEPENDENT_MARKET_KEYS } from "@/lib/settlement/resolve-stats";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySettlementSignature } from "@/lib/settlement/signature";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_MIN_AGE_MINUTES = 110;
const DEFAULT_MAX_AGE_HOURS = 30;
const MAX_GAMES = 200;

/** What kind of scrape a game needs, so the worker can skip work it can't do. */
function needsFor(marketKeys: Iterable<string>): string[] {
  const needs = new Set<string>();
  for (const key of marketKeys) {
    if (CORNER_MARKET_KEYS.has(key)) needs.add("CORNERS");
    if (CARD_MARKET_KEYS.has(key)) needs.add("CARDS");
    if (HALF_TIME_MARKET_KEYS.has(key)) needs.add("HALF_TIME");
  }
  return [...needs];
}

function num(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export async function GET(req: Request) {
  const settings = await getSettings();
  // GET → empty body, so the signature covers just the timestamp.
  const check = verifySettlementSignature({
    secret: settings.settlementWebhookSecret,
    timestamp: req.headers.get(TIMESTAMP_HEADER),
    signature: req.headers.get(SIGNATURE_HEADER),
    rawBody: "",
  });
  if (!check.ok) {
    return NextResponse.json({ ok: false, error: check.reason }, { status: check.status });
  }

  const url = new URL(req.url);
  const minAgeMinutes = num(url.searchParams.get("minAgeMinutes"), DEFAULT_MIN_AGE_MINUTES, 0, 24 * 60);
  const maxAgeHours = num(url.searchParams.get("maxAgeHours"), DEFAULT_MAX_AGE_HOURS, 1, 24 * 30);
  const limit = num(url.searchParams.get("limit"), MAX_GAMES, 1, MAX_GAMES);

  const now = Date.now();
  const notBefore = new Date(now - maxAgeHours * 60 * 60 * 1000);
  const notAfter = new Date(now - minAgeMinutes * 60 * 1000);

  const rows = await prisma.betSelection.findMany({
    where: {
      settled: false,
      bet: { status: "OPEN" },
      outcome: { market: { key: { in: [...STAT_DEPENDENT_MARKET_KEYS] } } },
      game: {
        startAt: { gte: notBefore, lte: notAfter },
        status: { notIn: ["CANCELLED", "POSTPONED"] },
      },
    },
    select: {
      gameId: true,
      game: { select: { id: true, homeName: true, awayName: true, startAt: true, status: true, externalId: true } },
      outcome: { select: { market: { select: { key: true } } } },
    },
    take: 5000,
  });

  // Group by game — one entry per fixture, with what it needs and how many
  // selections ride on it (a proxy for how much money is waiting).
  const byGame = new Map<
    string,
    {
      gameId: string;
      externalId: string | null;
      kickoff: string;
      homeName: string;
      awayName: string;
      status: string;
      minutesSinceKickoff: number;
      picks: number;
      markets: Set<string>;
    }
  >();

  for (const r of rows) {
    const g = r.game;
    if (!g) continue;
    const entry = byGame.get(g.id) ?? {
      gameId: g.id,
      externalId: g.externalId,
      kickoff: g.startAt.toISOString(),
      homeName: g.homeName,
      awayName: g.awayName,
      status: g.status,
      minutesSinceKickoff: Math.round((now - g.startAt.getTime()) / 60000),
      picks: 0,
      markets: new Set<string>(),
    };
    entry.picks += 1;
    entry.markets.add(r.outcome.market.key);
    byGame.set(g.id, entry);
  }

  const games = [...byGame.values()]
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff)) // oldest first
    .slice(0, limit)
    .map((g) => ({
      gameId: g.gameId,
      externalId: g.externalId,
      kickoff: g.kickoff,
      homeName: g.homeName,
      awayName: g.awayName,
      status: g.status,
      minutesSinceKickoff: g.minutesSinceKickoff,
      picks: g.picks,
      markets: [...g.markets],
      needs: needsFor(g.markets),
    }));

  return NextResponse.json(
    {
      ok: true,
      generatedAt: new Date(now).toISOString(),
      window: { minAgeMinutes, maxAgeHours },
      count: games.length,
      games,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
