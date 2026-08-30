/**
 * Standard match → UI data transformation layer (provider-neutral).
 *
 * ONE view contract (`MatchView`) feeds every match card / live card:
 *   - toMatchView(game)          — DB Game rows (the synced feed)
 *   - apiGameToMatchView(game)   — ApiGame objects (provider → feed payload)
 *
 * Cards consume `MatchView` only, so provider proxies and the synced DB
 * render through identical logic. BetsAPI-specific serializers were removed
 * with the BetsAPI deprecation; The Odds API (v4) is the single provider.
 */
import { formatKickoff } from "./kickoff";
import { LEAGUE_TITLES } from "./feed";

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

export type ViewMarket = {
  key: string;
  name: string;
  outcomes: { name: string; label?: string; odds: number }[];
};

/** A transformed match with merged markets (the proxy/feed payload). */
export type FeedMatchView = MatchView & { markets: ViewMarket[] };

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
 * Adapt a transformed match into the card/feed shape the UI renders.
 * Synthetic ids (matchId-marketKey-outcomeName) keep betslip selections
 * unique without DB rows; `isApiMatch` hides DB-only links (fixture pages).
 */
export function apiMatchToFeedGame(view: FeedMatchView): ApiFeedGame {
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

/** Normalize an elapsed-time string to the display format "87:42'" (seconds
 *  kept — the live clock ticks from it). Handles "87:42", "87:42'", "87". */
export function normalizeElapsed(clock: string): string {
  const c = clock.trim();
  if (/^\d{1,2}:\d{2}$/.test(c)) return `${c}'`;
  if (/^\d{1,2}:\d{2}'$/.test(c)) return c;
  if (/^\d+$/.test(c)) return `${c}'`;
  if (/^\d+'$/.test(c)) return c;
  return c;
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

  return {
    id: game.id,
    isLive,
    timeStatus: game.status,
    leagueName: game.competitionName ?? game.sport?.name ?? "Football",
    homeTeam: game.homeName,
    awayTeam: game.awayName,
    score: isLive || finished ? `${game.homeScore ?? 0}-${game.awayScore ?? 0}` : "0-0",
    // Keep the seconds — the live card ticks "87:42'" forward.
    elapsedMinute: normalizeElapsed(clock),
    kickoff: d.toISOString(),
    kickoffTimeFormatted: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    kickoffDateFormatted: d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }),
    kickoffLabel: formatKickoff(d),
  };
}

/** Adapt an ApiGame (provider payload) into the standard MatchView contract. */
export function apiGameToMatchView(g: {
  externalId: string;
  sportKey: string;
  competitionName?: string;
  homeName: string;
  awayName: string;
  startAt: Date;
  markets: ViewMarket[];
}): FeedMatchView {
  const d = g.startAt;
  return {
    id: g.externalId,
    isLive: false,
    timeStatus: "0",
    leagueName: g.competitionName ?? LEAGUE_TITLES[g.sportKey] ?? "Football",
    homeTeam: g.homeName,
    awayTeam: g.awayName,
    score: "0-0",
    elapsedMinute: "",
    kickoff: d.toISOString(),
    kickoffTimeFormatted: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    kickoffDateFormatted: d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }),
    kickoffLabel: formatKickoff(d),
    markets: g.markets.map((m) => ({
      key: m.key,
      name: m.name,
      outcomes: m.outcomes.map((o) => ({ name: o.name, label: o.label, odds: o.odds })),
    })),
  };
}
