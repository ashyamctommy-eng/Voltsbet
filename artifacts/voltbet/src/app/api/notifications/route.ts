import { NextRequest } from "next/server";
import { handle, ok, requireUser, verifyCsrf } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handle(async () => {
  const user = await requireUser();
  const notifications = await prisma.notification.findMany({
    where: { OR: [{ userId: user.id }, { userId: null }] },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return ok({ notifications });
});

export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const user = await requireUser();
  const body = await req.json().catch(() => null);
  const { id } = body ?? {};
  if (id) {
    await prisma.notification.updateMany({
      where: { id, OR: [{ userId: user.id }, { userId: null }] },
      data: { read: true },
    });
  } else {
    await prisma.notification.updateMany({
      where: { OR: [{ userId: user.id }, { userId: null }] },
      data: { read: true },
    });
  }
  return ok({ message: "Marked as read" });
});
