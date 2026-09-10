"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import MatchCard from "@/components/MatchCard";
import { SportIcon } from "@/components/SportIcon";
import { IconTv } from "@/components/icons";
import { hasBettableMarkets, isLiveStatus } from "@/lib/game-status";

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

/**
 * Live feed — in-play matches ONLY (the /live route).
 *
 * The pre-match scheduling views (Today / Tomorrow / Upcoming) live on the
 * home feed; here every card is a game in progress with a ticking clock.
 * Scores and timers auto-refresh every `refreshSeconds` via router.refresh()
 * (no reload, client state like the ticking clocks is preserved); the server
 * page also pulls fresh scores from The Odds API /scores on each poll (throttled).
 */
export default function LiveFeed({
  games,
  refreshSeconds = 60,
  fallback,
}: {
  games: FeedGame[];
  /** Auto-refresh interval in seconds (admin setting live.refreshSeconds). */
  refreshSeconds?: number;
  /** Pre-match kickoffs to show INSTEAD of the dead empty card when nothing
   *  is live (the /live page feeds it today's next games, so the page is
   *  never a dead end — same philosophy as the sport-feed fallback). */
  fallback?: FeedGame[];
}) {
  const router = useRouter();

  // Real-time feel: silently re-run the server page so DB scores/timers stay
  // fresh without a manual reload.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), Math.max(5, refreshSeconds) * 1000);
    return () => clearInterval(t);
  }, [router, refreshSeconds]);

  // Defensive client-side twin of liveFeedWhere(): never render a row without
  // a bettable market (those cards showed "Market Suspended / +0 Markets").
  const live = useMemo(
    () =>
      [...games]
        .filter((g) => isLiveStatus(g.status) && hasBettableMarkets(g.markets))
        .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [games],
  );

  // Sport category filter — pills built from the sports actually present in
  // the live set (plus the upcoming fallback so a pill never filters to a
  // dead end). Selections are client-side; the auto-refresh preserves them.
  const [sport, setSport] = useState<string>("all");
  const sportOptions = useMemo(() => {
    const seen = new Map<string, { name: string; icon: string | null }>();
    for (const g of [...live, ...(fallback ?? [])]) {
      if (!seen.has(g.sport.slug)) seen.set(g.sport.slug, { name: g.sport.name, icon: g.sport.icon });
    }
    return Array.from(seen.entries());
  }, [live, fallback]);

  const bySport = (list: FeedGame[]) =>
    sport === "all" ? list : list.filter((g) => g.sport.slug === sport);
  const liveShown = bySport(live);
  const fallbackShown = sport === "all" ? (fallback ?? []) : bySport(fallback ?? []);

  /** 36px-tall pills (mobile-friendly tap target) with press feedback. */
  const pill = (active: boolean) =>
    `flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 ${
      active
        ? "bg-brand text-[#052e16]"
        : "border border-line bg-card2 text-ink2 hover:border-brand/40 hover:text-ink"
    }`;

  return (
    <>
      {sportOptions.length > 1 && (
        <div className="no-scrollbar -mx-4 mt-4 flex w-full max-w-full snap-x items-center gap-1.5 overflow-x-auto overscroll-x-contain px-4 pb-1 sm:mx-0 sm:px-0" aria-label="Filter live games by sport">
          <button type="button" onClick={() => setSport("all")} className={pill(sport === "all")}>
            All Sports
          </button>
          {sportOptions.map(([slug, sp]) => (
            <button type="button" key={slug} onClick={() => setSport(slug)} className={pill(sport === slug)}>
              <SportIcon slug={slug} icon={sp.icon} className="h-3.5 w-3.5" />
              {sp.name}
            </button>
          ))}
        </div>
      )}

      <div className="relative flex w-full max-w-full items-center gap-2 text-[11px] font-semibold text-ink3">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
        Live — updates automatically every {refreshSeconds}s
      </div>

      <div className="mt-4 w-full max-w-full overflow-x-hidden">
        {liveShown.length === 0 ? (
          // A sport filter that yields nothing must SAY so (and offer a way
          // back) — a silent dead tap reads as "the page is broken".
          sport !== "all" ? (
            <div className="card p-6 text-center sm:p-8">
              <p className="text-sm font-semibold">
                No {sportOptions.find(([slug]) => slug === sport)?.[1].name ?? sport} matches live right now
              </p>
              <button
                type="button"
                onClick={() => setSport("all")}
                className="btn btn-ghost mt-3 min-h-11 w-full px-4 text-sm font-bold text-brand sm:w-auto"
              >
                Show all sports
              </button>
            </div>
          ) : fallbackShown.length > 0 ? (
            <div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-ink3">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
                No live matches right now — these kick off soon
              </div>
              <div className="mt-3 grid gap-4 [&>*]:min-w-0 md:grid-cols-2 lg:grid-cols-3">
                {fallbackShown.map((g) => (
                  <MatchCard key={g.id} game={g} />
                ))}
              </div>
              <Link
                href="/"
                className="mt-3 flex min-h-11 w-full items-center justify-center gap-1 rounded-xl border border-line bg-card2 px-4 text-sm font-bold text-brand transition-colors hover:border-brand/40 hover:bg-card active:scale-[0.99] sm:mt-3 sm:min-h-0 sm:w-auto sm:justify-start sm:rounded-none sm:border-0 sm:bg-transparent sm:px-0 sm:text-xs sm:hover:bg-transparent sm:hover:underline"
              >
                View all matches →
              </Link>
            </div>
          ) : (
            <div className="card p-8 text-center sm:p-12">
              <IconTv className="mx-auto h-10 w-10 text-ink3" />
              <p className="mt-3 font-semibold">No live matches right now</p>
              <p className="mt-1 text-sm text-ink3">
                Check back soon — in-play games appear here in real time.
              </p>
            </div>
          )
        ) : (
          <div className="grid gap-4 [&>*]:min-w-0 md:grid-cols-2 lg:grid-cols-3">
            {liveShown.map((g) => (
              <MatchCard key={g.id} game={g} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
