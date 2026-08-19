"use client";

import { useEffect, useMemo, useState } from "react";
import MatchCard from "@/components/MatchCard";
import { IconChevronDown } from "@/components/icons";
import { leagueRank } from "@/lib/league-rank";
import { buildDateOptions, dayWindow } from "@/lib/feed-dates";
import { flagForLeague } from "@/lib/league-flags";
import { isLiveStatus } from "@/lib/game-status";
import { apiMatchToFeedGame, type ApiFeedGame, type BetsApiMatchView } from "@/lib/providers/betsapi-transformer";

type FeedGame = ApiFeedGame;

export type { FeedGame };

/** Module-level client cache: date/league switches never refetch once loaded. */
const feedCache = new Map<string, ApiFeedGame[]>();

type SortMode = "soonest" | "top";

const MARKET_FILTERS = [
  { id: "1x2", label: "1x2 / Winner", keys: ["h2h", "MATCH_RESULT", "DRAW_NO_BET"] },
  { id: "double_chance", label: "Double Chance", keys: ["DOUBLE_CHANCE"] },
  { id: "btts", label: "Both Teams", keys: ["BTTS"] },
] as const;
type MarketFilter = (typeof MARKET_FILTERS)[number]["id"];

/** Compact dropdown pill (date selector / league selector). */
function Dropdown({
  label,
  sublabel,
  active,
  options,
  onSelect,
}: {
  label: string;
  sublabel?: string;
  active: boolean;
  options: { value: string; label: string; sublabel?: string }[];
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
          active
            ? "bg-brand text-[#052e16]"
            : "bg-white/5 text-ink2 hover:bg-white/10 hover:text-ink"
        }`}
      >
        <span className="max-w-36 truncate">{label}</span>
        {sublabel && <span className="shrink-0 text-[10px] opacity-70">{sublabel}</span>}
        <IconChevronDown className="h-3 w-3 shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl border border-line bg-card p-1 shadow-2xl">
            {options.map((o) => (
              <button
                key={o.value}
                onClick={() => {
                  onSelect(o.value);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-ink2 hover:bg-white/5 hover:text-ink"
              >
                <span className="truncate">{o.label}</span>
                {o.sublabel && <span className="shrink-0 text-[10px] text-ink3">{o.sublabel}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Match feed — pre-match only, chronological (soonest first).
 *
 * Filters chain reactively in client state (date → league → market) with zero
 * reloads: the full upcoming schedule is held client-side, so switching is
 * instant. Live matches are NEVER rendered here — they belong on /live.
 *
 * Props:
 *  - games: server-provided schedule (home SSR / DB fallback). When empty,
 *    the feed auto-fetches GET /api/betsapi/matches and caches it per sport.
 */
export default function MatchFeed({
  games,
  sportKey = "football",
  autoFetch = true,
}: {
  games: FeedGame[];
  sportKey?: string;
  autoFetch?: boolean;
}) {
  // Client-side schedule (auto-fetched + cached when no server data).
  const [clientGames, setClientGames] = useState<FeedGame[] | null>(null);
  const [feedError, setFeedError] = useState(false);
  useEffect(() => {
    if (games.length > 0 || !autoFetch) return;
    let alive = true;
    const load = async () => {
      const cached = feedCache.get(sportKey);
      if (cached) {
        if (alive) setClientGames(cached);
        return;
      }
      try {
        const res = await fetch("/api/betsapi/matches");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { matches?: BetsApiMatchView[] } = await res.json();
        const mapped: FeedGame[] = (data.matches ?? []).map(apiMatchToFeedGame);
        feedCache.set(sportKey, mapped);
        if (alive) setClientGames(mapped);
      } catch {
        if (alive) setFeedError(true);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [games, sportKey, autoFetch]);
  const feed = clientGames ?? games;

  // Rolling 7-day date selector — default lands on "Today".
  const dateOptions = useMemo(() => buildDateOptions(), []);
  const [dateValue, setDateValue] = useState<string>(() => dateOptions[0].value);
  const activeDate = dateOptions.find((o) => o.value === dateValue) ?? dateOptions[0];

  const [league, setLeague] = useState<string>(""); // "" = All Leagues
  const [sortMode, setSortMode] = useState<SortMode>("soonest");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("1x2");

  /** Distinct competitions from the loaded feed, top leagues first. */
  const leagueOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const g of feed) {
      if (g.competitionName) set.set(g.competitionName, g.competitionName);
    }
    return [...set.values()]
      .sort((a, b) => leagueRank(a) - leagueRank(b) || a.localeCompare(b))
      .slice(0, 30);
  }, [feed]);

  /** Active pre-match fixtures for the selected calendar day + league. */
  const filtered = useMemo(() => {
    const { from, to } = dayWindow(dateValue);
    // Pre-match only, chronological ascending — live matches stay on /live.
    const list = feed
      .filter((g) => !isLiveStatus(g.status, g.live))
      .filter((g) => {
        const t = new Date(g.startAt).getTime();
        return Number.isFinite(t) && t >= from && t < to;
      })
      .filter((g) => !league || g.competitionName === league);

    return [...list].sort((a, b) => {
      if (sortMode === "top") {
        const rankDelta = leagueRank(a.competitionName) - leagueRank(b.competitionName);
        if (rankDelta !== 0) return rankDelta;
      }
      // Strict ascending kickoff: 6:00 PM above 7:00 PM above 7:30 PM.
      return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    });
  }, [feed, dateValue, league, sortMode]);

  const marketKeys = [...(MARKET_FILTERS.find((m) => m.id === marketFilter)!.keys)];

  return (
    <section className="mt-4">
      {/* Filter bar: Date selector | Leagues selector | sort + count */}
      <div className="no-scrollbar -mx-4 flex items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Dropdown
          label={activeDate.label}
          sublabel={activeDate.dateLabel}
          active={true}
          options={dateOptions.map((o) => ({ value: o.value, label: o.label, sublabel: o.dateLabel }))}
          onSelect={setDateValue}
        />
        <Dropdown
          label={league ? `${flagForLeague(league)} ${league}` : "Leagues ⌄"}
          active={!!league}
          options={[
            { value: "", label: "All Leagues" },
            ...leagueOptions.map((l) => ({ value: l, label: `${flagForLeague(l)} ${l}` })),
          ]}
          onSelect={setLeague}
        />

        <span className="ml-auto flex shrink-0 items-center gap-1">
          <span className="hidden rounded-full bg-white/5 p-0.5 sm:flex">
            <button
              onClick={() => setSortMode("soonest")}
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
                sortMode === "soonest" ? "bg-brand text-[#052e16]" : "text-ink3 hover:text-ink"
              }`}
            >
              Soonest
            </button>
            <button
              onClick={() => setSortMode("top")}
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
                sortMode === "top" ? "bg-brand text-[#052e16]" : "text-ink3 hover:text-ink"
              }`}
            >
              Top Leagues
            </button>
          </span>
          <span className="hidden text-[11px] font-semibold text-ink3 md:block">{filtered.length} matches</span>
        </span>
      </div>

      {/* Market filter selectors */}
      <div className="no-scrollbar -mx-4 mt-2 flex items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {MARKET_FILTERS.map((m) => (
          <button
            key={m.id}
            onClick={() => setMarketFilter(m.id)}
            className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors ${
              marketFilter === m.id
                ? "border-brand/60 bg-brand/10 text-brand"
                : "border-line text-ink2 hover:border-line2 hover:text-ink"
            }`}
          >
            {m.label}
          </button>
        ))}
        {/* Mobile sort toggle */}
        <span className="ml-auto flex rounded-full bg-white/5 p-0.5 sm:hidden">
          <button
            onClick={() => setSortMode("soonest")}
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${sortMode === "soonest" ? "bg-brand text-[#052e16]" : "text-ink3"}`}
          >
            Soonest
          </button>
          <button
            onClick={() => setSortMode("top")}
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${sortMode === "top" ? "bg-brand text-[#052e16]" : "text-ink3"}`}
          >
            Top Leagues
          </button>
        </span>
      </div>

      {/* Match list */}
      <div className="mt-3 space-y-3">
        {feedError ? (
          <div className="card p-10 text-center text-sm text-ink3">
            Live feed unavailable right now — check the API key in Admin → API Settings.
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-10 text-center text-sm text-ink3">
            No matches on {activeDate.label} {activeDate.dateLabel}
            {league ? ` in ${league}` : ""} — try another date or league.
          </div>
        ) : (
          filtered.map((g) => <MatchCard key={g.id} game={g} preferMarkets={marketKeys} />)
        )}
      </div>
    </section>
  );
}
