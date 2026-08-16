import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handle(async (req: NextRequest) => {
  await requireAdmin("withdrawals");
  const status = req.nextUrl.searchParams.get("status") ?? "";
  const withdrawals = await prisma.withdrawal.findMany({
    where: status ? { status } : {},
    include: { user: { select: { username: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return ok({ withdrawals });
});

export const PATCH = handle(async () => {
  throw new ApiError(404, "Not found.", "NOT_FOUND");
});
