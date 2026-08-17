"use client";

import { useMemo, useState } from "react";
import MatchCard from "@/components/MatchCard";

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

const TIME_TABS = [
  { id: "highlights", label: "Highlights" },
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "upcoming", label: "Upcoming" },
] as const;

const MARKET_FILTERS = [
  { id: "1x2", label: "1x2 / Winner", keys: ["h2h", "MATCH_RESULT", "DRAW_NO_BET"] },
  { id: "double_chance", label: "Double Chance", keys: ["DOUBLE_CHANCE"] },
  { id: "btts", label: "Both Teams", keys: ["BTTS"] },
] as const;

type TimeFilter = (typeof TIME_TABS)[number]["id"];
type MarketFilter = (typeof MARKET_FILTERS)[number]["id"];

export default function MatchFeed({ games }: { games: FeedGame[] }) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("highlights");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("1x2");

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

    return [...list].sort((a, b) =>
      Number(b.live) - Number(a.live) || new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );
  }, [games, timeFilter]);

  const marketKeys = [...(MARKET_FILTERS.find((m) => m.id === marketFilter)!.keys)];

  return (
    <section className="mt-4">
      {/* Time filter tabs */}
      <div className="no-scrollbar -mx-4 flex items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {TIME_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTimeFilter(t.id)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${
              timeFilter === t.id
                ? "bg-brand text-[#052e16]"
                : "bg-white/5 text-ink2 hover:bg-white/10 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto hidden shrink-0 text-[11px] font-semibold text-ink3 sm:block">
          {filtered.length} matches
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
      </div>

      {/* Match list */}
      <div className="mt-3 space-y-3">
        {filtered.length === 0 ? (
          <div className="card p-10 text-center text-sm text-ink3">
            No {timeFilter} matches with this market filter — check another tab.
          </div>
        ) : (
          filtered.map((g) => <MatchCard key={g.id} game={g} preferMarkets={marketKeys} />)
        )}
      </div>
    </section>
  );
}
