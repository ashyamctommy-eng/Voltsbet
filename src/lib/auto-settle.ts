import { prisma } from "./prisma";
import { settleOutcome } from "./settle";
import { getSettings } from "./settings";

/**
 * Auto-settlement — resolves finished games' markets from the final score and
 * settles every outcome it can determine with certainty. Unresolvable markets
 * (correct score with unusual names, unknown keys, live edges) are skipped and
 * stay for admin review — auto-settlement never guesses.
 *
 * Run via GET/POST /api/cron/settle (bearer cron.secret) on any schedule.
 */

const SYSTEM_ACTOR = { id: "system", username: "system" } as const;

type Result = "WON" | "LOST" | null; // null = cannot determine → skip

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
        if (!result) continue;
        try {
          await settleOutcome(SYSTEM_ACTOR, outcome.id, result);
          settled.push(`${game.homeName} vs ${game.awayName} · ${market.name} · ${outcome.name}`);
        } catch {
          // outcome may have been settled by another run / admin in between
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

function resolveOutcome(
  game: { homeScore: number; awayScore: number; homeName: string; awayName: string },
  marketKey: string,
  outcomeName: string,
  outcomeLabel: string | null,
): Result {
  const r = gameResult(game);
  if (!r) return null;
  const name = outcomeName.toLowerCase().trim();
  const label = (outcomeLabel ?? "").toLowerCase();

  // ── Match result family (1 / X / 2) ─────────────────────────
  if (["MATCH_RESULT", "h2h", "HT_RESULT", "DRAW_NO_BET"].includes(marketKey)) {
    const isHome = label === "1" || name === game.homeName.toLowerCase();
    const isAway = label === "2" || name === game.awayName.toLowerCase();
    const isDraw = label === "x" || name === "draw";
    if (marketKey === "DRAW_NO_BET" && r === "D") return null; // DNB pushes on draw — admin/void path
    if (isHome) return r === "H" ? "WON" : "LOST";
    if (isAway) return r === "A" ? "WON" : "LOST";
    if (isDraw) return r === "D" ? "WON" : "LOST";
    return null;
  }

  // ── Double chance (1X / X2 / 12) ────────────────────────────
  if (marketKey === "DOUBLE_CHANCE") {
    if (name === "1x") return r === "H" || r === "D" ? "WON" : "LOST";
    if (name === "x2") return r === "A" || r === "D" ? "WON" : "LOST";
    if (name === "12") return r !== "D" ? "WON" : "LOST";
    return null;
  }

  // ── Over / Under totals ─────────────────────────────────────
  if (marketKey === "OVER_UNDER" || marketKey === "totals") {
    const line = Number(name.match(/[\d.]+/)?.[0]);
    if (!line || Number.isNaN(line)) return null;
    const total = Number(game.homeScore) + Number(game.awayScore);
    if (name.startsWith("over")) return total > line ? "WON" : "LOST";
    if (name.startsWith("under")) return total < line ? "WON" : "LOST";
    return null;
  }

  // ── Both teams to score ─────────────────────────────────────
  if (marketKey === "BTTS") {
    const both = Number(game.homeScore) > 0 && Number(game.awayScore) > 0;
    if (name === "yes" || name === "y") return both ? "WON" : "LOST";
    if (name === "no" || name === "n") return both ? "LOST" : "WON";
    return null;
  }

  // ── Correct score (e.g. "2-1") ──────────────────────────────
  if (marketKey === "CORRECT_SCORE") {
    const m = name.match(/^(\d+)\s*[-:]\s*(\d+)$/);
    if (!m) return null;
    const [h, a] = [Number(m[1]), Number(m[2])];
    if (h === Number(game.homeScore) && a === Number(game.awayScore)) return "WON";
    return "LOST";
  }

  return null; // unknown market — leave to admin
}
