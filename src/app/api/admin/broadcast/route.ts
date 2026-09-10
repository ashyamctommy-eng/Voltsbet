import { NextRequest } from "next/server";
import { handle, ok, ApiError, auditLog, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { audienceLabel, broadcastStatus } from "@/lib/broadcast-visibility";
import { broadcastTtlHours, getBroadcastMeta, setBroadcastMeta } from "@/lib/broadcasts";

/**
 * Admin broadcast announcements.
 *
 * POST /api/admin/broadcast  — create a broadcast (ALL users or targeted at one
 *                              user by id). Mirrored into the notification
 *                              center (type=ANNOUNCEMENT) so unread counts and
 *                              the bell dropdown stay consistent.
 * GET  /api/admin/broadcast  — recent broadcasts (admin drawer history).
 */
export const GET = handle(async (req: NextRequest) => {
  const admin = await sharedAdminGuard(req, "notifications");
  const [rows, meta, ttlHours] = await Promise.all([
    prisma.broadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { user: { select: { username: true, email: true } } },
    }),
    getBroadcastMeta(),
    broadcastTtlHours(),
  ]);
  void admin;
  // Status/audience/expiry are computed here so the admin page and the banner
  // can never disagree about whether a broadcast is live.
  const notifications = await prisma.notification.findMany({
    where: { type: "ANNOUNCEMENT" },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { user: { select: { username: true } } },
  });
  const broadcasts = rows.map((b) => ({
    ...b,
    status: broadcastStatus(b, meta, ttlHours),
    audience: audienceLabel(b, meta),
    expiresAt: meta[b.id]?.expiresAt ?? null,
    active: meta[b.id]?.active !== false,
    targetIds: meta[b.id]?.userIds ?? (b.userId ? [b.userId] : []),
  }));
  return ok({
    broadcasts,
    ttlHours,
    // Messages sent from the older "Announcements" form only landed in the
    // notification centre — list them here so nothing is invisible.
    notifications: notifications.map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      createdAt: n.createdAt,
      recipients: n.userId ? n.user?.username ?? "1 user" : "All users",
      read: n.read,
    })),
  });
});

export const POST = handle(async (req: NextRequest) => {
  const admin = await sharedAdminGuard(req, "notifications");

  const body = await req.json().catch(() => null);
  const title = String(body?.title ?? "").trim();
  const message = String(body?.message ?? "").trim();
  if (!title || !message) {
    throw new ApiError(400, "title and message are required.", "VALIDATION");
  }

  const requested = String(body?.targetType ?? "ALL").toUpperCase();
  const targetType =
    requested === "ACTIVE" ? "ACTIVE" : requested === "USER" || requested === "USER_IDS" ? "USER_IDS" : "ALL";

  // Resolve the target list (accepts ids, emails or @usernames).
  const userIds: string[] = [];
  if (targetType === "USER_IDS") {
    const raw: string[] = Array.isArray(body?.userIds)
      ? body.userIds.map((x: unknown) => String(x))
      : String(body?.userId ?? body?.userIds ?? "")
          .split(/[\n,]+/)
          .map((x) => x.trim());
    const refs = [...new Set(raw.map((x) => x.trim()).filter(Boolean))];
    if (!refs.length) throw new ApiError(400, "At least one user is required for a targeted broadcast.", "VALIDATION");
    for (const ref of refs) {
      const target =
        (await prisma.user.findUnique({ where: { id: ref } })) ??
        (await prisma.user.findFirst({ where: { email: ref.toLowerCase() } })) ??
        (await prisma.user.findFirst({ where: { username: { equals: ref.replace(/^@/, ""), mode: "insensitive" } } }));
      if (!target) throw new ApiError(404, `User not found: ${ref}`, "NOT_FOUND");
      userIds.push(target.id);
    }
  }

  const expiresAtRaw = body?.expiresAt ? String(body.expiresAt) : null;
  const expiresAt = expiresAtRaw && !Number.isNaN(new Date(expiresAtRaw).getTime()) ? new Date(expiresAtRaw).toISOString() : null;

  const broadcast = await prisma.broadcast.create({
    data: {
      title,
      message,
      targetType,
      userId: targetType === "USER_IDS" && userIds.length === 1 ? userIds[0] : null,
      createdBy: admin.id,
    },
  });

  await setBroadcastMeta(broadcast.id, {
    active: true,
    ...(expiresAt ? { expiresAt } : {}),
    ...(targetType === "USER_IDS" ? { userIds } : {}),
  });

  // Mirror into the notification centre (bell + unread badge).
  if (targetType === "ALL") {
    await prisma.notification.create({ data: { title, message, type: "ANNOUNCEMENT", userId: null } });
  } else if (targetType === "ACTIVE") {
    const users = await prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
    if (users.length) {
      await prisma.notification.createMany({
        data: users.map((u) => ({ title, message, type: "ANNOUNCEMENT", userId: u.id })),
      });
    }
  } else if (userIds.length) {
    await prisma.notification.createMany({
      data: userIds.map((uid) => ({ title, message, type: "ANNOUNCEMENT", userId: uid })),
    });
  }

  await auditLog({
    admin,
    action: "BROADCAST",
    entity: "BROADCAST",
    entityId: broadcast.id,
    newValue: { audience: targetType, recipients: targetType === "USER_IDS" ? userIds.length : targetType, title },
  });

  return ok({
    broadcast,
    message:
      targetType === "USER_IDS"
        ? `Broadcast sent to ${userIds.length} user${userIds.length === 1 ? "" : "s"}`
        : targetType === "ACTIVE"
          ? "Broadcast sent to signed-in users"
          : "Broadcast sent to all visitors",
  });
});