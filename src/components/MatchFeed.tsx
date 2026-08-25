"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import MatchCard from "@/components/MatchCard";
import OddsButton from "@/components/OddsButton";
import { IconChevronDown } from "@/components/icons";
import { leagueRank } from "@/lib/league-rank";
import { buildDateOptions, dayWindow, dateParamToValue, valueToDateParam } from "@/lib/feed-dates";
import { flagForLeague, countryForLeague } from "@/lib/league-flags";
import { isLiveStatus } from "@/lib/game-status";
import { apiMatchToFeedGame, type ApiFeedGame, type BetsApiMatchView } from "@/lib/providers/betsapi-transformer";

type FeedGame = ApiFeedGame;

export type { FeedGame };

/** Sub-navigation view modes (header pills → ?view=). */
export type FeedView = "highlights" | "upcoming" | "countries";
export const FEED_VIEWS: { id: FeedView; label: string }[] = [
  { id: "highlights", label: "Highlights" },
  { id: "upcoming", label: "Upcoming" },
  { id: "countries", label: "Countries" },
];
const isFeedView = (v: string | null): v is FeedView =>
  v === "highlights" || v === "upcoming" || v === "countries";

/** Module-level client cache: date/league switches never refetch once loaded. */
const feedCache = new Map<string, ApiFeedGame[]>();

/** Pagination — 30 matches per page. */
const ITEMS_PER_PAGE = 30;

/** Unified filter pill — theme-aware card surface (bg-card in dark = #1A2235,
 *  white in light). Hover tints via the adaptive hover-tint token. */
const PILL = "bg-card text-ink2 hover:bg-hover-tint hover:text-ink";
/** Active pill: brand green fill. */
const PILL_ACTIVE = "bg-brand text-[#052e16]";

type SortMode = "soonest" | "top";

const MARKET_FILTERS = [
  { id: "1x2", label: "1x2 / Winner", keys: ["h2h", "MATCH_RESULT", "DRAW_NO_BET"] },
  { id: "double_chance", label: "Double Chance", keys: ["DOUBLE_CHANCE"] },
  { id: "btts", label: "Both Teams", keys: ["BTTS"] },
  { id: "half_time", label: "Half-time Result", keys: ["HT_RESULT"] },
  { id: "draw_no_bet", label: "Draw No Bet", keys: ["DRAW_NO_BET"] },
] as const;
type MarketFilter = (typeof MARKET_FILTERS)[number]["id"];

/** Compact dropdown pill (date selector / league selector).
 *
 * The menu is PORTALLED to document.body with fixed positioning: the filter
 * bar is an overflow-x-auto scroll container, which clips absolutely
 * positioned children (overflow-y computes to auto) — previously the date
 * and league lists were rendered but invisible. */
function Dropdown({
  label,
  options,
  activeValue,
  onSelect,
}: {
  label: string;
  options: { value: string; label: string; sublabel?: string }[];
  activeValue?: string;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const measure = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(256, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const dropH = 288;
    // Flip upward when the menu would run past the bottom of the viewport.
    const top = r.bottom + dropH > window.innerHeight ? Math.max(8, r.top - dropH - 6) : r.bottom + 6;
    setPos({ top, left, width });
  };

  const openMenu = () => {
    measure();
    setOpen(true);
  };

  // Reposition on scroll/resize while open; Escape closes.
  useEffect(() => {
    if (!open) return;
    const reposition = () => measure();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${PILL}`}
      >
        <span className="max-w-36 truncate">{label}</span>
        <IconChevronDown className="h-3 w-3 shrink-0" />
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
            <div
              role="listbox"
              className="fixed z-[95] max-h-72 overflow-y-auto rounded-xl border border-line bg-card p-1 shadow-2xl"
              style={{ top: pos.top, left: pos.left, width: pos.width }}
            >
              {options.map((o) => (
                <button
                  key={o.value}
                  role="option"
                  aria-selected={o.value === activeValue}
                  onClick={() => {
                    onSelect(o.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold hover:bg-hover-tint ${
                    o.value === activeValue ? "text-brand" : "text-ink2 hover:text-ink"
                  }`}
                >
                  <span className="truncate">{o.label}</span>
                  {o.sublabel && <span className="shrink-0 text-[10px] text-ink3">{o.sublabel}</span>}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

/** Numbered page window: 1 … 3 4 5 … 12 (first, last, current ±1, ellipsis). */
function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 9) return Array.from({ length: total }, (_, i) => i + 1);
  const wanted = new Set<number>([1, total, current - 1, current, current + 1]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const p of pages) {
    if (p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

/** Bookable = pre-match with at least one priced outcome. Suspended/locked
 *  fixtures (time_status "4" / no 1X2 odds) sort to the bottom of the feed. */
const bookable = (g: FeedGame) =>
  g.status !== "POSTPONED" &&
  g.status !== "CANCELLED" &&
  g.markets.some((m) => m.outcomes.some((o) => Number(o.odds) > 1));

/**
 * Match feed — pre-match only, chronological (soonest first), 30/page.
 *
 * Filters chain reactively in client state (sport → date → league → market)
 * and sync to the URL (?date=YYYY-MM-DD&league=...) via history.replaceState —
 * no page reloads, shareable links, and the rolling 7-day window stays
 * DST-safe. Live matches are NEVER rendered here — they belong on /live.
 *
 * The landing page defaults the feed to FOOTBALL (the brand's primary sport)
 * so pre-matches render immediately; a sport pill row switches the scope.
 */
export default function MatchFeed({
  games,
  sportKey = "football",
  autoFetch = true,
  sports,
}: {
  games: FeedGame[];
  sportKey?: string;
  autoFetch?: boolean;
  /** Sport pills (slug + name + icon). When provided the feed defaults to
   *  FOOTBALL and a pill row lets users switch to other sports. */
  sports?: { slug: string; name: string; icon: string | null }[];
}) {
  // Client-side schedule (auto-fetched + cached when no server data).
  const [clientGames, setClientGames] = useState<FeedGame[] | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  useEffect(() => {
    if (games.length > 0 || !autoFetch) return;
    let alive = true;
    const load = async () => {
      const cached = feedCache.get(sportKey);
      if (cached) {
        if (alive) setClientGames(cached);
        return;
      }
      try {
        const res = await fetch("/api/feed/matches");
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            const j = (await res.json()) as { error?: { message?: string } };
            if (j?.error?.message) msg = j.error.message;
          } catch {
            /* keep HTTP status fallback */
          }
          throw new Error(msg);
        }
        const data: { matches?: BetsApiMatchView[] } = await res.json();
        const mapped: FeedGame[] = (data.matches ?? []).map(apiMatchToFeedGame);
        feedCache.set(sportKey, mapped);
        if (alive) setClientGames(mapped);
      } catch (e) {
        if (alive) setFeedError(e instanceof Error ? e.message : "Live feed unavailable");
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [games, sportKey, autoFetch]);
  const feed = clientGames ?? games;

  // Sport scope — landing page defaults to FOOTBALL (no click needed).
  const [sport, setSport] = useState<string>(() =>
    sports?.some((s) => s.slug === "football") ? "football" : "all",
  );

  // Rolling 7-day date selector — default lands on "Today".
  const dateOptions = useMemo(() => buildDateOptions(), []);
  const [dateValue, setDateValue] = useState<string>(() => {
    const fromParam = dateParamToValue(
      typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("date"),
    );
    return fromParam && dateOptions.some((o) => o.value === fromParam) ? fromParam : dateOptions[0].value;
  });
  const [league, setLeague] = useState<string>(() =>
    typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("league") ?? ""),
  );
  const [sortMode, setSortMode] = useState<SortMode>("top");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("1x2");
  const [page, setPage] = useState(1);
  const listRef = useRef<HTMLDivElement>(null);
  const activeDate = dateOptions.find((o) => o.value === dateValue) ?? dateOptions[0];

  // View mode follows the header sub-nav pills (?view=highlights|upcoming|
  // countries). "Highlights" sorts top leagues first, "Upcoming" soonest.
  const searchParams = useSearchParams();
  const view: FeedView = isFeedView(searchParams?.get("view")) ? (searchParams.get("view") as FeedView) : "highlights";
  // Sync sort mode with the view when it changes (adjust-during-render — the
  // React-recommended replacement for setState-in-effect).
  const [prevView, setPrevView] = useState<FeedView>(view);
  if (prevView !== view) {
    setPrevView(view);
    setSortMode(view === "upcoming" ? "soonest" : "top");
  }

  // Keep the URL in sync with the active filters (replaceState → no reload,
  // no history spam; links stay shareable).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const iso = valueToDateParam(dateValue);
    if (iso) p.set("date", iso);
    else p.delete("date");
    if (league) p.set("league", league);
    else p.delete("league");
    const qs = p.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [dateValue, league]);

  // Honor back/forward navigation if the URL changes out from under us.
  useEffect(() => {
    const onPop = () => {
      const p = new URLSearchParams(window.location.search);
      const v = dateParamToValue(p.get("date"));
      if (v && dateOptions.some((o) => o.value === v)) setDateValue(v);
      setLeague(p.get("league") ?? "");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [dateOptions]);

  /** Sport-scoped feed (landing defaults to football; pills switch scope).
   *  League options + the match list derive from this, so the league
   *  dropdown always reflects the active sport. */
  const scoped = useMemo(
    () => (sport === "all" ? feed : feed.filter((g) => g.sport?.slug === sport)),
    [feed, sport],
  );

  /** Distinct competitions from the loaded feed, top leagues first. */
  const leagueOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const g of scoped) {
      if (g.competitionName) set.set(g.competitionName, g.competitionName);
    }
    return [...set.values()]
      .sort((a, b) => leagueRank(a) - leagueRank(b) || a.localeCompare(b))
      .slice(0, 30);
  }, [scoped]);

  /** Active pre-match fixtures: bookable first, then suspended, both
   *  chronological ascending. Live matches never appear here. */
  const filtered = useMemo(() => {
    const { from, to } = dayWindow(dateValue);
    const list = scoped
      .filter((g) => !isLiveStatus(g.status, g.live))
      .filter((g) => {
        const t = new Date(g.startAt).getTime();
        return Number.isFinite(t) && t >= from && t < to;
      })
      .filter((g) => !league || g.competitionName === league);

    return [...list].sort((a, b) => {
      const aBookable = bookable(a) ? 0 : 1;
      const bBookable = bookable(b) ? 0 : 1;
      if (aBookable !== bBookable) return aBookable - bBookable; // suspended last
      if (sortMode === "top") {
        const rankDelta = leagueRank(a.competitionName) - leagueRank(b.competitionName);
        if (rankDelta !== 0) return rankDelta;
      }
      // Strict ascending kickoff: 6:00 PM above 7:00 PM above 7:30 PM.
      return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    });
  }, [scoped, dateValue, league, sortMode]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  /** Countries view — group the current page by the competition's country. */
  const countryGroups = useMemo(() => {
    const map = new Map<string, FeedGame[]>();
    for (const g of pageItems) {
      const key = countryForLeague(g.competitionName) || "Other";
      map.set(key, [...(map.get(key) ?? []), g]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [pageItems]);

  const marketKeys = [...(MARKET_FILTERS.find((m) => m.id === marketFilter)!.keys)];

  /** Filter change resets pagination; page change scrolls back to the list. */
  const selectDate = (v: string) => {
    setDateValue(v);
    setPage(1);
  };
  const selectLeague = (v: string) => {
    setLeague(v);
    setPage(1);
  };
  /** Sport switch resets league (options are sport-scoped) + pagination. */
  const selectSport = (slug: string) => {
    setSport(slug);
    setLeague("");
    setPage(1);
  };
  const selectSort = (m: SortMode) => {
    setSortMode(m);
    setPage(1);
  };
  const goPage = (p: number) => {
    setPage(p);
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="mt-4">
      {/* Sport scope pills — landing page defaults to Football. */}
      {sports && sports.length > 0 && (
        <div className="no-scrollbar -mx-4 mb-2 flex items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <button
            onClick={() => selectSport("all")}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
              sport === "all" ? PILL_ACTIVE : PILL
            }`}
          >
            All Sports
          </button>
          {sports.map((sp) => (
            <button
              key={sp.slug}
              onClick={() => selectSport(sp.slug)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
                sport === sp.slug ? PILL_ACTIVE : PILL
              }`}
            >
              {sp.icon} {sp.name}
            </button>
          ))}
        </div>
      )}

      {/* Secondary control bar (Screenshot 1): Filters | Today | Highlights | 1x2 */}
      <div className="no-scrollbar -mx-4 flex items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Dropdown
          label={league ? `${flagForLeague(league)} ${league}` : "Filters"}
          activeValue={league}
          options={[
            { value: "", label: "All Leagues" },
            ...leagueOptions.map((l) => ({ value: l, label: `${flagForLeague(l)} ${l}` })),
          ]}
          onSelect={selectLeague}
        />
        <Dropdown
          label={activeDate.label}
          activeValue={dateValue}
          options={dateOptions.map((o) => ({ value: o.value, label: o.label, sublabel: o.dateLabel }))}
          onSelect={selectDate}
        />
        <Dropdown
          label={sortMode === "top" ? "Highlights" : "Upcoming"}
          activeValue={sortMode}
          options={[
            { value: "top", label: "Highlights — Top Leagues" },
            { value: "soonest", label: "Upcoming — Soonest First" },
          ]}
          onSelect={(v) => selectSort(v as SortMode)}
        />
        <Dropdown
          label={MARKET_FILTERS.find((m) => m.id === marketFilter)?.label ?? "1x2"}
          activeValue={marketFilter}
          options={MARKET_FILTERS.map((m) => ({ value: m.id, label: m.label }))}
          onSelect={(v) => {
            setMarketFilter(v as MarketFilter);
            setPage(1);
          }}
        />
        <span className="ml-auto shrink-0 pl-2 text-[11px] font-semibold text-ink3">{filtered.length} matches</span>
      </div>

      {/* Column header strip: Teams left · 1 / X / 2 headers right (1x2 view) */}
      {marketFilter === "1x2" && pageItems.length > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 border-b border-line pb-1.5 pl-3 pr-3 text-[10px] font-bold uppercase tracking-wider text-ink3 sm:pl-4 sm:pr-4">
          <span>Teams</span>
          <span className="flex shrink-0 items-center gap-1">
            <span className="w-11 text-center">1</span>
            <span className="w-11 text-center">X</span>
            <span className="w-11 text-center">2</span>
          </span>
        </div>
      )}

      {/* Match list (paginated) — view modes: highlights/upcoming = cards,
          countries = grouped by country */}
      <div ref={listRef} className="mt-3 scroll-mt-24">
        {feedError ? (
          <div className="card p-10 text-center text-sm text-ink3">
            Live feed unavailable — {feedError}. Check the API key in Admin → API Settings.
          </div>
        ) : pageItems.length === 0 ? (
          <div className="card p-10 text-center text-sm text-ink3">
            No matches on {activeDate.label} {activeDate.dateLabel}
            {league ? ` in ${league}` : ""} — try another date or league.
          </div>
        ) : view === "countries" ? (
          <div className="space-y-5">
            {countryGroups.map(([country, games]) => (
              <div key={country}>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-bold text-ink3">
                  <span className="h-1 w-1 rounded-full bg-brand" /> {country}
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {games.map((g) => <MatchCard key={g.id} game={g} preferMarkets={marketKeys} />)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {pageItems.map((g) => <MatchCard key={g.id} game={g} preferMarkets={marketKeys} />)}
          </div>
        )}
      </div>

      {/* Pagination — 30 matches per page */}
      {totalPages > 1 && (
        <nav className="mt-4 flex flex-wrap items-center justify-center gap-1.5" aria-label="Match pages">
          <button
            onClick={() => goPage(currentPage - 1)}
            disabled={currentPage <= 1}
            className="h-8 rounded-lg bg-card px-3 text-xs font-bold text-ink2 transition-colors hover:text-ink disabled:opacity-40"
          >
            Prev
          </button>
          {pageWindow(currentPage, totalPages).map((p, i) =>
            p === "…" ? (
              <span key={`e${i}`} className="px-1 text-xs text-ink3">…</span>
            ) : (
              <button
                key={p}
                onClick={() => goPage(p)}
                aria-current={p === currentPage ? "page" : undefined}
                className={`h-8 min-w-8 rounded-lg px-2 text-xs font-bold transition-colors ${
                  p === currentPage ? PILL_ACTIVE : "bg-card text-ink2 hover:text-ink"
                }`}
              >
                {p}
              </button>
            ),
          )}
          <button
            onClick={() => goPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="h-8 rounded-lg bg-card px-3 text-xs font-bold text-ink2 transition-colors hover:text-ink disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
