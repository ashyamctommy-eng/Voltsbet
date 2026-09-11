import { NextRequest } from "next/server";
import { handle, ok, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "audit");
  const entity = req.nextUrl.searchParams.get("entity") ?? "";
  // Optional narrowing for the user drawer / filtered views:
  //   ?entity=USER&entityId=<userId>  → that record's own history
  //   ?userId=<userId>                → every action taken *on* that user
  const entityId = req.nextUrl.searchParams.get("entityId") ?? "";
  const userId = req.nextUrl.searchParams.get("userId") ?? "";
  const logs = await prisma.auditLog.findMany({
    where: {
      ...(entity ? { entity } : {}),
      ...(entityId ? { entityId } : {}),
      ...(userId ? { userId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return ok({ logs });
});
