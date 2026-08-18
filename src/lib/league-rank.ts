/**
 * Competition ranking — used by the hero slideshow and the matches feed to
 * lift recognizable competitions above the long tail.
 *
 * Odds-API.io league names include the country prefix ("England - Premier
 * League", "International Clubs - UEFA Champions League"), so substring match
 * against the lowercased competition name works for every provider.
 */

export const TOP_LEAGUES = [
  "champions league", "europa league", "conference league", "world cup",
  "afcon", "african nations", "copa america", "copa libertadores",
  "premier league", "la liga", "serie a", "bundesliga", "ligue 1",
  "eredivisie", "primeira liga", "championship", "fa cup",
  "scottish premiership", "super lig",
  // African competitions/leagues get boosted ahead of the long tail
  "south africa", "egypt", "nigeria", "ghana", "kenya", "tanzania", "uganda",
  "zimbabwe", "morocco", "tunisia", "algeria", "angola", "mozambique",
  "zambia", "malawi", "ethiopia", "senegal", "caf",
];

/** Lower rank = higher priority. Unknown leagues rank last (TOP_LEAGUES.length). */
export function leagueRank(competitionName: string | null | undefined): number {
  const name = (competitionName ?? "").toLowerCase();
  const i = TOP_LEAGUES.findIndex((k) => name.includes(k));
  return i === -1 ? TOP_LEAGUES.length : i;
}
