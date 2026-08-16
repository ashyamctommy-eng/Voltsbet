import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handle(async (req: NextRequest) => {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return ok({ sports: [], competitions: [], teams: [], games: [] });

  const [sports, competitions, teams, games] = await Promise.all([
    prisma.sport.findMany({ where: { name: { contains: q } }, take: 5 }),
    prisma.competition.findMany({ where: { name: { contains: q } }, take: 5 }),
    prisma.team.findMany({ where: { name: { contains: q } }, take: 8 }),
    prisma.game.findMany({
      where: { OR: [{ homeName: { contains: q } }, { awayName: { contains: q } }] },
      include: { sport: true },
      take: 8,
      orderBy: { startAt: "asc" },
    }),
  ]);

  return ok({ sports, competitions, teams, games });
});
