import { NextRequest } from "next/server";
import { handle, ok, auditLog, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  title: z.string().min(2),
  message: z.string().min(2),
  audience: z.enum(["ALL", "ACTIVE", "USER_IDS"]),
  userIds: z.array(z.string()).optional().default([]),
});

export const POST = handle(async (req: NextRequest) => {
  const admin = await sharedAdminGuard(req, "notifications");
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");
  const d = parsed.data;

  let targets: string[] | null = null; // null = broadcast
  if (d.audience === "ACTIVE") {
    const users = await prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
    targets = users.map((u) => u.id);
  } else if (d.audience === "USER_IDS") {
    targets = d.userIds;
  }

  if (targets === null) {
    await prisma.notification.create({
      data: { userId: null, type: "ANNOUNCEMENT", title: d.title, message: d.message },
    });
  } else {
    await prisma.notification.createMany({
      data: targets.map((uid) => ({
        userId: uid, type: "ANNOUNCEMENT", title: d.title, message: d.message,
      })),
    });
  }

  await auditLog({
    admin, action: "ANNOUNCE", entity: "NOTIFICATION",
    newValue: { audience: d.audience, title: d.title, recipients: targets === null ? "ALL" : targets.length },
  });
  return ok({ message: targets === null ? "Announcement broadcast to all users" : `Announcement sent to ${targets.length} users` });
});
