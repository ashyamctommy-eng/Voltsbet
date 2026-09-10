import { NextRequest } from "next/server";
import { handle, ok, ApiError, auditLog, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/admin/notifications/[id]            — remove one notification
 * DELETE /api/admin/notifications/[id]?all=1      — remove every copy of the
 *   same announcement (the mirror created one row per recipient).
 */
export const dynamic = "force-dynamic";

export const DELETE = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "notifications");
  const { id } = await ctx.params;
  const all = req.nextUrl.searchParams.get("all") === "1";

  const row = await prisma.notification.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "Notification not found.", "NOT_FOUND");

  const removed = all
    ? await prisma.notification.deleteMany({ where: { type: "ANNOUNCEMENT", title: row.title, message: row.message } })
    : await prisma.notification.deleteMany({ where: { id } });

  await auditLog({
    admin,
    action: "ANNOUNCEMENT_DELETE",
    entity: "NOTIFICATION",
    entityId: id,
    prevValue: { title: row.title },
    newValue: { removed: removed.count, all },
  });
  return ok({ removed: removed.count, message: removed.count > 1 ? `Removed ${removed.count} copies` : "Message removed" });
});
