/**
 * Global outcome color tokens — ONE semantic source of truth for the side
 * colors used wherever odds render (OddsButton, match cards, feeds, the
 * fixture accordion, hero slideshow).
 *
 * Product mapping (competing sides are always visually distinct):
 *   Option 1 / side A — Home · Team 1 · Under · Yes · "1"   → emerald
 *   Option 3 / middle — Draw · "X"                           → amber
 *   Option 2 / side B — Away · Team 2 · Over · No · "2"      → sky
 *
 * Returns null (neutral → caller keeps its brand default) when the outcome
 * has no competing side: player lists, goal ranges, untyped lists.
 *
 * Class literals live verbatim here so Tailwind v4's scanner picks them up.
 */
export type OutcomeSide = "first" | "second" | "draw";

export const SIDE_TEXT_CLASS: Record<OutcomeSide, string> = {
  first: "text-emerald-400",
  second: "text-sky-400",
  draw: "text-amber-400",
};

export function sideTextClass(side: OutcomeSide | null | undefined): string | null {
  return side ? SIDE_TEXT_CLASS[side] : null;
}

/**
 * Resolve an outcome's side from its label/name against the fixture's team
 * names. Priority: label ("1"/"X"/"2") → HT/FT leg → correct-score diff →
 * double chance → Yes/No → Odd/Even → Draw → Over/Under (anywhere in the
 * name, so team-totals like "Arsenal Over 1.5" color by line) → team match.
 */
export function outcomeSide(o: {
  label?: string | null;
  name?: string | null;
  home?: string | null;
  away?: string | null;
}): OutcomeSide | null {
  const label = (o.label ?? "").trim().toLowerCase();
  if (label === "1" || label === "h" || label === "home") return "first";
  if (label === "2" || label === "a" || label === "away") return "second";
  if (label === "x" || label === "draw") return "draw";

  const name = (o.name ?? "").trim().toLowerCase();
  if (!name) return null;

  // HT/FT ("1/X", "2/1", "X/X") — color by the first-half leg.
  const htft = name.match(/^([12x])\s*\//);
  if (htft) return htft[1] === "1" ? "first" : htft[1] === "2" ? "second" : "draw";

  // Correct score "2-1" (home score first) — color by who wins.
  const cs = name.match(/^(\d{1,2})-(\d{1,2})$/);
  if (cs) {
    const h = Number(cs[1]);
    const a = Number(cs[2]);
    return h > a ? "first" : a > h ? "second" : "draw";
  }

  // Double chance ("1X" = home or draw, "X2" = away or draw, "12" = either).
  if (name === "1x" || name === "x1") return "first";
  if (name === "x2" || name === "2x") return "second";
  if (name === "12") return "draw";

  // BTTS / parity / simple booleans.
  if (name === "yes" || name === "true") return "first";
  if (name === "no" || name === "false") return "second";
  if (name === "odd") return "first"; // odd/even total goals
  if (name === "even") return "second";
  if (/^(draw|tie|x)$/.test(name)) return "draw";

  // Totals / team totals — line direction beats position: "Over …" = side B
  // (sky), "Under …" = side A (emerald), incl. "Arsenal Over 1.5".
  if (/\bover\b/.test(name)) return "second";
  if (/\bunder\b/.test(name)) return "first";

  // Team sides — compare to the fixture's participants (guard short tokens).
  const home = (o.home ?? "").trim().toLowerCase();
  const away = (o.away ?? "").trim().toLowerCase();
  if (home && home.length >= 3 && name.startsWith(home)) return "first";
  if (away && away.length >= 3 && name.startsWith(away)) return "second";
  return null;
}
