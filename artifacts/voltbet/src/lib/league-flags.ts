/**
 * Country-flag lookup for league names ("England - Premier League").
 * Pure + client-safe; unknown leagues render without a flag.
 */
const COUNTRY_FLAGS: [string, string][] = [
  // Home nations (tag-sequence flags render inline)
  ["England", "🏴󠁧󠁢󠁥󠁮󠁧󠁿"],
  ["Scotland", "🏴󠁧󠁢󠁳󠁣󠁴󠁿"],
  ["Wales", "🏴󠁧󠁢󠁷󠁬󠁳󠁿"],
  ["Ireland", "🇮🇪"],
  // Big-5 + core European leagues
  ["Spain", "🇪🇸"],
  ["Italy", "🇮🇹"],
  ["Germany", "🇩🇪"],
  ["France", "🇫🇷"],
  ["Portugal", "🇵🇹"],
  ["Netherlands", "🇳🇱"],
  ["Belgium", "🇧🇪"],
  ["Turkey", "🇹🇷"],
  ["Greece", "🇬🇷"],
  ["Switzerland", "🇨🇭"],
  ["Austria", "🇦🇹"],
  ["Denmark", "🇩🇰"],
  ["Sweden", "🇸🇪"],
  ["Norway", "🇳🇴"],
  ["Finland", "🇫🇮"],
  ["Iceland", "🇮🇸"],
  ["Poland", "🇵🇱"],
  ["Czech", "🇨🇿"],
  ["Slovakia", "🇸🇰"],
  ["Hungary", "🇭🇺"],
  ["Romania", "🇷🇴"],
  ["Bulgaria", "🇧🇬"],
  ["Croatia", "🇭🇷"],
  ["Serbia", "🇷🇸"],
  ["Slovenia", "🇸🇮"],
  ["Ukraine", "🇺🇦"],
  ["Russia", "🇷🇺"],
  ["Belarus", "🇧🇾"],
  ["Bosnia", "🇧🇦"],
  ["North Macedonia", "🇲🇰"],
  ["Albania", "🇦🇱"],
  ["Montenegro", "🇲🇪"],
  ["Kosovo", "🇽🇰"],
  ["Moldova", "🇲🇩"],
  ["Latvia", "🇱🇻"],
  ["Lithuania", "🇱🇹"],
  ["Estonia", "🇪🇪"],
  ["Cyprus", "🇨🇾"],
  ["Malta", "🇲🇹"],
  ["Luxembourg", "🇱🇺"],
  ["Georgia", "🇬🇪"],
  ["Armenia", "🇦🇲"],
  ["Azerbaijan", "🇦🇿"],
  ["Kazakhstan", "🇰🇿"],
  ["Israel", "🇮🇱"],
  // Americas
  ["Brazil", "🇧🇷"],
  ["Argentina", "🇦🇷"],
  ["Mexico", "🇲🇽"],
  ["USA", "🇺🇸"],
  ["Colombia", "🇨🇴"],
  ["Chile", "🇨🇱"],
  ["Uruguay", "🇺🇾"],
  ["Paraguay", "🇵🇾"],
  ["Peru", "🇵🇪"],
  ["Ecuador", "🇪🇨"],
  ["Bolivia", "🇧🇴"],
  ["Venezuela", "🇻🇪"],
  ["Costa Rica", "🇨🇷"],
  ["Panama", "🇵🇦"],
  ["Honduras", "🇭🇳"],
  ["El Salvador", "🇸🇻"],
  ["Guatemala", "🇬🇹"],
  ["Canada", "🇨🇦"],
  // Africa (curated leagues)
  ["South Africa", "🇿🇦"],
  ["Egypt", "🇪🇬"],
  ["Nigeria", "🇳🇬"],
  ["Ghana", "🇬🇭"],
  ["Tanzania", "🇹🇿"],
  ["Uganda", "🇺🇬"],
  ["Zimbabwe", "🇿🇼"],
  ["Tunisia", "🇹🇳"],
  ["Algeria", "🇩🇿"],
  ["Angola", "🇦🇴"],
  ["Mozambique", "🇲🇿"],
  ["Malawi", "🇲🇼"],
  ["Kenya", "🇰🇪"],
  ["Morocco", "🇲🇦"],
  ["Zambia", "🇿🇲"],
  ["Senegal", "🇸🇳"],
  ["Ivory Coast", "🇨🇮"],
  ["Congo", "🇨🇬"],
  ["DR Congo", "🇨🇩"],
  ["Cameroon", "🇨🇲"],
  ["Ethiopia", "🇪🇹"],
  ["Libya", "🇱🇾"],
  ["Sudan", "🇸🇩"],
  // Asia / Oceania
  ["Japan", "🇯🇵"],
  ["China", "🇨🇳"],
  ["South Korea", "🇰🇷"],
  ["India", "🇮🇳"],
  ["Australia", "🇦🇺"],
  ["New Zealand", "🇳🇿"],
  ["Thailand", "🇹🇭"],
  ["Vietnam", "🇻🇳"],
  ["Indonesia", "🇮🇩"],
  ["Malaysia", "🇲🇾"],
  ["Singapore", "🇸🇬"],
  ["Philippines", "🇵🇭"],
  ["Hong Kong", "🇭🇰"],
  ["Taiwan", "🇹🇼"],
  ["Iran", "🇮🇷"],
  ["Iraq", "🇮🇶"],
  ["Jordan", "🇯🇴"],
  ["Kuwait", "🇰🇼"],
  ["Bahrain", "🇧🇭"],
  ["Oman", "🇴🇲"],
  ["Lebanon", "🇱🇧"],
  ["Qatar", "🇶🇦"],
  ["Saudi Arabia", "🇸🇦"],
  ["UAE", "🇦🇪"],
];

/**
 * Flag emoji for a league name ("England - Premier League" → 🏴󠁧󠁢󠁥󠁮󠁧󠁿).
 * Continental cups fall back to a region glyph; unknown → "".
 */
export function flagForLeague(name: string | null | undefined): string {
  if (!name) return "";
  const lower = name.toLowerCase();
  for (const [country, flag] of COUNTRY_FLAGS) {
    if (lower.startsWith(country.toLowerCase())) return flag;
  }
  if (lower.includes("uefa") || lower.includes("europa") || lower.includes("champions league")) return "🇪🇺";
  if (lower.includes("caf") || lower.includes("africa")) return "🌍";
  if (lower.includes("conmebol") || lower.includes("copa") || lower.includes("libertadores")) return "🌎";
  if (lower.includes("concacaf")) return "🌎";
  if (lower.includes("afc") || lower.includes("asian")) return "🌏";
  return "";
}

/**
 * Country name for a competition — powers the "England • Premier League"
 * card header. Odds API titles carry the country prefix ("England -
 * Premier League"); known leagues without a prefix get a fallback map.
 */
const LEAGUE_COUNTRY_FALLBACK: [string, string][] = [
  ["premier league", "England"], ["championship", "England"], ["fa cup", "England"],
  ["la liga", "Spain"], ["serie a", "Italy"], ["bundesliga", "Germany"],
  ["ligue 1", "France"], ["eredivisie", "Netherlands"], ["primeira liga", "Portugal"],
  ["scottish premiership", "Scotland"], ["super lig", "Turkey"], ["superliga", "Argentina"],
  ["serie a brazil", "Brazil"], ["brazil", "Brazil"], ["mls", "USA"], ["major league soccer", "USA"],
  ["nba", "USA"], ["mlb", "USA"], ["nfl", "USA"], ["nhl", "USA"],
  ["champions league", "Europe"], ["europa league", "Europe"], ["conference league", "Europe"],
  ["world cup", "International"], ["afcon", "Africa"], ["caf", "Africa"],
];

export function countryForLeague(name: string | null | undefined): string {
  if (!name) return "";
  const lower = name.toLowerCase();
  // "England - Premier League" → "England" (first country token before " - ").
  const prefix = lower.split(" - ")[0].trim();
  for (const [country] of COUNTRY_FLAGS) {
    if (prefix === country.toLowerCase()) return country;
  }
  for (const [key, country] of LEAGUE_COUNTRY_FALLBACK) {
    if (lower.includes(key)) return country;
  }
  return "";
}
