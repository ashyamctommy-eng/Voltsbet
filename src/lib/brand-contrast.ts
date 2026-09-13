/**
 * Readable text colour for a brand-coloured fill.
 *
 * The app paints a LOT of UI as `bg-brand` with dark text on top — odds cells,
 * market tabs, primary buttons, the logo tile, chat bubbles, pagination. That
 * text colour used to be hardcoded to `#052e16` (a very dark green), which was
 * invisible as a problem only because the brand was always green. The moment a
 * client installs a violet, blue or pink brand, every one of those labels turns
 * dark green on an unrelated hue and the book looks broken.
 *
 * So: pick the on-brand colour from the brand's luminance. Light brands get the
 * dark ink, dark brands get white — only two values, never an interpolated mix,
 * so the result stays a stable token.
 *
 * Why a luminance threshold and not "whichever has more contrast": for
 * mid-tone brands the two candidates are within a hair of each other (Sapphire
 * #4f7cff scores 4.02 vs white's 3.71 — both under the 4.5 bar, i.e. a genuine
 * coin flip), and the dark ink is green-tinted, so it reads as a hue clash on a
 * blue or violet brand. The threshold gives the result a designer expects:
 * light brand → dark text, dark brand → white text.
 */

/** The historical dark-green ink, kept as the default for a green brand. */
export const ON_BRAND_DARK = "#052e16";
/** The light alternative, for brands too dark to carry dark text. */
export const ON_BRAND_LIGHT = "#ffffff";

/** #rgb / #rrggbb → [r,g,b], or null when unparseable. */
function parseHex(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance — channels linearised, then weighted. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Luminance above which a brand counts as "light" and takes dark ink.
 * 0.35 sits in the gap between the two template families this app ships:
 * Aqua Teal at 0.372 and above take dark ink, Sapphire at 0.233 and below take
 * white. See brand-contrast.test.ts — the shipped palettes pin this number.
 */
const LIGHT_BRAND_THRESHOLD = 0.35;

/**
 * The text colour to place on a `bg-brand` fill.
 *
 * Returns the dark ink for light brands (the green/lime/orange family the app
 * was designed around) and white for dark brands (violet, blue, teal-dark).
 * Unparseable input falls back to the historical dark ink so a malformed admin
 * value degrades to today's behaviour instead of flashing white text.
 */
export function onBrandColor(brandHex: string | null | undefined): string {
  if (!brandHex) return ON_BRAND_DARK;
  const rgb = parseHex(brandHex);
  if (!rgb) return ON_BRAND_DARK;

  return relativeLuminance(rgb) > LIGHT_BRAND_THRESHOLD ? ON_BRAND_DARK : ON_BRAND_LIGHT;
}

/**
 * Same decision, but as a CSS colour usable inside `rgb(... / 0.35)`-style
 * effects that need the brand tinted rather than the ink. Used for the glows
 * that used to be hardcoded green.
 */
export function brandGlow(brandHex: string | null | undefined, alpha = 0.35): string {
  const rgb = parseHex(brandHex ?? "") ?? [0x00, 0xe6, 0x76];
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/** Mix two RGB triples; f=0 → a, f=1 → b. */
function blend(a: [number, number, number], b: [number, number, number], f: number): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

const hex = (c: [number, number, number]) =>
  "#" + c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");

/** WCAG contrast ratio between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const x = parseHex(a), y = parseHex(b);
  if (!x || !y) return 1;
  const [hi, lo] = relativeLuminance(x) > relativeLuminance(y)
    ? [relativeLuminance(x), relativeLuminance(y)]
    : [relativeLuminance(y), relativeLuminance(x)];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

/**
 * A version of the brand colour that is readable AS TEXT on `surfaceHex`.
 *
 * `text-brand-text` is used ~100 times for wordmarks, links and icons sitting on the
 * page or card surface. The raw brand clears 4.5:1 on the dark navy base for
 * most palettes but fails badly on the light theme — Volt Green measures 1.54:1
 * on #f4f6f8, Citrus 1.39:1. Mixing toward white on dark surfaces and toward
 * black on light ones lands on a hue-stable, AA-passing variant.
 *
 * Returns the raw brand when it already passes, so the common case is unchanged.
 */
export function brandTextColor(brandHex: string | null | undefined, surfaceHex: string, target = 4.5): string {
  const brand = parseHex(brandHex ?? "");
  const surface = parseHex(surfaceHex);
  if (!brand || !surface) return "#00e676";
  if (contrastRatio(brandHex as string, surfaceHex) >= target) return hex(brand).toLowerCase();

  const toward = relativeLuminance(surface) < 0.5 ? WHITE : BLACK;
  let best = brand;
  for (let f = 0.05; f <= 1.0001; f += 0.05) {
    const c = blend(brand, toward, f);
    best = c;
    if (contrastRatio(hex(c), surfaceHex) >= target) break;
  }
  return hex(best);
}

/** True when the brand is safe as text on the given surface (no adjustment). */
export function brandPassesAsText(brandHex: string | null | undefined, surfaceHex: string, target = 4.5): boolean {
  if (!brandHex) return false;
  return contrastRatio(brandHex, surfaceHex) >= target;
}
