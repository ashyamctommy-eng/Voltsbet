import { describe, expect, it } from "vitest";
import { onBrandColor, brandGlow, ON_BRAND_DARK, ON_BRAND_LIGHT } from "@/lib/brand-contrast";

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
