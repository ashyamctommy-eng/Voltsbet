import { NextRequest } from "next/server";
import { handle, ok, requireAdmin } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handle(async (req: NextRequest) => {
  await requireAdmin("games");
  const sportId = req.nextUrl.searchParams.get("sportId") ?? "";
  const competitions = await prisma.competition.findMany({
    where: sportId ? { sportId } : {},
    orderBy: { name: "asc" },
  });
  return ok({ competitions });
});
