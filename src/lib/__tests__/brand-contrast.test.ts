import { describe, expect, it } from "vitest";
import {
  onBrandColor,
  brandGlow,
  brandTextColor,
  contrastRatio,
  ON_BRAND_DARK,
  ON_BRAND_LIGHT,
} from "@/lib/brand-contrast";

describe("onBrandColor", () => {
  // The whole point of this helper: the app used to hardcode dark-green ink on
  // every bg-brand fill. These cases pin the behaviour per client template so a
  // palette can't silently ship unreadable buttons.
  it("keeps dark ink for the bright brands the app was designed around", () => {
    expect(onBrandColor("#00e676")).toBe(ON_BRAND_DARK); // Volt Green
    expect(onBrandColor("#a3e635")).toBe(ON_BRAND_DARK); // Citrus Lime
    expect(onBrandColor("#fb923c")).toBe(ON_BRAND_DARK); // Sunset orange
  });

  it("switches to white ink for dark brands", () => {
    expect(onBrandColor("#4f7cff")).toBe(ON_BRAND_LIGHT); // Sapphire
    expect(onBrandColor("#8b5cf6")).toBe(ON_BRAND_LIGHT); // Royal Violet
    expect(onBrandColor("#000000")).toBe(ON_BRAND_LIGHT);
  });

  it("accepts shorthand hex and stray whitespace", () => {
    expect(onBrandColor(" #0f0 ")).toBe(ON_BRAND_DARK);
    // A near-white brand takes the dark ink — white-on-white would vanish.
    expect(onBrandColor("#fff")).toBe(ON_BRAND_DARK);
  });

  it("falls back to the historical dark ink on junk, never white", () => {
    // A half-typed value in the admin field must not flash white text.
    for (const bad of ["", "#", "00e676", "not-a-colour", "#12345", "#gggggg"]) {
      expect(onBrandColor(bad)).toBe(ON_BRAND_DARK);
    }
    expect(onBrandColor(null)).toBe(ON_BRAND_DARK);
    expect(onBrandColor(undefined)).toBe(ON_BRAND_DARK);
  });

  it("only ever returns one of the two known inks", () => {
    for (const hex of ["#00e676", "#4f7cff", "#8b5cf6", "#14b8a6", "#ec4899", "#808080"]) {
      expect([ON_BRAND_DARK, ON_BRAND_LIGHT]).toContain(onBrandColor(hex));
    }
  });
});

describe("brandGlow", () => {
  it("tints the marketing glow with the brand rather than the old green", () => {
    expect(brandGlow("#8b5cf6")).toBe("rgba(139, 92, 246, 0.35)");
    expect(brandGlow("#8b5cf6", 0.5)).toBe("rgba(139, 92, 246, 0.5)");
  });

  it("falls back to the default green for an unparseable value", () => {
    expect(brandGlow("nonsense")).toBe("rgba(0, 230, 118, 0.35)");
  });
});

describe("contrastRatio", () => {
  it("matches known WCAG anchors", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("brandTextColor (proposal 02)", () => {
  const LIGHT = "#ffffff";
  const DARK = "#0b0e14";

  // The actual defect being fixed: every shipped template failed AA as text on
  // the light surface. These cases assert the invariant, not specific hexes.
  it("makes every shipped template readable as text on the light surface", () => {
    for (const brand of ["#00e676", "#a3e635", "#fb923c", "#14b8a6", "#4f7cff", "#8b5cf6", "#ec4899"]) {
      const fixed = brandTextColor(brand, LIGHT);
      expect(contrastRatio(fixed, LIGHT)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("makes every shipped template readable as text on the dark surface", () => {
    for (const brand of ["#00e676", "#a3e635", "#fb923c", "#14b8a6", "#4f7cff", "#8b5cf6", "#ec4899"]) {
      const fixed = brandTextColor(brand, DARK);
      expect(contrastRatio(fixed, DARK)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("leaves an already-passing brand untouched", () => {
    // Volt Green on the dark base already clears AA — don't tint what works.
    expect(contrastRatio("#00e676", DARK)).toBeGreaterThanOrEqual(4.5);
    expect(brandTextColor("#00e676", DARK)).toBe("#00e676");
  });

  it("darkens toward black on light and lightens toward white on dark", () => {
    const onLight = brandTextColor("#00e676", LIGHT);
    const onDark = brandTextColor("#00e676", DARK);
    // luminance ordering: light-surface variant must be darker than the raw,
    // dark-surface variant no darker than the raw
    const lum = (h: string) => {
      const n = parseInt(h.slice(1), 16);
      return ((n >> 16) & 255) * 0.2126 + ((n >> 8) & 255) * 0.7152 + (n & 255) * 0.0722;
    };
    expect(lum(onLight)).toBeLessThan(lum("#00e676"));
    expect(lum(onDark)).toBeGreaterThanOrEqual(lum("#00e676"));
  });

  it("never returns junk", () => {
    for (const bad of ["", "#", "nope", "#12345"]) {
      expect(brandTextColor(bad, LIGHT)).toMatch(/^#[0-9a-fA-F]{3,6}$/);
    }
  });
});
