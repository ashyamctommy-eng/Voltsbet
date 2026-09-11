/**
 * Team/fixture matching — the bridge between the two id spaces.
 *
 * Our `Game.externalId` is The Odds API's event id; API-Football has its own
 * fixture ids (e.g. 1635659). There is no shared key, so a game is tied to a
 * fixture by KICKOFF TIME + TEAM NAMES, and the resulting mapping is cached in
 * `Setting` (`stats.map.<gameId>`) so the match is made once, then reused.
 *
 * Pure functions — the whole risk of the feed lives here, so it is unit-tested
 * against real names ("Fenerbahçe" vs "Fenerbahce", "AS Roma" vs "Roma").
 */

/** Strip accents, punctuation, and club-type noise words so names compare cleanly. */
export function normalizeTeamName(raw: string): string {
  return (raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // é → e, ç → c …
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    // Club-type tokens carry no information and differ between providers.
    .replace(/\b(fc|cf|sc|afc|ac|as|ss|ssc|sv|vfl|vfb|cd|ud|rc|ca|fk|sk|if|bk|club|de|futbol|futebol|calcio|sportive|sportif)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 0 = no relation, 1 = partial token overlap, 2 = same normalized name. */
export function teamMatchScore(a: string, b: string): number {
  const x = normalizeTeamName(a);
  const y = normalizeTeamName(b);
  if (!x || !y) return 0;
  if (x === y) return 2;
  const tx = x.split(" ");
  const ty = y.split(" ");
  const overlap = tx.filter((t) => ty.includes(t)).length;
  if (overlap === 0) return 0;
  return 1 + overlap / Math.max(tx.length, ty.length); // 1 < score < 2
}

export type FixtureLike = { fixtureId: number; homeName: string; awayName: string; date: string | null };

/** Kickoff tolerance: providers disagree on exact minute/venue timezone. */
const KICKOFF_TOLERANCE_MS = 5 * 60 * 60 * 1000;

/**
 * Best fixture for a game: both sides must be recognisable and the kickoff
 * within tolerance (so a rematch months later can never be picked up).
 */
export function matchFixture<T extends FixtureLike>(
  game: { homeName: string; awayName: string; startAt: Date | string },
  fixtures: T[],
): T | null {
  const start = game.startAt instanceof Date ? game.startAt : new Date(game.startAt);
  if (Number.isNaN(start.getTime())) return null;

  let best: T | null = null;
  let bestScore = 0;
  for (const f of fixtures) {
    const home = teamMatchScore(game.homeName, f.homeName);
    const away = teamMatchScore(game.awayName, f.awayName);
    if (home < 1 || away < 1) continue; // both sides must look alike
    if (f.date) {
      const t = new Date(f.date).getTime();
      if (Number.isFinite(t) && Math.abs(t - start.getTime()) > KICKOFF_TOLERANCE_MS) continue;
    }
    const score = home + away;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}
