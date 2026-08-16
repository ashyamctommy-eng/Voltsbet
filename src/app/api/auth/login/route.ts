import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, ApiError } from "@/lib/api";
import { verifyPassword, createSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  identifier: z.string().min(1, "Enter your username or email"),
  password: z.string().min(1, "Enter your password"),
  remember: z.boolean().optional().default(false),
});

export const POST = handle(async (req: NextRequest) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = rateLimit(`login:${ip}`, 15, 15 * 60_000);
  if (!rl.ok) throw new ApiError(429, "Too many login attempts. Try again later.", "RATE_LIMITED");

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");
  const { identifier, password, remember } = parsed.data;

  const id = identifier.toLowerCase().trim();
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: id }, { email: id }] },
  });

  const badLogin = async () => {
    await prisma.auditLog.create({
      data: { action: "LOGIN_FAILED", entity: "USER", entityId: user?.id, ip },
    });
    throw new ApiError(401, "Invalid username/email or password.", "BAD_CREDENTIALS");
  };

  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return badLogin();
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user.id, {
    ip,
    userAgent: req.headers.get("user-agent") ?? undefined,
    remember,
  });

  return ok({
    user: { id: user.id, username: user.username, role: user.role },
    redirect: user.role !== "CUSTOMER" ? "/admin" : "/",
  });
});
