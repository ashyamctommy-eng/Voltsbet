import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handle(async (req: NextRequest) => {
  await requireAdmin("users");
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const status = req.nextUrl.searchParams.get("status") ?? "";
  const users = await prisma.user.findMany({
    where: {
      role: "CUSTOMER",
      ...(q ? { OR: [{ username: { contains: q } }, { email: { contains: q } }, { fullName: { contains: q } }] } : {}),
      ...(status ? { status } : {}),
    },
    include: { wallet: true, _count: { select: { bets: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return ok({
    users: users.map((u) => ({
      id: u.id, fullName: u.fullName, username: u.username, email: u.email, phone: u.phone,
      status: u.status, verified: u.verified, currencyCode: u.currencyCode,
      balance: u.wallet ? Number(u.wallet.balance) : 0,
      betCount: u._count.bets, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
    })),
  });
});

export const PATCH = handle(async (req: NextRequest) => {
  // Route conflict guard — PATCH goes to /api/admin/users/[id]
  throw new ApiError(404, "Not found.", "NOT_FOUND");
});
