"use client";

import { useEffect, useMemo, useState } from "react";
import { useBetSlip } from "@/components/BetSlipContext";
import { IconStar, IconChevronDown } from "@/components/icons";
import { fmtOdds } from "@/lib/odds";
import { useTranslation } from "react-i18next";
import { tMarket } from "@/lib/i18n";

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

const STAR_KEY = "vb_star_markets";
/** Selected-cell highlight — glowing yellow #FFD700 (Betika style). */
const SELECTED_CLS =
  "!border-[#FFD700] bg-[#FFD700]/10 shadow-[0_0_0_1px_#FFD700,0_0_14px_rgba(255,215,0,0.35)]";

function loadStars(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(window.localStorage.getItem(STAR_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Betika-style expanded market layout:
 *  - accordion market headers (star favorite left, chevron right; open by
 *    default, collapsible)
 *  - 2-outcome markets → two equal-width cards [label | bold odds]
 *  - Correct Score → 3-column grid, cells [score | bold odds right-aligned]
 *  - tapping a cell toggles the selection (yellow #FFD700 glow) and updates
 *    the persistent bottom betslip drawer
 */
export default function FixtureMarkets({ game, markets }: { game: FixtureCtx; markets: FixtureMarket[] }) {
  const { items, add, remove, setOpen } = useBetSlip();
  const { t } = useTranslation();
  const [cat, setCat] = useState<Category>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [stars, setStars] = useState<Set<string>>(() => loadStars());

  // Persist starred market names.
  useEffect(() => {
    try {
      window.localStorage.setItem(STAR_KEY, JSON.stringify([...stars]));
    } catch {
      /* ignore */
    }
  }, [stars]);

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
  }, [markets, cat]);

  const toggleStar = (name: string) =>
    setStars((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const select = (m: FixtureMarket, o: FixtureOutcome) => {
    const odds = Number(o.odds);
    if (!(odds > 0) || o.status !== "ACTIVE") return;
    const outcomeId = o.id;
    if (items.some((i) => i.outcomeId === outcomeId)) {
      remove(outcomeId);
      return;
    }
    add({
      outcomeId,
      gameId: game.id,
      sport: game.sport,
      competition: game.competition,
      home: game.homeName,
      away: game.awayName,
      startAt: game.startAt,
      market: m.name,
      marketKey: m.key,
      outcome: o.name,
      label: o.label ?? "",
      odds,
      gameStatus: game.status,
      live: game.live,
    });
    if (typeof window !== "undefined" && window.innerWidth >= 1280) setOpen(true);
  };

  /** Cell layout: 2-way = two equal cards; Correct Score = 3-col grid. */
  const cellClass = (m: FixtureMarket) =>
    m.outcomes.length <= 2
      ? "grid grid-cols-2 gap-2"
      : /correct score/i.test(m.name) || m.key === "CORRECT_SCORE"
        ? "grid grid-cols-3 gap-2"
        : "grid grid-cols-2 gap-2 sm:grid-cols-3";

  return (
    <div className="space-y-4">
      {/* Category pills */}
      {markets.length > 1 && (
        <div className="no-scrollbar -mx-4 flex items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {[
            { id: "all" as const, label: t("common.allMarkets"), count: counts.all },
            { id: "main" as const, label: t("common.main"), count: counts.main },
            { id: "first_half" as const, label: t("common.firstHalf"), count: counts.first_half },
          ]
            .filter((c) => c.count > 0)
            .map((c) => (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
                  cat === c.id ? "bg-brand text-[#052e16]" : "bg-[#1A2235] text-ink2 hover:text-ink"
                }`}
              >
                {c.label} ({c.count})
              </button>
            ))}
        </div>
      )}

      {/* Accordion market groups */}
      {visible.map((m) => {
        const open = !collapsed.has(m.id);
        const starred = stars.has(m.name);
        const hasPriced = m.outcomes.some((o) => Number(o.odds) > 0);

        return (
          <div key={m.id} className="card overflow-hidden">
            {/* Accordion header: star · name · chevron */}
            <button
              type="button"
              onClick={() => toggleCollapsed(m.id)}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-2 border-b border-line px-4 py-3 text-left"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Favorite market"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleStar(m.name);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleStar(m.name);
                    }
                  }}
                  className={`shrink-0 transition-colors ${starred ? "text-yellow-400" : "text-ink3 hover:text-yellow-400"}`}
                >
                  <IconStar className={`h-4 w-4 ${starred ? "fill-current" : ""}`} />
                </span>
                <span className="truncate font-bold">{tMarket(m.name)}</span>
                {!hasPriced && (
                  <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                    {t("common.suspended")}
                  </span>
                )}
              </span>
              <IconChevronDown
                className={`h-4 w-4 shrink-0 text-ink3 transition-transform ${open ? "" : "rotate-180"}`}
              />
            </button>

            {open && (
              <div className={`p-3 ${cellClass(m)}`}>
                {m.outcomes.map((o) => {
                  const odds = Number(o.odds);
                  const active = o.status === "ACTIVE" && odds > 0;
                  const selected = items.some((i) => i.outcomeId === o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      disabled={!active}
                      onClick={() => select(m, o)}
                      aria-pressed={selected}
                      title={active ? `${o.name} @ ${fmtOdds(odds)}` : t("common.suspended")}
                      className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-all active:scale-[0.98] ${
                        selected
                          ? SELECTED_CLS
                          : "border border-line2 bg-[#0d1a2c] hover:border-line"
                      } ${active ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        {o.label && (
                          <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-bold text-ink3">
                            {o.label}
                          </span>
                        )}
                        <span className="truncate text-sm font-semibold">{o.name}</span>
                      </span>
                      {active ? (
                        <span className="shrink-0 text-sm font-extrabold tabular-nums text-brand">
                          {fmtOdds(odds)}
                        </span>
                      ) : (
                        <span className="shrink-0 text-xs font-semibold text-ink3">-</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
