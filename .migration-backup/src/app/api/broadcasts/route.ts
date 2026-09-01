import { handle, ok } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/broadcasts — announcements for the current viewer.
 * Logged-out visitors get global (ALL) broadcasts; logged-in users also get
 * ones targeted at their user id. The client banner polls this endpoint.
 */
export const GET = handle(async () => {
  const user = await getCurrentUser();
  const broadcasts = await prisma.broadcast.findMany({
    where: user
      ? { OR: [{ targetType: "ALL" }, { targetType: "USER", userId: user.id }] }
      : { targetType: "ALL" },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return ok({ broadcasts });
});
