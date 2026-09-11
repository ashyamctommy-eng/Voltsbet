"use client";

import { useEffect, useMemo, useState } from "react";
import { useBetSlip } from "@/components/BetSlipContext";
import OddsButton from "@/components/OddsButton";
import { IconStar, IconChevronDown } from "@/components/icons";
import { useTranslation } from "react-i18next";
import { tMarket } from "@/lib/i18n";
import { displayOutcomeName, groupHandicapPairs, HANDICAP_MARKET_KEYS, TEAM_MARKET_SCOPE } from "@/lib/market-labels";
import { pairOverUnderGroups } from "@/lib/odds-layout";

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
const MAIN_KEYS = [
  "MATCH_RESULT", "h2h", "DOUBLE_CHANCE", "BTTS", "DRAW_NO_BET", "SPREAD",
  "EUROPEAN_HANDICAP", "HT_FT", "HIGHEST_SCORING_HALF", "MULTI_GOALS",
  "CLEAN_SHEET", "WIN_TO_NIL", "TOTAL_CORNERS", "TOTAL_BOOKINGS",
  "CORNERS_HANDICAP", "CARDS_HANDICAP", "CORNERS_1X2", "TEAM_CORNERS",
  "TO_QUALIFY", "PLAYER_GOALSCORER_ANYTIME", "PLAYER_FIRST_GOALSCORER",
  "PLAYER_LAST_GOALSCORER", "PLAYER_RECEIVE_CARD", "PLAYER_RECEIVE_RED_CARD",
  "PLAYER_SHOTS_ON_TARGET", "PLAYER_SHOTS", "PLAYER_ASSISTS",
];
const TOTALS_KEYS = ["OVER_UNDER", "totals", "TOTAL_CORNERS", "TOTAL_BOOKINGS"];
const FIRST_HALF_KEYS = ["HT_RESULT", "HALF_TIME_RESULT", "HT_OVER_UNDER", "h2h_h1", "totals_h1", "OVER_UNDER_1H", "FIRST_HALF_BTTS"];
const SECOND_HALF_KEYS = ["2H_RESULT", "h2h_h2", "totals_h2", "OVER_UNDER_2H"];
const CORRECT_SCORE_KEYS = ["CORRECT_SCORE", "correct_score"];

/** Correct-score boards are long — keep the dense scoreboard grid for these. */
const SCORE_GRID_KEYS = new Set(["CORRECT_SCORE", "correct_score"]);

/** Result boards whose outcome label ("1" / "X" / "2") IS the display text.
 *  Everywhere else the sanitized outcome name is shown instead. */
const RESULT_LABEL_KEYS = new Set([
  "h2h", "MATCH_RESULT", "HT_RESULT", "HALF_TIME_RESULT", "2H_RESULT", "h2h_h1", "h2h_h2",
]);

type Category = "all" | "main" | "totals" | "first_half" | "second_half" | "correct_score";

const STAR_KEY = "vb_star_markets";

function loadStars(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(window.localStorage.getItem(STAR_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Fixture market board (match detail).
 *
 * Every outcome is the platform's shared OddsButton pill — label left, odds
 * right — so this page and the feed cards are the same widget. Layout follows
 * the shared rule (@/lib/odds-layout): Over/Under line markets pair 2-up per
 * line, everything else stacks full-width. Correct score keeps a dense
 * scoreboard grid (too many cells to stack).
 *
 * Section header: ★ favourite · bold title · ⓘ · selection badge · ▾ collapse.
 */
export default function FixtureMarkets({ game, markets }: { game: FixtureCtx; markets: FixtureMarket[] }) {
  const { items } = useBetSlip();
  const { t } = useTranslation();
  const [cat, setCat] = useState<Category>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [stars, setStars] = useState<Set<string>>(() => loadStars());

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

  /**
   * Left-hand text of the pill. Result boards show their short tag
   * ("1" / "X" / "2"); every other board shows the sanitized outcome name —
   * "Over 0.5", never the bare side label ("1") that team totals carry for
   * settlement. On Home/Away Team Totals the redundant team prefix is already
   * stripped by displayOutcomeName().
   */
  const text = (m: FixtureMarket, o: FixtureOutcome) => {
    const tag = o.label?.trim();
    if (tag && RESULT_LABEL_KEYS.has(m.key)) return tag;
    return displayOutcomeName(o.name, m.key, game.homeName, game.awayName);
  };

  const pill = (m: FixtureMarket, o: FixtureOutcome) => (
    <OddsButton
      key={o.id}
      outcomeId={o.id}
      gameId={game.id}
      sport={game.sport}
      competition={game.competition}
      home={game.homeName}
      away={game.awayName}
      startAt={game.startAt}
      market={m.name}
      marketKey={m.key}
      outcome={o.name}
      label={o.label}
      displayLabel={text(m, o)}
      odds={Number(o.odds)}
      gameStatus={game.status}
      live={game.live}
      disabled={o.status !== "ACTIVE"}
    />
  );

  /** Handicap boards with line outcomes render as paired Home/Away rows. */
  const isHandicapBoard = (m: FixtureMarket) =>
    HANDICAP_MARKET_KEYS.has(m.key) && m.outcomes.some((o) => /[-+]\d+(\.\d+)?\s*$/.test(o.name.trim()));

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      {/* Category filter strip — rendered only when the category has markets */}
      {markets.length > 1 && (
        <div className="no-scrollbar flex items-center gap-1 overflow-x-auto border-b border-line px-3 py-2">
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
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                  cat === c.id ? "bg-brand text-[#052e16]" : "bg-hover-tint text-ink2 hover:text-ink"
                }`}
              >
                {c.label} ({c.count})
              </button>
            ))}
        </div>
      )}

      {visible.map((m) => {
        const open = !collapsed.has(m.id);
        const starred = stars.has(m.name);
        const hasPriced = m.outcomes.some((o) => Number(o.odds) > 0);
        const outcomeIds = new Set(m.outcomes.map((o) => o.id));
        const selectedCount = items.filter((i) => outcomeIds.has(i.outcomeId)).length;
        const isScore = SCORE_GRID_KEYS.has(m.key);

        return (
          <section key={m.id} className="border-b border-line last:border-b-0">
            {/* ── Section header: ★ · title · ⓘ · badge · ▾ ───────────── */}
            <div className="flex items-center gap-2 px-3 py-3">
              <button
                type="button"
                aria-label={starred ? t("common.unfavorite", { defaultValue: "Remove from favourites" }) : t("common.favorite", { defaultValue: "Add to favourites" })}
                aria-pressed={starred}
                onClick={() => toggleStar(m.name)}
                className={`shrink-0 transition-colors ${starred ? "text-yellow-400" : "text-ink3 hover:text-yellow-400"}`}
              >
                <IconStar className={`h-4 w-4 ${starred ? "fill-current" : ""}`} />
              </button>

              <button
                type="button"
                onClick={() => toggleCollapsed(m.id)}
                aria-expanded={open}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className="truncate text-sm font-bold text-ink">{tMarket(m.name)}</span>
                {/* ⓘ — informational marker (count of options) */}
                <span
                  aria-hidden
                  title={`${m.outcomes.length} ${t("common.selections", { defaultValue: "selections" })}`}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line text-[9px] font-bold text-ink3"
                >
                  i
                </span>
                {m.isManual && (
                  <span className="shrink-0 rounded-full bg-purple-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-purple-400">Manual</span>
                )}
                {!hasPriced && (
                  <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-400">
                    {t("common.suspended")}
                  </span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  {selectedCount > 0 && (
                    <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-black leading-none text-[#052e16]">
                      {selectedCount}
                    </span>
                  )}
                  <IconChevronDown className={`h-4 w-4 text-ink3 transition-transform ${open ? "rotate-180" : ""}`} />
                </span>
              </button>
            </div>

            {/* ── Options ─────────────────────────────────────────────── */}
            {open && (
              <div className="px-3 pb-3">
                {isHandicapBoard(m) ? (
                  <div className="grid gap-2">
                    {groupHandicapPairs(m.outcomes, game.homeName, game.awayName).map((pair) => (
                      <div key={pair.line} className="grid grid-cols-2 gap-2">
                        {[pair.home, pair.away].map((side, i) =>
                          side ? pill(m, side as FixtureOutcome) : <span key={`${pair.line}-${i}`} />,
                        )}
                      </div>
                    ))}
                  </div>
                ) : isScore ? (
                  <div className="grid grid-cols-3 gap-2">{m.outcomes.map((o) => pill(m, o))}</div>
                ) : (
                  (() => {
                    /* Over/Under boards pair 2-up per line. On a MIXED team
                       board (both teams in one accordion) the pairs are grouped
                       by the team prefix — show it once as a sub-header rather
                       than repeating "West Ham United …" inside every pill. On
                       single-team boards the accordion header already names the
                       side, so no sub-header is needed. */
                    const groups = pairOverUnderGroups(m.outcomes);
                    if (!groups) {
                      return (
                        <div className="grid gap-2">
                          {m.outcomes.map((o) => (
                            <div key={o.id}>{pill(m, o)}</div>
                          ))}
                        </div>
                      );
                    }
                    const showPrefix = !TEAM_MARKET_SCOPE[m.key];
                    return (
                      <div className="grid gap-2">
                        {groups.map((g, i) => {
                          // Sub-header once per team, not once per line.
                          const newTeam = showPrefix && g.prefix !== "" && g.prefix !== groups[i - 1]?.prefix;
                          return (
                            <div key={g.cells[0].id} className="grid gap-2">
                              {newTeam && (
                                <div className="truncate text-[11px] font-semibold text-ink3">{g.prefix}</div>
                              )}
                              <div className="grid grid-cols-2 gap-2">
                                {g.cells.map((o) => pill(m, o))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
