/**
 * Standard BetsAPI → UI data transformation layer.
 *
 * Two entry points produce ONE view contract (`MatchView`):
 *   - transformBetsApiMatch(raw) — raw BetsAPI objects (upcoming / inplay)
 *   - toMatchView(game)          — DB Game rows (the sync'd feed)
 *
 * Match cards consume `MatchView` only, so raw-API proxies and the synced DB
 * render through identical logic. extractOddsMarkets() parses the bet365
 * prematch market object (main.sp / others) into our market model.
 */
import { formatKickoff } from "../kickoff";
import { applyMarginGrid } from "../margin";

/** The single view shape every match card renders. */
export type MatchView = {
  id: string;
  isLive: boolean;
  timeStatus: string; // "0" pre-match, "1" live, "3" finished (or DB status)
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  score: string;
  elapsedMinute: string;
  /** Machine-readable kickoff (ISO) — display strings below derive from it. */
  kickoff: string;
  kickoffTimeFormatted: string;
  kickoffDateFormatted: string;
  /** Relative kickoff label ("Today at 7:30 PM" / "Tomorrow at 1:00 AM"). */
  kickoffLabel: string;
};

/** Loose structural types — assignable from both raw BetsAPI and the sync'd DB. */
export type RawBetsApiMatch = {
  id?: string | number;
  time?: number | string; // unix seconds
  time_status?: string | number; // "0" | "1" | "3"
  league?: { name?: string };
  home?: { name?: string };
  away?: { name?: string };
  ss?: string | null; // final score "5-0"
  timer?: { tm?: string | number } | string | null;
};

type OddsLegLike = { id?: string; odds?: string; name?: string | null; header?: string | null; handicap?: string | null };
type MarketMap = Record<string, { id?: string; name?: string; odds?: OddsLegLike[] }>;
export type PrematchLike = {
  main?: { sp?: MarketMap };
  others?: { sp?: MarketMap }[];
};

export type ViewMarket = {
  key: string;
  name: string;
  outcomes: { name: string; label?: string; odds: number }[];
};

/** A transformed match with merged prematch markets (the proxy/feed payload). */
export type BetsApiMatchView = MatchView & { markets: ViewMarket[] };

/**
 * Card/feed shape (structural twin of MatchFeed's FeedGame — kept pure so the
 * client can import it without pulling server modules).
 */
export type ApiFeedGame = {
  id: string;
  isApiMatch?: boolean;
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
  startAt: Date;
  status: string;
  homeScore: number;
  awayScore: number;
  period: string | null;
  clock: string | null;
  live: boolean;
  featured: boolean;
  sport: { name: string; slug: string; icon: string | null };
  competitionName: string | null;
  markets: {
    id: string;
    name: string;
    key: string;
    status: string;
    outcomes: { id: string; name: string; label: string | null; odds: unknown; status: string }[];
  }[];
};

/**
 * Adapt a transformed BetsAPI match into the card/feed shape the UI renders.
 * Synthetic ids (matchId-marketKey-outcomeName) keep betslip selections
 * unique without DB rows; `isApiMatch` hides DB-only links (fixture pages).
 */
export function apiMatchToFeedGame(view: BetsApiMatchView): ApiFeedGame {
  const [hs, as] = view.score.split("-").map((n) => Number(n.trim()));
  const status: ApiFeedGame["status"] =
    view.timeStatus === "1"
      ? "LIVE"
      : view.timeStatus === "3"
        ? "FINISHED"
        : view.timeStatus === "4" // suspended / postponed — sorted to the bottom
          ? "POSTPONED"
          : "SCHEDULED";
  const startAt = new Date(view.kickoff);
  return {
    id: view.id,
    isApiMatch: true,
    homeName: view.homeTeam,
    awayName: view.awayTeam,
    homeLogo: null,
    awayLogo: null,
    startAt,
    status,
    homeScore: Number.isFinite(hs) ? hs : 0,
    awayScore: Number.isFinite(as) ? as : 0,
    period: null,
    clock: view.elapsedMinute || null,
    live: view.isLive,
    featured: false,
    sport: { name: "Football", slug: "football", icon: "⚽" },
    competitionName: view.leagueName,
    markets: view.markets.map((m) => ({
      id: `${view.id}-${m.key}`,
      name: m.name,
      key: m.key,
      status: "OPEN",
      outcomes: m.outcomes.map((o) => ({
        id: `${view.id}-${m.key}-${o.name}`,
        name: o.name,
        label: o.label ?? null,
        odds: o.odds,
        status: o.odds > 1 ? "ACTIVE" : "CLOSED",
      })),
    })),
  };
}

/**
 * Serializer for RAW BetsAPI objects — the exact transformation spec:
 * status string-vs-int guarded, safe league/team extraction, unix→Date, and
 * formatted kickoff date/time strings for the card UI.
 */
export function transformBetsApiMatch(rawMatch: RawBetsApiMatch): MatchView {
  // Guard string vs integer comparison for status ("0" = Pre-Match, "1" = In-Play/Live)
  const isLive = String(rawMatch.time_status) === "1";

  // Safely extract league & team names
  const leagueName = rawMatch.league?.name || "Football";
  const homeTeam = rawMatch.home?.name || "Home";
  const awayTeam = rawMatch.away?.name || "Away";

  // Convert 10-digit Unix timestamp (seconds) to JS Date Object
  const kickoffDate = rawMatch.time ? new Date(Number(rawMatch.time) * 1000) : new Date();

  // timer may be an object ({tm}) in the parsed v3 format or a string in raw feeds
  const timer = rawMatch.timer;
  const elapsedMinute =
    typeof timer === "string" ? timer : timer?.tm ? `${timer.tm}'` : "";

  return {
    id: String(rawMatch.id),
    isLive,
    timeStatus: String(rawMatch.time_status),
    leagueName,
    homeTeam,
    awayTeam,
    score: rawMatch.ss || "0-0",
    elapsedMinute,
    kickoff: kickoffDate.toISOString(),
    kickoffTimeFormatted: kickoffDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    kickoffDateFormatted: kickoffDate.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }),
    kickoffLabel: formatKickoff(kickoffDate),
  };
}

/** Same view contract from a DB Game row (the synced feed). */
export function toMatchView(game: {
  id: string;
  status: string;
  live?: boolean;
  competitionName?: string | null;
  sport?: { name?: string } | null;
  homeName: string;
  awayName: string;
  startAt: Date | string;
  homeScore?: number;
  awayScore?: number;
  clock?: string | null;
}): MatchView {
  const isLive = ["LIVE", "HALF_TIME", "IN_PLAY"].includes(game.status) || !!game.live;
  const finished = game.status === "FINISHED";
  const d = new Date(game.startAt);
  const clock = game.clock ?? "";
  const minuteMatch = clock.match(/^(\d{1,2}):\d{2}$/);

  return {
    id: game.id,
    isLive,
    timeStatus: game.status,
    leagueName: game.competitionName ?? game.sport?.name ?? "Football",
    homeTeam: game.homeName,
    awayTeam: game.awayName,
    score: isLive || finished ? `${game.homeScore ?? 0}-${game.awayScore ?? 0}` : "0-0",
    elapsedMinute: minuteMatch ? `${minuteMatch[1]}'` : clock.replace(/'$/, ""),
    kickoff: d.toISOString(),
    kickoffTimeFormatted: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    kickoffDateFormatted: d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }),
    kickoffLabel: formatKickoff(d),
  };
}

// ── Prematch market extraction (shared by the sync provider + API proxies) ──

function findMarket(prematch: PrematchLike | null, key: string): MarketMap[string] | null {
  if (!prematch) return null;
  const fromMain = prematch.main?.sp?.[key];
  if (fromMain?.odds?.length) return fromMain;
  for (const other of prematch.others ?? []) {
    const m = other.sp?.[key];
    if (m?.odds?.length) return m;
  }
  return null;
}

const legOdds = (m: MarketMap[string] | null, match: (l: OddsLegLike) => boolean) =>
  m?.odds?.find(match)?.odds;

/**
 * Apply the margin grid to priced legs only; missing legs stay odds 0 so the
 * card renders them as "-" (never feed 0-odds to the margin engine).
 */
function priceOutcomes(
  outcomes: { name: string; label?: string; odds: number }[],
  margin: number,
): { name: string; label?: string; odds: number }[] {
  const present = outcomes.filter((o) => o.odds > 1);
  if (present.length < 2) {
    return outcomes.map((o) => ({ name: o.name, label: o.label, odds: o.odds > 1 ? Math.round(o.odds * 20) / 20 : 0 }));
  }
  const repriced = applyMarginGrid(present, margin);
  let i = 0;
  return outcomes.map((o) =>
    o.odds > 1
      ? { ...repriced[i++], label: o.label } // margin drops label — restore it
      : { name: o.name, label: o.label, odds: 0 },
  );
}

/**
 * Parse the bet365 prematch markets (main.sp / others) into our market model:
 * full_time_result (1X2), double_chance, goals_over_under, both_teams_to_score,
 * draw_no_bet — settle-friendly names, margin applied, "-" placeholders kept.
 */
export function extractOddsMarkets(
  prematch: PrematchLike | null,
  homeName: string,
  awayName: string,
  margin: number,
): ViewMarket[] {
  const num = (v: string | undefined) => {
    const n = Number(v);
    return v != null && isFinite(n) && n > 1 ? n : 0;
  };
  const markets: ViewMarket[] = [];

  // 1X2 — full_time_result odds: name "1" | "Draw" | "2"
  const ftr = findMarket(prematch, "full_time_result");
  const home = num(legOdds(ftr, (l) => l.name === "1" || l.header === "1"));
  const draw = num(legOdds(ftr, (l) => l.name?.toLowerCase() === "draw"));
  const away = num(legOdds(ftr, (l) => l.name === "2" || l.header === "2"));
  if (home > 0 || draw > 0 || away > 0) {
    markets.push({
      key: "MATCH_RESULT",
      name: "Match Result",
      outcomes: priceOutcomes(
        [
          { name: homeName, label: "1", odds: home },
          { name: "Draw", label: "X", odds: draw },
          { name: awayName, label: "2", odds: away },
        ],
        margin,
      ),
    });
  }

  // Double Chance — names like "Fulham or Draw" (1X), "Draw or Arsenal" (X2),
  // "Fulham or Arsenal" (12) → normalize to settle-friendly 1x/12/x2.
  const dc = findMarket(prematch, "double_chance");
  const dcLegs = (dc?.odds ?? []).slice(0, 3);
  const dcPick: Record<string, number> = {};
  for (const l of dcLegs) {
    const n = (l.name ?? "").toLowerCase();
    let key: string | null = null;
    if (n.endsWith("or draw")) key = "1x";
    else if (n.startsWith("draw or")) key = "x2";
    else if (n.includes(" or ")) key = "12";
    if (key) dcPick[key] = num(l.odds);
  }
  if (!Object.keys(dcPick).length && dcLegs.length >= 2) {
    dcPick["1x"] = num(dcLegs[0]?.odds);
    dcPick["x2"] = num(dcLegs[1]?.odds);
    if (dcLegs[2]) dcPick["12"] = num(dcLegs[2]?.odds);
  }
  if (Object.values(dcPick).some((v) => v > 0)) {
    markets.push({
      key: "DOUBLE_CHANCE",
      name: "Double Chance",
      outcomes: priceOutcomes(
        [
          { name: "1x", odds: dcPick["1x"] ?? 0 },
          { name: "12", odds: dcPick["12"] ?? 0 },
          { name: "x2", odds: dcPick["x2"] ?? 0 },
        ],
        margin,
      ),
    });
  }

  // Totals — goals_over_under: { name: line "2.5", header: Over|Under, odds }
  const gou = findMarket(prematch, "goals_over_under");
  let bestLine = -1;
  let bestOver = 0;
  let bestUnder = 0;
  const byLine = new Map<number, { over: number; under: number }>();
  for (const l of gou?.odds ?? []) {
    const line = Number(l.name ?? l.handicap);
    if (!isFinite(line) || line <= 0) continue;
    const bucket = byLine.get(line) ?? { over: 0, under: 0 };
    if ((l.header ?? l.name ?? "").toLowerCase().startsWith("over")) bucket.over = num(l.odds);
    if ((l.header ?? l.name ?? "").toLowerCase().startsWith("under")) bucket.under = num(l.odds);
    byLine.set(line, bucket);
  }
  for (const [line, b] of byLine) {
    if (b.over <= 0 || b.under <= 0) continue;
    if (bestLine < 0 || Math.abs(line - 2.5) < Math.abs(bestLine - 2.5)) {
      bestLine = line;
      bestOver = b.over;
      bestUnder = b.under;
    }
  }
  if (bestLine > 0) {
    markets.push({
      key: "OVER_UNDER",
      name: `Over/Under ${bestLine}`,
      outcomes: priceOutcomes(
        [
          { name: `over ${bestLine}`, odds: bestOver },
          { name: `under ${bestLine}`, odds: bestUnder },
        ],
        margin,
      ),
    });
  }

  // Half-Time Result — standalone `half_time_result` when present, else
  // derived from `half_time_full_time` ("1/1", "X/2"...) by picking the most
  // probable leg (lowest odds) per HT outcome.
  let htHome = 0;
  let htDraw = 0;
  let htAway = 0;
  const htr = findMarket(prematch, "half_time_result");
  if (htr?.odds?.length) {
    htHome = num(legOdds(htr, (l) => l.name === "1" || l.header === "1"));
    htDraw = num(legOdds(htr, (l) => l.name?.toLowerCase() === "draw"));
    htAway = num(legOdds(htr, (l) => l.name === "2" || l.header === "2"));
  } else {
    const htft = findMarket(prematch, "half_time_full_time");
    const htPart = (name: string) => name.split("/")[0]?.trim().toLowerCase();
    const bestFor = (part: string) => {
      let bestOdds = 0;
      for (const l of htft?.odds ?? []) {
        if (htPart(l.name ?? "") === part) {
          const n = num(l.odds);
          if (n > 0 && (bestOdds === 0 || n < bestOdds)) bestOdds = n;
        }
      }
      return bestOdds;
    };
    htHome = bestFor("1");
    htDraw = bestFor("x");
    htAway = bestFor("2");
  }
  if (htHome > 0 || htDraw > 0 || htAway > 0) {
    markets.push({
      key: "HT_RESULT",
      name: "Half-Time Result",
      outcomes: priceOutcomes(
        [
          { name: homeName, label: "1", odds: htHome },
          { name: "Draw", label: "X", odds: htDraw },
          { name: awayName, label: "2", odds: htAway },
        ],
        margin,
      ),
    });
  }

  // Both Teams To Score — Yes/No
  const btts = findMarket(prematch, "both_teams_to_score");
  const btsYes = num(legOdds(btts, (l) => l.name?.toLowerCase() === "yes" || l.header?.toLowerCase() === "yes"));
  const btsNo = num(legOdds(btts, (l) => l.name?.toLowerCase() === "no" || l.header?.toLowerCase() === "no"));
  if (btsYes > 0 || btsNo > 0) {
    markets.push({
      key: "BTTS",
      name: "Both Teams To Score",
      outcomes: priceOutcomes(
        [
          { name: "yes", odds: btsYes },
          { name: "no", odds: btsNo },
        ],
        margin,
      ),
    });
  }

  // Draw No Bet — odds: name "1" | "2"
  const dnb = findMarket(prematch, "draw_no_bet");
  const dnbHome = num(legOdds(dnb, (l) => l.name === "1" || l.header === "1"));
  const dnbAway = num(legOdds(dnb, (l) => l.name === "2" || l.header === "2"));
  if (dnbHome > 0 || dnbAway > 0) {
    markets.push({
      key: "DRAW_NO_BET",
      name: "Draw No Bet",
      outcomes: priceOutcomes(
        [
          { name: homeName, label: "1", odds: dnbHome },
          { name: awayName, label: "2", odds: dnbAway },
        ],
        margin,
      ),
    });
  }

  return markets;
}
