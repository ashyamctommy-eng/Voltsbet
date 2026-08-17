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

const TABS = [
  { id: "live", label: "Live" },
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "upcoming", label: "Upcoming" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default function LiveFeed({ games }: { games: FeedGame[] }) {
  const [tab, setTab] = useState<Tab>("live");

  const filtered = useMemo(() => {
    const now = new Date();
    const day = (offset: number) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      return { from: d.getTime(), to: d.getTime() + 86400_000 };
    };
    const sameDay = (t: number, offset: number) => t >= day(offset).from && t < day(offset).to;

    let list = games;
    if (tab === "live") list = list.filter((g) => g.status === "LIVE" || g.status === "HALF_TIME");
    if (tab === "today") list = list.filter((g) => sameDay(new Date(g.startAt).getTime(), 0));
    if (tab === "tomorrow") list = list.filter((g) => sameDay(new Date(g.startAt).getTime(), 1));
    if (tab === "upcoming") list = list.filter((g) => new Date(g.startAt).getTime() >= day(2).from);

    return [...list].sort(
      (a, b) => Number(b.live) - Number(a.live) || new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );
  }, [games, tab]);

  return (
    <>
      {/* Date / status tabs */}
      <div className="no-scrollbar -mx-4 flex items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${
              tab === t.id ? "bg-brand text-[#052e16]" : "bg-white/5 text-ink2 hover:bg-white/10 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto hidden shrink-0 text-[11px] font-semibold text-ink3 sm:block">{filtered.length} matches</span>
      </div>

      <div className="mt-6">
        {filtered.length === 0 ? (
          <div className="card p-12 text-center">
            <div className="text-4xl">{tab === "live" ? "📺" : "🗓️"}</div>
            <p className="mt-3 font-semibold">No {tab} events</p>
            <p className="mt-1 text-sm text-ink3">
              {tab === "live" ? "Check another tab — upcoming and today's matches are listed here." : "Try another day tab — matches appear as soon as they're scheduled."}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {filtered.map((g) => (
              <MatchCard key={g.id} game={g} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
