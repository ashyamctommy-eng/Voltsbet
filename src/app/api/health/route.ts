import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/health — liveness + readiness probe for the platform (Railway
 * healthcheck). Deliberately public, tiny and dependency-light: it must answer
 * even while the rest of the app is under load.
 *
 *   200 → process is up AND the database responds (ready to take traffic)
 *   503 → process is up but the database is unreachable (NOT ready)
 *
 * Wiring it as the Railway healthcheck path is what removes the "errored
 * Railway page" during deploys: Railway keeps the OLD deployment serving until
 * the new one passes this probe, instead of cutting traffic over to a
 * container that is still booting.
 *
 * Never expose secrets here — it returns only coarse status.
 */
export const dynamic = "force-dynamic";

async function dbUp(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("db-timeout")), 2000);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  const startedAt = Date.now();
  const up = await dbUp();
  return NextResponse.json(
    {
      ok: up,
      db: up ? "up" : "down",
      uptimeSeconds: Math.round(process.uptime()),
      revision: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      checkedAt: new Date().toISOString(),
      ms: Date.now() - startedAt,
    },
    { status: up ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}
