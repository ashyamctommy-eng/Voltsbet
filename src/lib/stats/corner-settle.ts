/**
 * Corner-market resolver — the piece the goal-based `resolveOutcome` cannot do.
 *
 * Corner counts come from the stats feed (per team), so these markets can be
 * settled by machine:
 *   TOTAL_CORNERS      Over/Under on the match corner total (push → VOID)
 *   TEAM_CORNERS       Over/Under on one team's corners (name carries the team)
 *   CORNERS_1X2        Most corners (Draw resolves as Draw)
 *   CORNERS_HANDICAP   Corner handicap (quarter lines split; mixed → null)
 *
 * NOT auto-settled, on purpose:
 *   TOTAL_BOOKINGS / CARDS_HANDICAP — "cards" counting conventions differ
 *   (yellow+red as 1 each? booking points 10/25? red = 2?), so a machine that
 *   guesses would pay the wrong side. They stay in the admin review queue.
 */
import { normalizeTeamName } from "./match";

export type CornerResult = "WON" | "LOST" | "VOID" | null;

export type CornerScores = {
  homeCorners: number | null;
  awayCorners: number | null;
  homeName: string;
  awayName: string;
};

function lineFrom(name: string): number | null {
  const m = name.match(/[\d.]+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

const isQuarter = (line: number) => Math.abs(line % 1) === 0.25 || Math.abs(line % 1) === 0.75;

/** Over/Under on a value. Whole-line push → VOID; quarter lines → null (Asian split). */
function overUnder(value: number, line: number, isOver: boolean, isUnder: boolean): CornerResult {
  if (!isOver && !isUnder) return null;
  if (isQuarter(line)) return null; // half-win/half-push can't be modelled → admin
  if (value === line) return "VOID";
  if (isOver) return value > line ? "WON" : "LOST";
  return value < line ? "WON" : "LOST";
}

/** Which side does this outcome refer to? 1 = home, 2 = away, 0 = neither/ambiguous. */
function side(outcomeName: string, label: string | null, g: CornerScores): 1 | 2 | 0 {
  // Normalize the OUTCOME name too — provider names carry accents ("Fenerbahçe")
  // that never match a plain-lowercase comparison against our team names.
  const n = normalizeTeamName(outcomeName);
  const home = normalizeTeamName(g.homeName);
  const away = normalizeTeamName(g.awayName);
  const hits = (team: string) => {
    if (!team) return false;
    const first = team.split(" ")[0];
    return n.includes(team) || (first.length >= 4 && n.includes(first));
  };
  const homeHit = hits(home);
  const awayHit = hits(away);
  if (homeHit && !awayHit) return 1;
  if (awayHit && !homeHit) return 2;
  if (homeHit && awayHit) return 0; // ambiguous (shared token) → admin
  if (label === "1" || label === "home") return 1;
  if (label === "2" || label === "away") return 2;
  return 0;
}

export function resolveCornerOutcome(
  g: CornerScores,
  marketKey: string,
  outcomeName: string,
  outcomeLabel: string | null,
): CornerResult {
  const name = outcomeName.toLowerCase().trim(); // raw: lines, over/under, draw
  const label = (outcomeLabel ?? "").toLowerCase();
  const total = g.homeCorners != null && g.awayCorners != null ? g.homeCorners + g.awayCorners : null;

  // ── Total corners Over/Under ────────────────────────────────
  if (marketKey === "TOTAL_CORNERS") {
    if (total == null) return null;
    const line = lineFrom(name);
    if (line == null) return null;
    return overUnder(total, line, name.startsWith("over"), name.startsWith("under"));
  }

  // ── One team's corners Over/Under ("Arsenal Over 4.5") ──────
  if (marketKey === "TEAM_CORNERS") {
    const s = side(outcomeName, label, g);
    if (s === 0) return null;
    const value = s === 1 ? g.homeCorners : g.awayCorners;
    if (value == null) return null;
    const line = lineFrom(name);
    if (line == null) return null;
    return overUnder(value, line, /\bover\b/.test(name), /\bunder\b/.test(name));
  }

  // ── Most corners (1X2) ─────────────────────────────────────
  if (marketKey === "CORNERS_1X2") {
    if (g.homeCorners == null || g.awayCorners == null) return null;
    const s = side(outcomeName, label, g);
    const isDraw = label === "x" || name === "draw" || name === "tie";
    if (!isDraw && s === 0) return null;
    const diff = g.homeCorners - g.awayCorners;
    if (isDraw) return diff === 0 ? "WON" : "LOST";
    if (s === 1) return diff > 0 ? "WON" : "LOST";
    return diff < 0 ? "WON" : "LOST";
  }

  // ── Corner handicap ("Home -1.5" / "Arsenal -2") ────────────
  if (marketKey === "CORNERS_HANDICAP") {
    if (g.homeCorners == null || g.awayCorners == null) return null;
    const m = name.match(/([+-]?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const handicap = Number(m[1]);
    if (!Number.isFinite(handicap)) return null;
    const backed = m[0].trim().length === name.trim().length ? 0 : side(outcomeName, label, g);
    if (backed === 0) return null;

    const single = (h: number): CornerResult => {
      const adj = backed === 1 ? g.homeCorners! + h : g.awayCorners! + h;
      const opp = backed === 1 ? g.awayCorners! : g.homeCorners!;
      if (adj === opp) return "VOID";
      return adj > opp ? "WON" : "LOST";
    };
    if (isQuarter(handicap)) {
      const lower = handicap - Math.sign(handicap) * 0.25;
      const upper = handicap + Math.sign(handicap) * 0.25;
      const a = single(lower);
      const b = single(upper);
      if (a === b) return a;
      return null;
    }
    return single(handicap);
  }

  return null; // cards, unknown keys → admin review (never guess)
}

/**
 * Orient the feed's per-team corner counts onto OUR home/away sides.
 * Returns null when the teams can't be matched safely — settlement must not
 * happen on a guessed orientation.
 */
export function cornerScores(
  stats: { team: string; corners: number | null }[],
  game: { homeName: string; awayName: string },
): { homeCorners: number | null; awayCorners: number | null } | null {
  const home = normalizeTeamName(game.homeName);
  const away = normalizeTeamName(game.awayName);
  const find = (want: string) => {
    const hit = stats.find((s) => {
      const got = normalizeTeamName(s.team);
      if (!got || !want) return false;
      return got === want || got.includes(want) || want.includes(got.split(" ")[0]);
    });
    return hit?.corners ?? null;
  };
  const h = find(home);
  const a = find(away);
  if (h == null && a == null) return null;
  return { homeCorners: h, awayCorners: a };
}
