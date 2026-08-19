"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import TeamLogo from "@/components/TeamLogo";
import { IconGift, IconClock } from "@/components/icons";
import { formatKickoff, liveContext } from "@/lib/kickoff";
import { leagueRank } from "@/lib/league-rank";

type SlideGame = {
  id: string;
  /** True when rendered from the live BetsAPI feed (no DB fixture page). */
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
  sport: { name: string; slug: string; icon: string | null };
  competitionName: string | null;
  markets: {
    key: string;
    status: string;
    outcomes: { name: string; label: string | null; odds: unknown; status: string }[];
  }[];
};

const INTERVAL_MS = 5000;

/** Hero carousel: cashback promo slide + auto-rotating live/upcoming matches. */
export default function MatchSlideshow({ games }: { games: SlideGame[] }) {
  const matchSlides = useMemo(() => {
    const now = new Date();
    const live = games.filter((g) => g.live || g.status === "LIVE");
    const upcoming = games
      .filter((g) => !g.live && g.status !== "LIVE" && new Date(g.startAt) > now)
      .sort(
        (a, b) =>
          leagueRank(a.competitionName) - leagueRank(b.competitionName) ||
          new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
      );
    return [...live, ...upcoming].slice(0, 7); // +1 promo slide
  }, [games]);

  const total = matchSlides.length + 1; // promo is always slide 1
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (total < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % total), INTERVAL_MS);
    return () => clearInterval(t);
  }, [total]);

  // Clamp instead of resetting: keeps the carousel valid when the slide set
  // shrinks between syncs without a state-reset effect.
  const current = idx % total;

  if (matchSlides.length === 0) return null;

  return (
    <section className="mt-4" aria-label="Featured">
      {current === 0 ? (
        <PromoSlide />
      ) : (
        <MatchSlide g={matchSlides[current - 1]} index={current - 1} total={total - 1} />
      )}

      {total > 1 && (
        <div className="mt-2.5 flex items-center justify-center gap-1.5">
          {Array.from({ length: total }).map((_, i) => (
            <button
              key={i}
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => setIdx(i)}
              className={`h-1.5 rounded-full transition-all ${i === current ? "w-5 bg-brand" : "w-1.5 bg-line2"}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* ── Slide 1: 20% cashback promo ────────────────────────────── */
function PromoSlide() {
  return (
    <Link
      href="/account/deposit"
      className="card card-hover relative block overflow-hidden !border-brand/30 bg-gradient-to-br from-emerald-600 via-green-600 to-teal-700 p-5"
    >
      <div className="pointer-events-none absolute -right-14 -top-16 h-52 w-52 rounded-full bg-white/10 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-10 h-44 w-44 rounded-full bg-black/10 blur-2xl" />

      {/* Animated gift badge */}
      <span className="gift-badge absolute right-4 top-4 flex h-12 w-12 items-center justify-center rounded-full bg-white text-green-600 shadow-lg">
        <IconGift className="h-6 w-6" />
      </span>

      <div className="relative">
        <span className="inline-block rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
          Cashback
        </span>
        <h2 className="mt-2 max-w-[85%] text-xl font-black leading-tight text-white">
          20% Cashback — Get 20% back when your sports bet loses!
        </h2>
        <p className="mt-1 text-xs font-semibold text-emerald-50/90">
          Auto-credited on settled losing bets. Terms apply.
        </p>
        <span className="btn mt-4 inline-flex !border-0 !bg-white !text-green-700 shadow-md">Deposit</span>
      </div>
    </Link>
  );
}

/* ── Slides 2+: featured match card ─────────────────────────── */
function MatchSlide({ g, index, total }: { g: SlideGame; index: number; total: number }) {
  const live = g.live || g.status === "LIVE" || g.status === "HALF_TIME";
  const ctx = liveContext(g.status, g.clock, g.period);

  const inner = (
    <>
      <div className="pointer-events-none absolute -right-12 -top-14 h-44 w-44 rounded-full bg-brand/10 blur-2xl" />

      <div className="relative p-4">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="line-clamp-2 font-semibold leading-tight text-ink3">{g.competitionName ?? g.sport.name}</span>
          {live ? (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 font-bold text-red-400">
              <span className="live-dot" /> Live{ctx ? ` · ${ctx}` : ""}
            </span>
          ) : (
            <span className="flex shrink-0 items-center gap-1 font-medium text-ink3">
              <IconClock className="h-3.5 w-3.5" />
              {formatKickoff(g.startAt)}
            </span>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
            <TeamLogo name={g.homeName} src={g.homeLogo} className="h-10 w-10" />
            <span className="line-clamp-1 w-full text-xs font-bold sm:text-sm">{g.homeName}</span>
          </div>

          <div className="shrink-0 px-1 text-center">
            {live || g.status === "FINISHED" ? (
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

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-ink3">
            Match {index + 1} of {total}
          </span>
          <span className="text-xs font-bold text-brand">View match →</span>
        </div>
      </div>
    </>
  );

  // API-fed matches have no DB fixture page — render as a non-link card.
  if (g.isApiMatch) {
    return <div className="card card-hover relative block overflow-hidden !border-brand/20">{inner}</div>;
  }
  return (
    <Link href={`/fixture/${g.id}`} className="card card-hover relative block overflow-hidden !border-brand/20">
      {inner}
    </Link>
  );
}
