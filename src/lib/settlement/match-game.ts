/**
 * Matching a scraped match onto OUR Game row.
 *
 * The worker scrapes a third party (SofaScore) and therefore knows its own
 * event id, never ours. There are two independent id spaces, so the match is
 * resolved on what BOTH sides have: the two team names and the kickoff time.
 *
 * Safety rule: if the teams cannot be matched with confidence, return null and
 * let the ingest mark the event NEEDS_REVIEW. A guessed fixture would settle
 * the wrong customers' bets — far worse than leaving the event for a human.
 */
import { normalizeTeamName } from "./resolve-stats";

export type GameCandidate = {
  id: string;
  homeName: string;
  awayName: string;
  startAt: Date;
};

/**
 * Similarity of two team names in [0, 1]: token containment with a bonus for an
 * exact match. Deliberately strict — "United" alone must never match.
 */
export function teamMatchScore(a: string, b: string): number {
  const x = normalizeTeamName(a);
  const y = normalizeTeamName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;

  const xs = new Set(x.split(" "));
  const ys = new Set(y.split(" "));
  let shared = 0;
  for (const t of xs) if (ys.has(t) && t.length >= 3) shared++;
  if (!shared) return 0;

  // Coverage only. A "one long shared token is enough" rule was tempting (to
  // forgive "Wrexham AFC" vs "Wrexham") but it scores Manchester United vs
  // Manchester City at 0.8 — i.e. it would settle the wrong fixture. Club
  // suffixes are already stripped by normalizeTeamName, which is what makes
  // that case a clean 1.0 without the dangerous shortcut.
  return shared / Math.max(xs.size, ys.size);
}

/** Minimum score for both sides before we will settle against a fixture. */
export const MIN_TEAM_SCORE = 0.6;

/** Kickoff tolerance: scrapers report the same kickoff, but timezones drift. */
export const KICKOFF_TOLERANCE_MINUTES = 180;

/**
 * Pick the best candidate Game for a scraped match, or null when nothing is
 * confident enough. Candidates should be games within a day or so of kickoff
 * (the caller narrows that with a cheap query).
 */
export function pickGame<T extends GameCandidate>(
  candidates: readonly T[],
  want: { homeName: string; awayName: string; kickoff: Date },
): T | null {
  let best: { game: T; score: number } | null = null;

  for (const g of candidates) {
    const kickoffDeltaMin = Math.abs(g.startAt.getTime() - want.kickoff.getTime()) / 60000;
    if (kickoffDeltaMin > KICKOFF_TOLERANCE_MINUTES) continue;

    // Orient both ways: a scraper occasionally swaps home/away.
    const straight = Math.min(
      teamMatchScore(g.homeName, want.homeName),
      teamMatchScore(g.awayName, want.awayName),
    );
    const swapped = Math.min(
      teamMatchScore(g.homeName, want.awayName),
      teamMatchScore(g.awayName, want.homeName),
    );
    const score = Math.max(straight, swapped);
    if (score < MIN_TEAM_SCORE) continue;

    if (!best || score > best.score) best = { game: g, score };
  }

  return best?.game ?? null;
}

/**
 * True when the scraped home/away orientation is REVERSED relative to our game
 * — the caller must flip the per-team numbers before settling, or every
 * team-scoped market resolves against the wrong side.
 */
export function isOrientationSwapped(
  game: { homeName: string; awayName: string },
  want: { homeName: string; awayName: string },
): boolean {
  const straight = Math.min(
    teamMatchScore(game.homeName, want.homeName),
    teamMatchScore(game.awayName, want.awayName),
  );
  const swapped = Math.min(
    teamMatchScore(game.homeName, want.awayName),
    teamMatchScore(game.awayName, want.homeName),
  );
  return swapped > straight;
}
