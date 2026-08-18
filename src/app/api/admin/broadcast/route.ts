import { NextRequest } from "next/server";
import { handle, ok, ApiError, requireAdmin, verifyCsrf, auditLog } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/**
 * Admin broadcast announcements.
 *
 * POST /api/admin/broadcast  — create a broadcast (ALL users or targeted at one
 *                              user by id). Mirrored into the notification
 *                              center (type=ANNOUNCEMENT) so unread counts and
 *                              the bell dropdown stay consistent.
 * GET  /api/admin/broadcast  — recent broadcasts (admin drawer history).
 */
export const GET = handle(async () => {
  const admin = await requireAdmin("notifications");
  const broadcasts = await prisma.broadcast.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { user: { select: { username: true, email: true } } },
  });
  void admin;
  return ok({ broadcasts });
});

export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("notifications");

  const body = await req.json().catch(() => null);
  const title = String(body?.title ?? "").trim();
  const message = String(body?.message ?? "").trim();
  if (!title || !message) {
    throw new ApiError(400, "title and message are required.", "VALIDATION");
  }

  const targetType = body?.targetType === "USER" ? "USER" : "ALL";
  const userId = targetType === "USER" ? String(body?.userId ?? "").trim() : null;
  if (targetType === "USER" && !userId) {
    throw new ApiError(400, "userId is required for USER-targeted broadcasts.", "VALIDATION");
  }
  if (targetType === "USER") {
    const target = await prisma.user.findUnique({ where: { id: userId! } });
    if (!target) throw new ApiError(404, "Target user not found.", "NOT_FOUND");
  }

  const broadcast = await prisma.broadcast.create({
    data: { title, message, targetType, userId, createdBy: admin.id },
  });

  // Mirror into the existing notification center (bell + unread badge).
  await prisma.notification.create({
    data: { title, message, type: "ANNOUNCEMENT", userId },
  });

  await auditLog({
    admin,
    action: "CREATE",
    entity: "BROADCAST",
    entityId: broadcast.id,
    newValue: { targetType, userId },
  });

  return ok({ broadcast });
});
