"use client";

/**
 * HybridMatchCard — TEST-ONLY preview card.
 *
 * First view = compact row (status · league · teams · "Markets" arrow).
 * NO odds render until the user clicks the Markets arrow — the card then
 * expands in place to show full fixture info + a market accordion where each
 * market row drops open (arrow) to reveal its odds, Betika-style.
 *
 * When a fixture has no odds (markets: null) the accordion renders the
 * market placeholders as "-"; the "Odds missing (−)" toggle on the preview
 * page forces that state for every card.
 */
import { useState } from "react";
import { fmtOdds } from "@/lib/odds";
import type { HybridMarket, HybridMatch } from "@/app/api/test-hybrid-feed/route";

function OddsSlot({ label, price }: { label: string; price: number | null }) {
  const has = price !== null && price > 0;
  return (
    <button
      type="button"
      disabled={!has}
      className={`odds-btn active:scale-95 ${has ? "" : "odds-btn-muted"}`}
      title={has ? `${label} @ ${fmtOdds(price)}` : "Price unavailable"}
    >
      {has ? fmtOdds(price) : "-"}
    </button>
  );
}

function StatusBadge({ m }: { m: HybridMatch }) {
  if (m.status === "LIVE") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
        LIVE
      </span>
    );
  }
  if (m.status === "FT") {
    return (
      <span className="inline-flex items-center rounded-full bg-card2 px-2 py-0.5 text-[10px] font-bold text-ink3">FT</span>
    );
  }
  if (m.status === "POSTP" || m.status === "CANC") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">
        {m.statusLabel.toUpperCase()}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums text-ink3">
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" strokeLinecap="round" />
      </svg>
      {new Date(m.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

const sourceBadge = (m: HybridMatch) => {
  const map = {
    "the-odds-api": ["ODDS API", "bg-purple-500/15 text-purple-300"],
    sportmonks: ["SM ODDS", "bg-sky-500/15 text-sky-300"],
    mock: ["MOCK", "bg-card2 text-ink3"],
  } as const;
  const [label, cls] = m.oddsSource ? map[m.oddsSource] : ["NO ODDS", "bg-card2 text-ink3"];
  return { label, cls };
};

/** Accordion row: market name + arrow; click expands the odds buttons. */
function MarketRow({ market, missing }: { market: HybridMarket; missing: boolean }) {
  const [open, setOpen] = useState(false);
  const prices = missing ? market.outcomes.map(() => null) : market.outcomes.map((o) => o.odds);
  return (
    <div className="border-t border-line/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-1 py-2.5 text-left"
      >
        <span className="text-[12px] font-semibold text-ink2">{market.name}</span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-ink3">{market.outcomes.length} odds</span>
          <svg
            className={`h-3.5 w-3.5 text-ink3 transition-transform ${open ? "rotate-180" : ""}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="flex flex-wrap items-center gap-1.5 px-1 pb-3 [&_.odds-btn]:h-8 [&_.odds-btn]:min-w-[3.25rem]">
          {market.outcomes.map((o, i) => (
            <div key={o.name} className="flex flex-col items-center gap-0.5">
              <span className="text-[9px] font-bold text-ink3">{o.name}</span>
              <OddsSlot label={o.name} price={prices[i] ?? null} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HybridMatchCard({
  match,
  forceMissing = false,
}: {
  match: HybridMatch;
  /** Simulate the "no odds matched" state site-wide (preview toggle). */
  forceMissing?: boolean;
}) {
  const [showMarkets, setShowMarkets] = useState(false);
  const markets = forceMissing ? null : match.markets;
  const badge = sourceBadge(match);
  const kickoffDate = new Date(match.kickoff);

  return (
    <div className="card px-3 py-2.5">
      {/* ── Compact first view: no odds, just a Markets arrow ── */}
      <div className="flex items-center gap-3">
        <div className="flex w-[4.75rem] shrink-0 flex-col items-center gap-1">
          <StatusBadge m={match} />
          <span className="text-[9px] font-medium text-ink3">{match.statusLabel}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-ink3">
            <span className="truncate">{[match.country, match.league].filter(Boolean).join(" • ")}</span>
            <span className="text-ink3/50">·</span>
            <span className="shrink-0 rounded bg-brand/10 px-1 py-px font-bold text-brand">{match.sport.toUpperCase()}</span>
            <span
              title="Which source populated these odds (fallback: sportmonks → the-odds-api → none)"
              className={`shrink-0 rounded px-1 py-px font-bold ${badge.cls}`}
            >
              {badge.label}
            </span>
          </div>
          <div className="space-y-0.5">
            {[match.homeTeam, match.awayTeam].map((t, i) => (
              <div key={i} className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <span className="w-3 shrink-0 text-[10px] font-bold text-ink3">{i === 0 ? "1" : "2"}</span>
                <span className="truncate">{t}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Markets expand arrow */}
        <button
          type="button"
          onClick={() => setShowMarkets((v) => !v)}
          aria-expanded={showMarkets}
          className={`flex shrink-0 flex-col items-center gap-0.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition-colors ${
            showMarkets ? "border-brand/60 bg-brand/10 text-brand" : "border-line text-ink2 hover:text-ink"
          }`}
        >
          <svg className={`h-4 w-4 transition-transform ${showMarkets ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Markets
        </button>
      </div>

      {/* ── Expanded: full match info + market accordion ── */}
      {showMarkets && (
        <div className="mt-2.5 rounded-lg bg-card2/40 px-2 pb-1 pt-2">
          {/* Full fixture info */}
          <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 px-1 text-[11px] text-ink3">
            <span className="font-semibold text-ink2">
              {kickoffDate.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}{" "}
              {kickoffDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            {match.venue && <span>🏟 {match.venue}</span>}
            <span>{match.statusLabel}</span>
            <span className="ml-auto font-bold text-ink2">{match.homeTeam} v {match.awayTeam}</span>
          </div>

          {markets && markets.length > 0 ? (
            <div>
              {markets.map((m) => (
                <MarketRow key={m.key} market={m} missing={forceMissing} />
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-between border-t border-line/50 px-1 py-3 text-[11px] font-semibold text-ink3">
              <span>No odds available for this fixture</span>
              <span className="rounded bg-card2 px-1.5 py-0.5 text-[10px] font-bold">
                {match.oddsSource ? "source: " + badge.label : "no odds source matched"}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
