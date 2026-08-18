"use client";

import { useMemo, useState } from "react";
import MatchCard from "@/components/MatchCard";
import { IconChevronDown } from "@/components/icons";
import { leagueRank } from "@/lib/league-rank";

type FeedGame = {
  id: string;
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

type TimeFilter = "highlights" | "upcoming" | "today" | "tomorrow";
type SortMode = "soonest" | "top";

const MARKET_FILTERS = [
  { id: "1x2", label: "1x2 / Winner", keys: ["h2h", "MATCH_RESULT", "DRAW_NO_BET"] },
  { id: "double_chance", label: "Double Chance", keys: ["DOUBLE_CHANCE"] },
  { id: "btts", label: "Both Teams", keys: ["BTTS"] },
] as const;
type MarketFilter = (typeof MARKET_FILTERS)[number]["id"];

/** Compact dropdown pill used for the date selector and league selector. */
function Dropdown({
  label,
  active,
  options,
  onSelect,
}: {
  label: string;
  active: boolean;
  options: { value: string; label: string }[];
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
          active
            ? "bg-brand text-[#052e16]"
            : "bg-white/5 text-ink2 hover:bg-white/10 hover:text-ink"
        }`}
      >
        <span className="max-w-36 truncate">{label}</span>
        <IconChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-56 overflow-y-auto rounded-xl border border-line bg-card p-1 shadow-2xl">
            {options.map((o) => (
              <button
                key={o.value}
                onClick={() => {
                  onSelect(o.value);
                  setOpen(false);
                }}
                className="block w-full truncate rounded-lg px-3 py-2 text-left text-xs font-semibold text-ink2 hover:bg-white/5 hover:text-ink"
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function MatchFeed({ games }: { games: FeedGame[] }) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("highlights");
  const [dayFilter, setDayFilter] = useState<"today" | "tomorrow">("today");
  const [league, setLeague] = useState<string>("");
  const [sortMode, setSortMode] = useState<SortMode>("soonest");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("1x2");

  /** Distinct competitions from the loaded feed, top leagues first. */
  const leagueOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const g of games) {
      if (g.competitionName) set.set(g.competitionName, g.competitionName);
    }
    return [...set.values()]
      .sort((a, b) => leagueRank(a) - leagueRank(b) || a.localeCompare(b))
      .slice(0, 30);
  }, [games]);

  const filtered = useMemo(() => {
    const now = new Date();
    const day = (offset: number) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      return { from: d.getTime(), to: d.getTime() + 86400_000 };
    };
    const sameDay = (t: number, offset: number) => t >= day(offset).from && t < day(offset).to;

    let list = games;
    if (timeFilter === "highlights") list = list.filter((g) => g.live || g.featured || g.status === "LIVE");
    if (timeFilter === "today") list = list.filter((g) => sameDay(new Date(g.startAt).getTime(), 0));
    if (timeFilter === "tomorrow") list = list.filter((g) => sameDay(new Date(g.startAt).getTime(), 1));
    if (timeFilter === "upcoming") list = list.filter((g) => new Date(g.startAt).getTime() >= day(2).from);
    if (league) list = list.filter((g) => g.competitionName === league);

    return [...list].sort((a, b) => {
      const liveDelta = Number(b.live) - Number(a.live);
      if (liveDelta !== 0) return liveDelta;
      if (sortMode === "top") {
        const rankDelta = leagueRank(a.competitionName) - leagueRank(b.competitionName);
        if (rankDelta !== 0) return rankDelta;
      }
      return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    });
  }, [games, timeFilter, league, sortMode]);

  const marketKeys = [...(MARKET_FILTERS.find((m) => m.id === marketFilter)!.keys)];

  const dayLabel = dayFilter === "tomorrow" ? "Tomorrow ⌄" : "Today ⌄";

  return (
    <section className="mt-4">
      {/* Navigation bar: Highlights | Upcoming | Today ⌄ | Leagues ⌄ */}
      <div className="no-scrollbar -mx-4 flex items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <button
          onClick={() => setTimeFilter("highlights")}
          className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${
            timeFilter === "highlights"
              ? "bg-brand text-[#052e16]"
              : "bg-white/5 text-ink2 hover:bg-white/10 hover:text-ink"
          }`}
        >
          Highlights
        </button>
        <button
          onClick={() => setTimeFilter("upcoming")}
          className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${
            timeFilter === "upcoming"
              ? "bg-brand text-[#052e16]"
              : "bg-white/5 text-ink2 hover:bg-white/10 hover:text-ink"
          }`}
        >
          Upcoming
        </button>
        <Dropdown
          label={dayLabel}
          active={timeFilter === "today" || timeFilter === "tomorrow"}
          options={[
            { value: "today", label: "Today" },
            { value: "tomorrow", label: "Tomorrow" },
          ]}
          onSelect={(v) => {
            setDayFilter(v as "today" | "tomorrow");
            setTimeFilter(v as TimeFilter);
          }}
        />
        <Dropdown
          label={league ? league : "Leagues ⌄"}
          active={!!league}
          options={[{ value: "", label: "All Leagues" }, ...leagueOptions.map((l) => ({ value: l, label: l }))]}
          onSelect={setLeague}
        />

        {/* Sort toggle + count */}
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
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors ${
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
        {filtered.length === 0 ? (
          <div className="card p-10 text-center text-sm text-ink3">
            No matches for this selection — try another tab or league.
          </div>
        ) : (
          filtered.map((g) => <MatchCard key={g.id} game={g} preferMarkets={marketKeys} />)
        )}
      </div>
    </section>
  );
}
