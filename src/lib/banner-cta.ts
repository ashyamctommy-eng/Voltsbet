/**
 * Banner CTA safety.
 *
 * WHY THIS EXISTS
 * A banner's call-to-action can point at ONE specific game (`/match/<id>` or
 * `/fixture/<id>`). The banner row then lives in the database for ever, while
 * the game it names is removed by the daily cleanup cron. The link rots into a
 * 404 with no warning: the seeded "El Clásico — Live · Bet Now" banner survived
 * its demo fixture and sent every click to a dead page.
 *
 * A CTA is a promise that the destination exists. So a game CTA is resolved
 * against the database at render time and is rewritten to a stable destination
 * when the game is gone — the banner keeps working instead of advertising a
 * page that 404s.
 */
import { prisma } from "@/lib/prisma";

/** Matches a CTA that targets a single game (both route spellings). */
const GAME_CTA_RE = /^\/(?:match|fixture)\/([A-Za-z0-9_-]+)\/?$/;

/** Where a rotten game CTA is sent instead. `/live` always exists. */
export const BANNER_CTA_FALLBACK = "/live";

/** The game id a CTA targets, or null when it targets something else. */
export function gameIdFromCta(url: string | null | undefined): string | null {
  const m = GAME_CTA_RE.exec((url ?? "").trim());
  return m ? m[1] : null;
}

type CtaBanner = { ctaUrl: string | null };

/**
 * Rewrite any CTA that points at a game which no longer exists.
 *
 * One query per render, and only when a banner actually targets a game, so the
 * cost is nil for the common case of banners pointing at /register etc.
 */
export async function sanitizeBannerCtas<T extends CtaBanner>(
  banners: T[],
  fallback: string = BANNER_CTA_FALLBACK,
): Promise<T[]> {
  const ids = [...new Set(banners.map((b) => gameIdFromCta(b.ctaUrl)).filter((x): x is string => !!x))];
  if (!ids.length) return banners;

  let alive: Set<string>;
  try {
    const rows = await prisma.game.findMany({ where: { id: { in: ids } }, select: { id: true } });
    alive = new Set(rows.map((r) => r.id));
  } catch {
    // Never let banner hygiene take down the homepage: on a DB error, leave the
    // CTAs untouched rather than inventing a destination.
    return banners;
  }

  return banners.map((b) => {
    const gid = gameIdFromCta(b.ctaUrl);
    return gid && !alive.has(gid) ? { ...b, ctaUrl: fallback } : b;
  });
}
