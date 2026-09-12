import { describe, expect, it, vi } from "vitest";

// banner-cta imports prisma at module load; stub it so the pure parsing logic
// can be tested without a database.
vi.mock("@/lib/prisma", () => ({ prisma: { game: { findMany: vi.fn() } } }));

import { gameIdFromCta, sanitizeBannerCtas, BANNER_CTA_FALLBACK } from "@/lib/banner-cta";
import { prisma } from "@/lib/prisma";

describe("gameIdFromCta", () => {
  it("extracts the game id from both route spellings", () => {
    expect(gameIdFromCta("/match/abc123")).toBe("abc123");
    expect(gameIdFromCta("/fixture/abc123")).toBe("abc123");
    expect(gameIdFromCta("/fixture/cmtlfmcxz05fbn901g3t142c9/")).toBe("cmtlfmcxz05fbn901g3t142c9");
  });

  it("leaves non-game destinations alone", () => {
    expect(gameIdFromCta("/register")).toBeNull();
    expect(gameIdFromCta("/live")).toBeNull();
    expect(gameIdFromCta("/sports/football")).toBeNull();
    expect(gameIdFromCta("")).toBeNull();
    expect(gameIdFromCta(null)).toBeNull();
    expect(gameIdFromCta(undefined)).toBeNull();
    // must not be fooled by a game path appearing mid-string
    expect(gameIdFromCta("https://evil.test/match/abc")).toBeNull();
    expect(gameIdFromCta("/match/")).toBeNull();
  });
});

describe("sanitizeBannerCtas", () => {
  const banners = [
    { id: "b1", ctaUrl: "/register" },
    { id: "b2", ctaUrl: "/match/gone" },
    { id: "b3", ctaUrl: "/fixture/alive" },
  ];

  it("rewrites only the CTA whose game is missing", async () => {
    (prisma.game.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "alive" }]);
    const out = await sanitizeBannerCtas(banners);
    expect(out.map((b) => b.ctaUrl)).toEqual(["/register", BANNER_CTA_FALLBACK, "/fixture/alive"]);
    expect(banners[1].ctaUrl).toBe("/match/gone"); // input not mutated
  });

  it("skips the query entirely when no banner targets a game", async () => {
    const spy = prisma.game.findMany as unknown as ReturnType<typeof vi.fn>;
    spy.mockClear();
    await sanitizeBannerCtas([{ id: "b1", ctaUrl: "/register" }]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("leaves CTAs untouched if the lookup fails, rather than inventing a destination", async () => {
    (prisma.game.findMany as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));
    const out = await sanitizeBannerCtas(banners);
    expect(out.map((b) => b.ctaUrl)).toEqual(["/register", "/match/gone", "/fixture/alive"]);
  });
});
