"use client";

import { useMemo, useState } from "react";
import OddsButton from "@/components/OddsButton";

type FixtureOutcome = {
  id: string;
  name: string;
  label: string | null;
  odds: unknown;
  status: string;
};

type FixtureMarket = {
  id: string;
  name: string;
  key: string;
  status: string;
  outcomes: FixtureOutcome[];
};

type FixtureCtx = {
  id: string;
  homeName: string;
  awayName: string;
  sport: string;
  competition: string;
  startAt: string;
  status: string;
  live: boolean;
};

/* Market category buckets (keys our providers/sync produce). */
const MAIN_KEYS = ["MATCH_RESULT", "h2h", "DOUBLE_CHANCE", "BTTS", "OVER_UNDER", "totals", "DRAW_NO_BET"];
const FIRST_HALF_KEYS = ["HT_RESULT", "HALF_TIME_RESULT", "HT_OVER_UNDER"];

type Category = "all" | "main" | "first_half";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "all", label: "All Markets" },
  { id: "main", label: "Main" },
  { id: "first_half", label: "First Half" },
];

/** Market list with horizontal category pill navigation. */
export default function FixtureMarkets({ game, markets }: { game: FixtureCtx; markets: FixtureMarket[] }) {
  const [cat, setCat] = useState<Category>("all");

  const counts = useMemo(() => {
    const byKey = (keys: string[]) => markets.filter((m) => keys.includes(m.key)).length;
    return {
      all: markets.length,
      main: byKey(MAIN_KEYS),
      first_half: byKey(FIRST_HALF_KEYS),
    };
  }, [markets]);

  const visible = useMemo(() => {
    if (cat === "main") return markets.filter((m) => MAIN_KEYS.includes(m.key));
    if (cat === "first_half") return markets.filter((m) => FIRST_HALF_KEYS.includes(m.key));
    return markets;
  }, [cat, markets]);

  if (markets.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-amber-400">
        Markets for this fixture are currently closed or suspended.
      </div>
    );
  }

  return (
    <div>
      {/* Market category navigation */}
      <div className="no-scrollbar -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {CATEGORIES.map((c) => {
          const n = counts[c.id];
          const active = cat === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${
                active ? "bg-brand text-[#052e16]" : "bg-white/5 text-ink2 hover:bg-white/10 hover:text-ink"
              }`}
            >
              {c.label} [{n}]
            </button>
          );
        })}
      </div>

      {/* Markets */}
      <div className="mt-4 space-y-4">
        {visible.length === 0 && (
          <div className="card p-8 text-center text-sm text-ink3">No markets in this category.</div>
        )}
        {visible.map((market) => (
          <div key={market.id} className="card overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <h3 className="font-bold">{market.name}</h3>
            </div>
            <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {market.outcomes.map((o) =>
                o.status === "ACTIVE" ? (
                  <div key={o.id} className="flex items-center gap-3 rounded-lg bg-card2 px-3 py-2">
                    <span className="flex-1 text-sm">
                      {o.label && <span className="mr-1.5 font-semibold text-ink3">{o.label}</span>}
                      <span className="font-medium">{o.name}</span>
                    </span>
                    <OddsButton
                      outcomeId={o.id}
                      gameId={game.id}
                      sport={game.sport}
                      competition={game.competition}
                      home={game.homeName}
                      away={game.awayName}
                      startAt={game.startAt}
                      market={market.name}
                      marketKey={market.key}
                      outcome={o.name}
                      label={o.label}
                      odds={Number(o.odds)}
                      gameStatus={game.status}
                      live={game.live}
                    />
                  </div>
                ) : (
                  <div key={o.id} className="flex items-center gap-3 rounded-lg bg-card2 px-3 py-2 opacity-60">
                    <span className="flex-1 text-sm text-ink2">
                      {o.label && <span className="mr-1.5 font-semibold">{o.label}</span>}
                      {o.name}
                    </span>
                    <span className="text-xs font-semibold text-amber-400">Suspended</span>
                  </div>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
