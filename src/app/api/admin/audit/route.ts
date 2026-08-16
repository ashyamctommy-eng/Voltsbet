import { NextRequest } from "next/server";
import { handle, ok, requireAdmin } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handle(async (req: NextRequest) => {
  await requireAdmin("audit");
  const entity = req.nextUrl.searchParams.get("entity") ?? "";
  const logs = await prisma.auditLog.findMany({
    where: entity ? { entity } : {},
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return ok({ logs });
});
