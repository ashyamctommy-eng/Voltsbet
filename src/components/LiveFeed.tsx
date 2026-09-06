"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import MatchCard from "@/components/MatchCard";
import { SportIcon } from "@/components/SportIcon";
import { IconTv } from "@/components/icons";
import { isLiveStatus } from "@/lib/game-status";

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

  const live = useMemo(
    () =>
      [...games]
        .filter((g) => isLiveStatus(g.status, g.live))
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

  const pill = (active: boolean) =>
    `flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
      active
        ? "bg-brand text-[#052e16]"
        : "border border-line bg-card2 text-ink2 hover:border-brand/40 hover:text-ink"
    }`;

  return (
    <>
      {sportOptions.length > 1 && (
        <div className="no-scrollbar -mx-4 mt-4 flex w-full max-w-full items-center gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:px-0">
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

      <div className="relative z-40 flex w-full max-w-full items-center gap-2 text-[11px] font-semibold text-ink3">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
        Live — updates automatically every {refreshSeconds}s
      </div>

      <div className="mt-4 w-full max-w-full overflow-x-hidden">
        {liveShown.length === 0 ? (
          fallbackShown.length > 0 ? (
            <div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-ink3">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
                No live matches right now — these kick off soon
              </div>
              <div className="mt-3 grid gap-4 [&>*]:min-w-0 md:grid-cols-2 2xl:grid-cols-3">
                {fallbackShown.map((g) => (
                  <MatchCard key={g.id} game={g} />
                ))}
              </div>
              <Link href="/" className="mt-3 inline-block text-xs font-bold text-brand hover:underline">
                View all matches →
              </Link>
            </div>
          ) : (
            <div className="card p-12 text-center">
              <IconTv className="mx-auto h-10 w-10 text-ink3" />
              <p className="mt-3 font-semibold">No live matches right now</p>
              <p className="mt-1 text-sm text-ink3">
                Check back soon — in-play games appear here in real time.
              </p>
            </div>
          )
        ) : (
          <div className="grid gap-4 [&>*]:min-w-0 md:grid-cols-2 2xl:grid-cols-3">
            {liveShown.map((g) => (
              <MatchCard key={g.id} game={g} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
