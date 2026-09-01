"use client";

import { useEffect, useMemo, useState } from "react";
import { useBetSlip } from "@/components/BetSlipContext";
import { IconStar, IconChevronDown } from "@/components/icons";
import { fmtOdds } from "@/lib/odds";
import { useTranslation } from "react-i18next";
import { tMarket } from "@/lib/i18n";
import { formatOutcomeName, groupHandicapPairs, HANDICAP_MARKET_KEYS } from "@/lib/market-labels";

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
  isManual?: boolean;
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

/* Market category buckets (keys our provider/sync produce). */
const MAIN_KEYS = ["MATCH_RESULT", "h2h", "DOUBLE_CHANCE", "BTTS", "DRAW_NO_BET", "SPREAD"];
const TOTALS_KEYS = ["OVER_UNDER", "totals"];
const FIRST_HALF_KEYS = ["HT_RESULT", "HALF_TIME_RESULT", "HT_OVER_UNDER", "h2h_h1", "totals_h1", "OVER_UNDER_1H"];
const SECOND_HALF_KEYS = ["2H_RESULT", "h2h_h2", "totals_h2", "OVER_UNDER_2H"];
const CORRECT_SCORE_KEYS = ["CORRECT_SCORE", "correct_score"];

type Category = "all" | "main" | "totals" | "first_half" | "second_half" | "correct_score";

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
      totals: byKey(TOTALS_KEYS),
      first_half: byKey(FIRST_HALF_KEYS),
      second_half: byKey(SECOND_HALF_KEYS),
      correct_score: byKey(CORRECT_SCORE_KEYS),
    };
  }, [markets]);

  const visible = useMemo(() => {
    if (cat === "main") return markets.filter((m) => MAIN_KEYS.includes(m.key));
    if (cat === "totals") return markets.filter((m) => TOTALS_KEYS.includes(m.key));
    if (cat === "first_half") return markets.filter((m) => FIRST_HALF_KEYS.includes(m.key));
    if (cat === "second_half") return markets.filter((m) => SECOND_HALF_KEYS.includes(m.key));
    if (cat === "correct_score") return markets.filter((m) => CORRECT_SCORE_KEYS.includes(m.key));
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

  /** Handicap boards with line outcomes (Alternate Handicaps, 1st/2nd half
   *  handicap) render as paired Home/Away rows per line. */
  const isHandicapBoard = (m: FixtureMarket) =>
    HANDICAP_MARKET_KEYS.has(m.key) && m.outcomes.some((o) => /[-+]\d+(\.\d+)?\s*$/.test(o.name.trim()));

  /** Cell layout: 2-way = two equal cards; Correct Score = 3-col grid. */
  const cellClass = (m: FixtureMarket) =>
    m.outcomes.length <= 2
      ? "grid grid-cols-2 gap-2"
      : /correct score/i.test(m.name) || m.key === "CORRECT_SCORE"
        ? "grid grid-cols-3 gap-2"
        : "grid grid-cols-2 gap-2 sm:grid-cols-3";

  return (
    <div className="space-y-4">
      {/* Category pills — rendered only when the category has markets */}
      {markets.length > 1 && (
        <div className="no-scrollbar -mx-4 flex items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {[
            { id: "all" as const, label: t("common.allMarkets"), count: counts.all },
            { id: "main" as const, label: t("common.main"), count: counts.main },
            { id: "totals" as const, label: t("common.totals"), count: counts.totals },
            { id: "first_half" as const, label: t("common.firstHalf"), count: counts.first_half },
            { id: "second_half" as const, label: t("common.secondHalf"), count: counts.second_half },
            { id: "correct_score" as const, label: t("common.correctScore"), count: counts.correct_score },
          ]
            .filter((c) => c.count > 0)
            .map((c) => (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
                  cat === c.id ? "bg-brand text-[#052e16]" : "bg-card text-ink2 hover:text-ink"
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
        // Active-selection badge: how many of this market's outcomes are
        // currently on the betslip.
        const outcomeIds = new Set(m.outcomes.map((o) => o.id));
        const selectedCount = items.filter((i) => outcomeIds.has(i.outcomeId)).length;

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
                {m.isManual && (
                  <span className="shrink-0 rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-purple-400">Manual</span>
                )}
                {!hasPriced && (
                  <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                    {t("common.suspended")}
                  </span>
                )}
              </span>
              {selectedCount > 0 && (
                <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-[10px] font-black text-[#052e16]">
                  {selectedCount}
                </span>
              )}
              <IconChevronDown
                className={`h-4 w-4 shrink-0 text-ink3 transition-transform ${open ? "" : "rotate-180"}`}
              />
            </button>

            {open &&
              (isHandicapBoard(m) ? (
                <div className="p-3">
                  {groupHandicapPairs(m.outcomes, game.homeName, game.awayName).map((pair) => (
                    <div key={pair.line} className="mb-2 grid grid-cols-2 gap-2 last:mb-0">
                      {[pair.home, pair.away].map((side, i) =>
                        side ? (
                          <HandicapCell
                            key={`${pair.line}-${i}`}
                            outcome={side as FixtureOutcome}
                            market={m}
                            onSelect={select}
                            selectedIds={items.map((it) => it.outcomeId)}
                            t={t}
                          />
                        ) : (
                          <span key={`${pair.line}-${i}`} />
                        ),
                      )}
                    </div>
                  ))}
                </div>
              ) : (
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
                        title={active ? `${formatOutcomeName(o.name, m.key)} @ ${fmtOdds(odds)}` : t("common.suspended")}
                        className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-all active:scale-[0.98] ${
                          selected
                            ? SELECTED_CLS
                            : "border border-line2 bg-card hover:border-line"
                        } ${active ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          {o.label && (
                            <span className="shrink-0 rounded bg-hover-tint px-1.5 py-0.5 text-[10px] font-bold text-ink3">
                              {o.label}
                            </span>
                          )}
                          <span className="truncate text-sm font-semibold">{formatOutcomeName(o.name, m.key)}</span>
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
              ))}
          </div>
        );
      })}
    </div>
  );
}

/** One paired handicap selection box: team (±point) on the left, odds right. */
function HandicapCell({
  outcome,
  market,
  onSelect,
  selectedIds,
  t,
}: {
  outcome: FixtureOutcome;
  market: FixtureMarket;
  onSelect: (m: FixtureMarket, o: FixtureOutcome) => void;
  selectedIds: string[];
  t: (key: string) => string;
}) {
  const odds = Number(outcome.odds);
  const active = outcome.status === "ACTIVE" && odds > 0;
  const selected = selectedIds.includes(outcome.id);
  return (
    <button
      type="button"
      disabled={!active}
      onClick={() => onSelect(market, outcome)}
      aria-pressed={selected}
      title={active ? `${formatOutcomeName(outcome.name, market.key)} @ ${fmtOdds(odds)}` : t("common.suspended")}
      className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-all active:scale-[0.98] ${
        selected ? SELECTED_CLS : "border border-line2 bg-card hover:border-line"
      } ${active ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
    >
      <span className="min-w-0 truncate text-sm font-semibold">{formatOutcomeName(outcome.name, market.key)}</span>
      {active ? (
        <span className="shrink-0 text-sm font-extrabold tabular-nums text-brand">{fmtOdds(odds)}</span>
      ) : (
        <span className="shrink-0 text-xs font-semibold text-ink3">-</span>
      )}
    </button>
  );
}
