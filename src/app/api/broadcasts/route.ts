import { handle, ok } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isBroadcastLive } from "@/lib/broadcast-visibility";
import { broadcastTtlHours, getBroadcastMeta } from "@/lib/broadcasts";

/**
 * GET /api/broadcasts — announcements for the current viewer.
 * Logged-out visitors get global (ALL) broadcasts; logged-in users also get
 * ones targeted at their user id. The client banner polls this endpoint.
 */
export const GET = handle(async () => {
  const user = await getCurrentUser();
  // Fetch a window, then apply the lifecycle rules (deactivated / expired /
  // targeted) in one place so the banner, the admin history and the tests all
  // agree on what "live" means.
  const [rows, meta, ttlHours] = await Promise.all([
    prisma.broadcast.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    getBroadcastMeta(),
    broadcastTtlHours(),
  ]);
  const broadcasts = rows.filter((b) =>
    isBroadcastLive(b, meta, { ttlHours, viewer: user ? { id: user.id } : null }),
  );
  return ok({ broadcasts: broadcasts.slice(0, 20) });
});
