import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { sanitizeBannerCtas } from "@/lib/banner-cta";

/**
 * Public banner feed — serves the hero carousel on the home/match feeds.
 * Only active banners, sorted by sortOrder then creation time. The client
 * falls back to its built-in promo slides when this returns nothing.
 */
export const GET = handle(async (_req: NextRequest) => {
  const banners = await prisma.banner.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      description: true,
      image: true,
      ctaText: true,
      ctaUrl: true,
    },
  });
  // A CTA naming a game that no longer exists would 404 on click — rewrite it.
  return ok({ banners: await sanitizeBannerCtas(banners) });
});
