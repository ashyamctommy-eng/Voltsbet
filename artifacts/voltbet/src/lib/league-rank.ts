/**
 * Competition ranking — used by the hero slideshow and the matches feed to
 * lift recognizable competitions above the long tail.
 *
 * Priority order (product decision 2026-08-25): UEFA club/international →
 * EFL (English Football League) → La Liga → rest of the big five → others.
 *
 * Odds-API.io league names include the country prefix ("England - Premier
 * League", "International Clubs - UEFA Champions League"), so substring match
 * against the lowercased competition name works for every provider.
 */

export const TOP_LEAGUES = [
  // ── UEFA (club + international) ──────────────────────────────────────
  "champions league", "europa league", "conference league",
  "uefa nations league", "uefa super cup", "uefa euro",
  // ── EFL (English Football League) ────────────────────────────────────
  "championship", "league one", "league two", "efl cup", "efl trophy",
  // ── Spain ────────────────────────────────────────────────────────────
  "la liga",
  // ── Rest of the big five ─────────────────────────────────────────────
  "premier league", "serie a", "bundesliga", "ligue 1",
  // ── Other European ───────────────────────────────────────────────────
  "eredivisie", "primeira liga", "fa cup", "scottish premiership", "super lig",
  // ── International / global ───────────────────────────────────────────
  "world cup", "copa america", "copa libertadores",
];

/** Lower rank = higher priority. Unknown leagues rank last (TOP_LEAGUES.length). */
export function leagueRank(competitionName: string | null | undefined): number {
  const name = (competitionName ?? "").toLowerCase();
  const i = TOP_LEAGUES.findIndex((k) => name.includes(k));
  return i === -1 ? TOP_LEAGUES.length : i;
}
