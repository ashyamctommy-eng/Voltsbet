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

  // Coverage. A "one long shared token is enough" rule was tempting (to forgive
  // "Wrexham AFC" vs "Wrexham") but it scores Manchester United vs Manchester
  // City at 0.8 — i.e. it would settle the wrong fixture. Club suffixes are
  // already stripped by normalizeTeamName, which is what makes that case a
  // clean 1.0 without the dangerous shortcut.
  const coverage = shared / Math.max(xs.size, ys.size);

  // CONTAINMENT: one name is the other plus extra words. Providers abbreviate
  // to DIFFERENT lengths for the same club — our feed had "VPS Vaasa" while
  // FotMob had "VPS" (coverage 0.5 → refused → that half-time score was never
  // scraped, and every half-time market on the match became manual for ever).
  // A full subset is safe in a way partial overlap is not: "Manchester United"
  // vs "Manchester City" overlaps but neither contains the other (still 0.5).
  // Reserve/youth/women markers are kept as distinct tokens, so "Juventus"
  // does not contain "Juventus U19".
  const xsArr = [...xs];
  const ysArr = [...ys];
  // A reserve/youth/women's side is a DIFFERENT team from the first team, no
  // matter how the names nest ("Juventus" ⊂ "Juventus U19", "Real Madrid" ⊂
  // "Real Madrid B"). If one side carries such a marker and the other does not,
  // they are not the same fixture — full stop.
  const markers = (tokens: string[]) => tokens.filter((t) => t.startsWith("~")).sort().join(",");
  if (markers(xsArr) !== markers(ysArr)) return 0;

  const named = (tokens: string[]) => tokens.some((t) => !t.startsWith("~"));
  const contained = xsArr.every((t) => ys.has(t)) || ysArr.every((t) => xs.has(t));
  if (contained && named(xsArr) && named(ysArr)) return 1;
  return coverage;
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
  let tied = false;

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

    if (!best || score > best.score) {
      best = { game: g, score };
      tied = false;
    } else if (score === best.score) {
      // Two fixtures in the window score identically (the containment rule
      // makes "X" match both "X" and "X Y"). Picking either one would settle a
      // customer against the wrong match, so refuse and let a human look.
      tied = true;
    }
  }

  return tied ? null : best?.game ?? null;
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
