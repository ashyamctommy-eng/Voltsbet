import { NextRequest } from "next/server";
import { handle, ok, ApiError, auditLog, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { removeBroadcastMeta, setBroadcastMeta } from "@/lib/broadcasts";

/**
 * PATCH  /api/admin/broadcast/[id] — deactivate/reactivate or re-time a broadcast
 *                                    (keeps the history entry).
 * DELETE /api/admin/broadcast/[id] — remove it for good, including the
 *                                    mirrored notification-centre rows.
 */
export const dynamic = "force-dynamic";

export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "notifications");
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as
    | { active?: boolean; expiresAt?: string | null; clearExpiry?: boolean }
    | null;
  if (!body) throw new ApiError(400, "Send a JSON body.", "BAD_BODY");

  const exists = await prisma.broadcast.findUnique({ where: { id }, select: { id: true, title: true } });
  if (!exists) throw new ApiError(404, "Broadcast not found.", "NOT_FOUND");

  const patch: { active?: boolean; expiresAt?: string | null } = {};
  if (typeof body.active === "boolean") patch.active = body.active;
  if (body.clearExpiry) patch.expiresAt = null;
  else if (body.expiresAt !== undefined) {
    const d = new Date(String(body.expiresAt));
    if (Number.isNaN(d.getTime())) throw new ApiError(400, "expiresAt must be an ISO date.", "BAD_EXPIRY");
    patch.expiresAt = d.toISOString();
  }
  if (!Object.keys(patch).length) throw new ApiError(400, "Nothing to update.", "BAD_BODY");

  await setBroadcastMeta(id, patch);
  await auditLog({
    admin,
    action: "BROADCAST",
    entity: "BROADCAST",
    entityId: id,
    newValue: { ...patch, title: exists.title },
  });
  return ok({
    id,
    ...patch,
    message: patch.active === false ? "Broadcast deactivated" : patch.active === true ? "Broadcast reactivated" : "Broadcast expiry updated",
  });
});

export const DELETE = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await sharedAdminGuard(req, "notifications");
  const { id } = await ctx.params;

  const broadcast = await prisma.broadcast.findUnique({ where: { id } });
  if (!broadcast) throw new ApiError(404, "Broadcast not found.", "NOT_FOUND");

  await prisma.broadcast.delete({ where: { id } });
  await removeBroadcastMeta(id);

  // Remove the notification-centre mirror so the bell doesn't keep a copy.
  const removedNotifications = await prisma.notification.deleteMany({
    where: {
      type: "ANNOUNCEMENT",
      title: broadcast.title,
      message: broadcast.message,
      ...(broadcast.targetType === "ALL" ? { userId: null } : {}),
    },
  });

  await auditLog({
    admin,
    action: "BROADCAST_DELETE",
    entity: "BROADCAST",
    entityId: id,
    prevValue: { title: broadcast.title, message: broadcast.message },
    newValue: { notificationsRemoved: removedNotifications.count },
  });
  return ok({ deleted: true, notificationsRemoved: removedNotifications.count, message: "Broadcast deleted" });
});
