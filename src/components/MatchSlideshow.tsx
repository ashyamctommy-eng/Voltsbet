"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import TeamLogo from "@/components/TeamLogo";
import { formatDateTime } from "@/lib/odds";

type SlideGame = {
  id: string;
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
  startAt: Date;
  status: string;
  homeScore: number;
  awayScore: number;
  clock: string | null;
  live: boolean;
  sport: { name: string; slug: string; icon: string | null };
  competitionName: string | null;
  markets: {
    key: string;
    status: string;
    outcomes: { name: string; label: string | null; odds: unknown; status: string }[];
  }[];
};

const INTERVAL_MS = 5000;

/** Auto-rotating slideshow of live + upcoming matches (replaces casino hero). */
export default function MatchSlideshow({ games }: { games: SlideGame[] }) {
  const slides = useMemo(() => {
    const now = new Date();
    const live = games.filter((g) => g.live || g.status === "LIVE");
    const upcoming = games
      .filter((g) => !g.live && g.status !== "LIVE" && new Date(g.startAt) > now)
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    return [...live, ...upcoming].slice(0, 8);
  }, [games]);

  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % slides.length), INTERVAL_MS);
    return () => clearInterval(t);
  }, [slides.length]);

  useEffect(() => {
    setIdx(0);
  }, [slides.length]);

  if (slides.length === 0) return null;

  const g = slides[idx];

  return (
    <section className="mt-4" aria-label="Featured matches">
      <Link
        href={`/match/${g.id}`}
        className="card card-hover relative block overflow-hidden !border-brand/20"
      >
        <div className="pointer-events-none absolute -right-12 -top-14 h-44 w-44 rounded-full bg-brand/10 blur-2xl" />

        <div className="relative p-4">
          {/* Top row: league + status */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-semibold text-ink3">
              {g.competitionName ?? g.sport.name}
            </span>
            {g.live || g.status === "LIVE" ? (
              <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 font-bold text-red-400">
                <span className="live-dot" /> LIVE {g.clock ? `· ${g.clock}` : ""}
              </span>
            ) : (
              <span className="shrink-0 font-semibold text-ink3">{formatDateTime(g.startAt)}</span>
            )}
          </div>

          {/* Teams */}
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
              <TeamLogo name={g.homeName} src={g.homeLogo} className="h-10 w-10" />
              <span className="line-clamp-1 w-full text-xs font-bold sm:text-sm">{g.homeName}</span>
            </div>

            <div className="shrink-0 px-1 text-center">
              {g.live || g.status === "LIVE" || g.status === "FINISHED" ? (
                <span className="text-xl font-extrabold tabular-nums">
                  {g.homeScore} <span className="text-ink3">–</span> {g.awayScore}
                </span>
              ) : (
                <span className="text-base font-black tracking-widest text-brand">VS</span>
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
              <TeamLogo name={g.awayName} src={g.awayLogo} className="h-10 w-10" />
              <span className="line-clamp-1 w-full text-xs font-bold sm:text-sm">{g.awayName}</span>
            </div>
          </div>

          {/* Quick odds strip */}
          {(() => {
            const m = g.markets.find(
              (mk) => mk.status === "OPEN" && (mk.key === "h2h" || mk.key === "MATCH_RESULT") && mk.outcomes.some((o) => o.status === "ACTIVE"),
            );
            const odds = m?.outcomes.filter((o) => o.status === "ACTIVE").slice(0, 3) ?? [];
            if (odds.length === 0) return null;
            return (
              <div className="mt-4 grid grid-cols-3 gap-2">
                {odds.map((o) => (
                  <span
                    key={o.name}
                    className="flex h-10 items-center justify-center gap-1 rounded-lg border border-line2 bg-[#0d1a2c] text-sm font-bold text-ink"
                  >
                    {o.label && <span className="text-[10px] font-semibold text-ink3">{o.label}</span>}
                    {Number(o.odds).toFixed(2)}
                  </span>
                ))}
              </div>
            );
          })()}

          {/* CTA */}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-ink3">
              {slides.length} featured {slides.length === 1 ? "match" : "matches"}
            </span>
            <span className="text-xs font-bold text-brand">View match →</span>
          </div>
        </div>
      </Link>

      {/* Dots */}
      {slides.length > 1 && (
        <div className="mt-2.5 flex items-center justify-center gap-1.5">
          {slides.map((_, i) => (
            <button
              key={i}
              aria-label={`Go to match ${i + 1}`}
              onClick={() => setIdx(i)}
              className={`h-1.5 rounded-full transition-all ${i === idx ? "w-5 bg-brand" : "w-1.5 bg-line2"}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
