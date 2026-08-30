import { NextRequest } from "next/server";
import { handle, ok, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "deposits");
  const status = req.nextUrl.searchParams.get("status") ?? "";
  const deposits = await prisma.deposit.findMany({
    where: status ? { status } : {},
    include: { user: { select: { username: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return ok({ deposits });
});

export const PATCH = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "deposits");
  throw new ApiError(404, "Not found.", "NOT_FOUND");
});
