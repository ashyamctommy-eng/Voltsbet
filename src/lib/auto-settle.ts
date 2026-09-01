import { prisma } from "./prisma";
import { settleOutcome } from "./settle";
import { getSettings } from "./settings";
import { ApiError } from "./api";

/**
 * Auto-settlement — resolves finished games' markets from the final score and
 * settles every outcome it can determine with certainty. Unresolvable markets
 * (correct score with unusual names, unknown keys, live edges) are skipped and
 * stay for admin review — auto-settlement never guesses.
 *
 * Run via GET/POST /api/cron/settle (bearer cron.secret) on any schedule.
 */

const SYSTEM_ACTOR = { id: "system", username: "system" } as const;

type Result = "WON" | "LOST" | "VOID" | null; // null = cannot determine → skip

export async function autoSettleFinishedGames(): Promise<{ settled: string[]; skipped: string[] }> {
  const settings = await getSettings();
  const delayMs = settings.settlementDelayMinutes * 60_000;
  const cutoff = new Date(Date.now() - delayMs);

  const games = await prisma.game.findMany({
    where: {
      status: "FINISHED",
      updatedAt: { lte: cutoff },
      markets: { some: { outcomes: { some: { settled: false } } } },
    },
    include: {
      markets: {
        include: { outcomes: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  const settled: string[] = [];
  const skipped: string[] = [];

  for (const game of games) {
    for (const market of game.markets) {
      const unsettled = market.outcomes.filter((o) => !o.settled);
      if (unsettled.length === 0) continue;

      for (const outcome of unsettled) {
        const result = resolveOutcome(game, market.key, outcome.name, outcome.label);
        if (!result) continue; // null = undecidable → leave for admin review
        try {
          await settleOutcome(SYSTEM_ACTOR, outcome.id, result);
          settled.push(`${game.homeName} vs ${game.awayName} · ${market.name} · ${outcome.name}`);
        } catch (e) {
          // ALREADY_SETTLED is the normal race (another run / admin settled it
          // first) — skip quietly. Anything else is a real failure (DB error,
          // credit failure) that used to be swallowed by an empty catch,
          // hiding money-path bugs in production — log it.
          const isRace = e instanceof ApiError && e.code === "ALREADY_SETTLED";
          if (!isRace) {
            console.error(
              `[auto-settle] failed to settle outcome ${outcome.id} (${game.homeName} vs ${game.awayName} · ${market.name})`,
              e instanceof Error ? e.message : e
            );
          }
          skipped.push(outcome.id);
        }
      }
    }
  }

  return { settled, skipped };
}

/** Map a final score to a market result: "H" | "A" | "D" | null. */
function gameResult(game: { homeScore: number; awayScore: number }): "H" | "A" | "D" | null {
  const h = Number(game.homeScore);
  const a = Number(game.awayScore);
  if (Number.isNaN(h) || Number.isNaN(a)) return null;
  return h > a ? "H" : a > h ? "A" : "D";
}

type GameScores = {
  homeScore: number;
  awayScore: number;
  homeName: string;
  awayName: string;
  halfHomeScore?: number | null;
  halfAwayScore?: number | null;
};

export function resolveOutcome(
  game: GameScores,
  marketKey: string,
  outcomeName: string,
  outcomeLabel: string | null,
): Result {
  const r = gameResult(game);
  if (!r) return null;
  const name = outcomeName.toLowerCase().trim();
  const label = (outcomeLabel ?? "").toLowerCase();
  const home = Number(game.homeScore);
  const away = Number(game.awayScore);

  // ── Match result family (1 / X / 2) — FULL-TIME markets only. HT_RESULT /
  //    2H_RESULT are intentionally NOT here: The Odds API /scores does not
  //    expose half-time scores — they go to admin review.
  if (["MATCH_RESULT", "h2h"].includes(marketKey)) {
    const isHome = label === "1" || name === game.homeName.toLowerCase();
    const isAway = label === "2" || name === game.awayName.toLowerCase();
    const isDraw = label === "x" || name === "draw";
    if (isHome) return r === "H" ? "WON" : "LOST";
    if (isAway) return r === "A" ? "WON" : "LOST";
    if (isDraw) return r === "D" ? "WON" : "LOST";
    return null;
  }

  // ── Draw No Bet — a draw VOIDS the stake (balance refund path). ────
  if (marketKey === "DRAW_NO_BET") {
    const isHome = label === "1" || name === game.homeName.toLowerCase();
    const isAway = label === "2" || name === game.awayName.toLowerCase();
    if (r === "D") return "VOID";
    if (isHome) return r === "H" ? "WON" : "LOST";
    if (isAway) return r === "A" ? "WON" : "LOST";
    return null;
  }

  // ── Double chance (1X / X2 / 12) ────────────────────────────
  if (marketKey === "DOUBLE_CHANCE") {
    if (name === "1x") return r === "H" || r === "D" ? "WON" : "LOST";
    if (name === "x2") return r === "A" || r === "D" ? "WON" : "LOST";
    if (name === "12") return r !== "D" ? "WON" : "LOST";
    return null;
  }

  // ── Over / Under totals (full-time). Quarter lines (x.25/x.75) are
  //    Asian totals: a "half-win/half-push" result can't be expressed in
  //    the single-outcome model → skip to admin when the split lands mixed.
  if (["OVER_UNDER", "totals", "ALTERNATE_TOTALS", "alternate_totals"].includes(marketKey)) {
    const line = Number(name.match(/[\d.]+/)?.[0]);
    if (!line || Number.isNaN(line)) return null;
    const total = home + away;
    const isOver = name.startsWith("over");
    const isUnder = name.startsWith("under");
    if (!isOver && !isUnder) return null;
    if (line % 1 === 0.25 || line % 1 === 0.75) return null; // asian quarter line → admin
    if (total === line) return "VOID"; // whole-line push (e.g. Over 2 at 2-0)
    if (isOver) return total > line ? "WON" : "LOST";
    return total < line ? "WON" : "LOST";
  }

  // ── 1st Half totals — settles off the half-time score when the feed
  //    populated it; never guesses from the full-time score. Only enters
  //    when the outcome actually carries an Over/Under line (a bare "1st
  //    Half" name — Highest Scoring Half — must fall through to its own
  //    handler).
  if (
    ["HT_TOTALS", "1H_TOTALS", "FIRST_HALF_TOTALS", "OVER_UNDER_1H", "OVER_UNDER_2H"].includes(marketKey) ||
    (/\b(1st|first)[ -]half\b/.test(name) && /\b(over|under)\b/.test(name))
  ) {
    if (game.halfHomeScore == null || game.halfAwayScore == null) return null; // no HT score → admin
    const line = Number(name.match(/[\d.]+/)?.[0]);
    if (!line || Number.isNaN(line)) return null;
    // OVER_UNDER_2H: 2nd half = full-time − half-time (needs both halves)
    const isSecondHalf = marketKey === "OVER_UNDER_2H" || /\b2nd|second[ -]half\b/.test(name);
    const htTotal = isSecondHalf
      ? Number(game.homeScore) + Number(game.awayScore) - Number(game.halfHomeScore) - Number(game.halfAwayScore)
      : Number(game.halfHomeScore) + Number(game.halfAwayScore);
    const isOver = name.startsWith("over");
    const isUnder = name.startsWith("under");
    if (!isOver && !isUnder) return null;
    if (line % 1 === 0.25 || line % 1 === 0.75) return null;
    if (htTotal === line) return "VOID";
    if (isOver) return htTotal > line ? "WON" : "LOST";
    return htTotal < line ? "WON" : "LOST";
  }

  // ── Team totals ("Arsenal Over 1.5" / "Over 1.5" + label home/away) ──
  if (["TEAM_TOTALS", "TEAM_TOTAL", "team_totals", "TEAM_TOTALS_HOME", "TEAM_TOTALS_AWAY"].includes(marketKey)) {
    const line = Number(name.match(/[\d.]+/)?.[0]);
    if (!line || Number.isNaN(line)) return null;
    const homeName = game.homeName.toLowerCase();
    const awayName = game.awayName.toLowerCase();
    const teamScore = name.includes(homeName) || label === "home" || label === "1"
      ? home
      : name.includes(awayName) || label === "away" || label === "2"
        ? away
        : null;
    if (teamScore == null) return null;
    const isOver = /\bover\b/.test(name);
    const isUnder = /\bunder\b/.test(name);
    if (!isOver && !isUnder) return null;
    if (teamScore === line) return "VOID";
    if (isOver) return teamScore > line ? "WON" : "LOST";
    return teamScore < line ? "WON" : "LOST";
  }

  // ── Asian handicap ("Home -1.5", "Away +0.5", or name + label 1/2) ──
  //    Handicap applies to the BACKED team's score. Quarter lines (±x.25/
  //    ±x.75) split the stake across two half handicaps; when the split
  //    lands mixed (half-win/half-push etc.) the single-outcome model
  //    can't express it → skip to admin. Whole/half lines resolve cleanly,
  //    including the whole-line PUSH → VOID refund.
  if (["ASIAN_HANDICAP", "HANDICAP", "SPREAD", "asian_handicap", "ALTERNATE_SPREAD", "alternate_spreads"].includes(marketKey)) {
    const m = name.match(/([+-]?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const handicap = Number(m[1]);
    if (Number.isNaN(handicap)) return null;
    const homeName = game.homeName.toLowerCase();
    const awayName = game.awayName.toLowerCase();
    const backedHome =
      name.includes(homeName) || label === "1" || label === "home" || name.startsWith("home");
    const backedAway =
      name.includes(awayName) || label === "2" || label === "away" || name.startsWith("away");
    if (!backedHome && !backedAway) return null;

    const single = (h: number): Result => {
      const adj = backedHome ? home + h : away + h;
      const opp = backedHome ? away : home;
      if (adj === opp) return "VOID"; // push → stake refund
      return adj > opp ? "WON" : "LOST";
    };

    const frac = Math.abs(handicap % 1);
    if (frac === 0.25 || frac === 0.75) {
      // Quarter line → split into the two neighbouring half handicaps
      const lower = handicap - Math.sign(handicap) * 0.25;
      const upper = handicap + Math.sign(handicap) * 0.25;
      const a = single(lower);
      const b = single(upper);
      if (a === b) return a; // both halves agree → clean WON / LOST / VOID
      return null; // half-win/half-push etc. → admin settles manually
    }
    return single(handicap);
  }

  // ── Goal parity (Even / Odd total goals) ───────────────────
  if (["GOAL_PARITY", "goal_parity", "GOAL_ODD_EVEN"].includes(marketKey)) {
    const total = home + away;
    if (name === "even" || name === "e") return total % 2 === 0 ? "WON" : "LOST";
    if (name === "odd" || name === "o") return total % 2 === 1 ? "WON" : "LOST";
    return null;
  }

  // ── Both teams to score ─────────────────────────────────────
  if (marketKey === "BTTS") {
    const both = home > 0 && away > 0;
    if (name === "yes" || name === "y") return both ? "WON" : "LOST";
    if (name === "no" || name === "n") return both ? "LOST" : "WON";
    return null;
  }

  // ── Correct score (e.g. "2-1") ──────────────────────────────
  if (marketKey === "CORRECT_SCORE") {
    const m = name.match(/^(\d+)\s*[-:]\s*(\d+)$/);
    if (!m) return null;
    const [h, a] = [Number(m[1]), Number(m[2])];
    if (h === home && a === away) return "WON";
    return "LOST";
  }

  // ── European Handicap — 3-way integer line (−1) ─────────────
  //    Home −1 wins on d ≥ 2, Draw wins on d = 1, Away +1 wins on d ≤ 0.
  if (marketKey === "EUROPEAN_HANDICAP") {
    const d = home - away;
    if (label === "1" || /-\d+(\.0+)?$/.test(name)) return d >= 2 ? "WON" : "LOST";
    if (label === "x" || name === "draw") return d === 1 ? "WON" : "LOST";
    if (label === "2" || /\+\d+(\.0+)?$/.test(name)) return d <= 0 ? "WON" : "LOST";
    return null;
  }

  // ── Win to Nil — team wins AND keeps a clean sheet ──────────
  if (marketKey === "WIN_TO_NIL") {
    const homeWtn = r === "H" && away === 0;
    const awayWtn = r === "A" && home === 0;
    if (label === "1") return homeWtn ? "WON" : "LOST";
    if (label === "2") return awayWtn ? "WON" : "LOST";
    if (label === "x" || name === "neither") return homeWtn || awayWtn ? "LOST" : "WON";
    return null;
  }

  // ── Clean Sheet — home/away clean sheet or concede ──────────
  if (marketKey === "CLEAN_SHEET") {
    const homeNameL = game.homeName.toLowerCase();
    const awayNameL = game.awayName.toLowerCase();
    const isHome = name.includes(homeNameL) || label === "1";
    const isAway = name.includes(awayNameL) || label === "2";
    const clean = name.includes("clean sheet");
    const concede = name.includes("concede");
    if (!isHome && !isAway) return null;
    if (isHome && clean) return away === 0 ? "WON" : "LOST";
    if (isHome && concede) return away > 0 ? "WON" : "LOST";
    if (isAway && clean) return home === 0 ? "WON" : "LOST";
    if (isAway && concede) return home > 0 ? "WON" : "LOST";
    return null;
  }

  // ── Multi-Goals — Betika goal ranges (1-2 / 2-3 / 3-5 / 6+) ─
  if (marketKey === "MULTI_GOALS") {
    const total = home + away;
    const m = name.match(/^(\d+)\s*-\s*(\d+)\s*goals?$/);
    if (m) {
      const [lo, hi] = [Number(m[1]), Number(m[2])];
      return total >= lo && total <= hi ? "WON" : "LOST";
    }
    if (/^6\+\s*goals?$/.test(name)) return total >= 6 ? "WON" : "LOST";
    return null;
  }

  // ── 1st Half BTTS — settles off the half-time score when the
  //    feed populated it; never guesses from the full-time score. ──
  if (marketKey === "FIRST_HALF_BTTS") {
    if (game.halfHomeScore == null || game.halfAwayScore == null) return null;
    const both1H = Number(game.halfHomeScore) > 0 && Number(game.halfAwayScore) > 0;
    if (name === "yes") return both1H ? "WON" : "LOST";
    if (name === "no") return both1H ? "LOST" : "WON";
    return null;
  }

  // ── Highest Scoring Half — needs half-time scores ───────────
  if (marketKey === "HIGHEST_SCORING_HALF") {
    if (game.halfHomeScore == null || game.halfAwayScore == null) return null;
    const ht1 = Number(game.halfHomeScore) + Number(game.halfAwayScore);
    const ht2 = home + away - ht1;
    if (label === "1" || name === "1st half") return ht1 > ht2 ? "WON" : "LOST";
    if (label === "x" || name === "tie") return ht1 === ht2 ? "WON" : "LOST";
    if (label === "2" || name === "2nd half") return ht2 > ht1 ? "WON" : "LOST";
    return null;
  }

  // ── Half-Time / Full-Time (1/1 … 2/2) — needs half-time score ─
  if (marketKey === "HT_FT") {
    if (game.halfHomeScore == null || game.halfAwayScore == null) return null;
    const htDiff = Number(game.halfHomeScore) - Number(game.halfAwayScore);
    const htR = htDiff > 0 ? "1" : htDiff < 0 ? "2" : "X";
    const ftR = r === "H" ? "1" : r === "A" ? "2" : "X";
    const expected = `${htR}/${ftR}`.toLowerCase();
    if (/^[12x]\/[12x]$/.test(name)) return name === expected ? "WON" : "LOST";
    return null;
  }

  return null; // unknown market — leave to admin
}
