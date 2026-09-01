import { NextRequest } from "next/server";
import { handle, ok, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "withdrawals");
  const status = req.nextUrl.searchParams.get("status") ?? "";
  const withdrawals = await prisma.withdrawal.findMany({
    where: status ? { status } : {},
    include: { user: { select: { username: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return ok({
    withdrawals: withdrawals.map((w) => ({
      ...w,
      metadata: undefined, // never leak provider internals to the panel
    })),
  });
});

export const PATCH = handle(async () => {
  throw new ApiError(404, "Not found.", "NOT_FOUND");
});
