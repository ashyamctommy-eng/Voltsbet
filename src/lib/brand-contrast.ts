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
