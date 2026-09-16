import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { handle, ok, auditLog, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "games");
  const sportId = req.nextUrl.searchParams.get("sportId") ?? undefined;
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  // Stale-fixture guard: upcoming-only statuses (and the "All statuses"
  // default view) never list fixtures whose kickoff is already in the past —
  // older syncs leave SCHEDULED rows with historical dates ("19 Aug") that
  // cluttered the management list. LIVE / HALF_TIME / FINISHED legitimately
  // started in the past and stay visible.
  //
  // MANUAL rows are exempt. An admin-created fixture has no feed to advance it,
  // so once its kickoff passed while still SCHEDULED it matched no filter at
  // all — "All statuses" and "SCHEDULED" both hid it and no other status
  // applied, so the operator could not open their own match to enter the
  // result. That stranded the real bets riding on it.
  const EXCLUDE_PAST_STATUSES = new Set(["SCHEDULED", "POSTPONED"]);
  const excludePast = !status || EXCLUDE_PAST_STATUSES.has(status);
  // AND, not two top-level ORs: the stale guard and the search each need their
  // own OR, and a second top-level OR would silently replace the first — which
  // is how a search would resurrect the stale rows the guard exists to hide.
  const and: Prisma.GameWhereInput[] = [];
  if (excludePast) {
    and.push({ OR: [{ startAt: { gte: new Date() } }, { source: "MANUAL" }] });
  }
  if (q) {
    and.push({
      OR: [
        { homeName: { contains: q, mode: "insensitive" } },
        { awayName: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  const games = await prisma.game.findMany({
    where: {
      ...(sportId ? { sportId } : {}),
      ...(status ? { status } : {}),
      ...(and.length ? { AND: and } : {}),
    },
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
  status: z.enum(["SCHEDULED", "LIVE", "HALF_TIME", "FINISHED", "CANCELLED", "POSTPONED"]).optional().default("SCHEDULED"),
  featured: z.boolean().optional().default(false),
  description: z.string().optional().default(""),
});

export const POST = handle(async (req: NextRequest) => {
  const admin = await sharedAdminGuard(req, "games");
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
