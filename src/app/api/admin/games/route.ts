import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf, auditLog, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const GET = handle(async (req: NextRequest) => {
  await requireAdmin("games");
  const sportId = req.nextUrl.searchParams.get("sportId") ?? undefined;
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const games = await prisma.game.findMany({
    where: { ...(sportId ? { sportId } : {}), ...(status ? { status } : {}) },
    include: {
      sport: true,
      _count: { select: { markets: true } },
    },
    orderBy: [{ startAt: "asc" }],
    take: 200,
  });
  return ok({ games });
});

const createSchema = z.object({
  sportId: z.string().min(1),
  competitionId: z.string().optional().default(""),
  homeName: z.string().min(1),
  awayName: z.string().min(1),
  homeLogo: z.string().optional().default(""),
  awayLogo: z.string().optional().default(""),
  startAt: z.string().min(1, "Date/time is required"),
  status: z.string().optional().default("SCHEDULED"),
  featured: z.boolean().optional().default(false),
  description: z.string().optional().default(""),
});

export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("games");
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");
  const d = parsed.data;

  const sport = await prisma.sport.findUnique({ where: { id: d.sportId } });
  if (!sport) throw new ApiError(400, "Unknown sport.", "BAD_SPORT");

  let comp = null;
  if (d.competitionId) {
    comp = await prisma.competition.findUnique({ where: { id: d.competitionId } });
    if (!comp) throw new ApiError(400, "Unknown competition.", "BAD_COMPETITION");
  }

  const game = await prisma.game.create({
    data: {
      sportId: d.sportId,
      competitionId: comp?.id ?? null,
      competitionName: (comp?.name ?? d.description) || null,
      homeName: d.homeName.trim(),
      awayName: d.awayName.trim(),
      homeLogo: d.homeLogo || null,
      awayLogo: d.awayLogo || null,
      startAt: new Date(d.startAt),
      status: d.status,
      featured: d.featured,
      source: "MANUAL",
    },
  });

  await auditLog({ admin, action: "CREATE", entity: "GAME", entityId: game.id, newValue: { home: game.homeName, away: game.awayName } });
  return ok({ game });
});
