import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf, auditLog, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  status: z.string().optional(),
  verified: z.boolean().optional(),
  fullName: z.string().min(2).optional(),
  country: z.string().optional(),
});

export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("users");
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");

  const prev = await prisma.user.findUnique({ where: { id } });
  if (!prev) throw new ApiError(404, "User not found.", "NOT_FOUND");
  if (prev.role !== "CUSTOMER") throw new ApiError(403, "Cannot modify admin accounts here.", "FORBIDDEN");

  const user = await prisma.user.update({ where: { id }, data: parsed.data });
  await auditLog({
    admin, action: parsed.data.status && parsed.data.status !== prev.status ? "USER_STATUS_CHANGE" : "UPDATE",
    entity: "USER", entityId: id, userId: id,
    prevValue: { status: prev.status, verified: prev.verified },
    newValue: { status: user.status, verified: user.verified },
  });

  if (parsed.data.status && parsed.data.status !== prev.status) {
    await prisma.notification.create({
      data: {
        userId: id, type: "ACCOUNT",
        title: parsed.data.status === "ACTIVE" ? "Account Reactivated" : `Account ${user.status.replace("_", " ").toLowerCase()}`,
        message: `Your account status changed to ${user.status.replace("_", " ").toLowerCase()}.`,
      },
    });
  }
  return ok({ user });
});

export const DELETE = handle(async () => {
  throw new ApiError(405, "Users are suspended, not deleted.", "NOT_ALLOWED");
});
