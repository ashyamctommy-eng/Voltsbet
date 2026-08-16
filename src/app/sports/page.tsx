import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function SportsPage() {
  const sports = await prisma.sport.findMany({
    where: { active: true },
    include: { _count: { select: { games: { where: { status: { notIn: ["FINISHED", "CANCELLED"] } } } } } },
    orderBy: { sortOrder: "asc" },
  });
  const liveCount = await prisma.game.count({ where: { status: { in: ["LIVE", "HALF_TIME"] } } });

  return (
    <div className="mx-auto max-w-[1600px] px-4">
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Sports</h1>
        <Link href="/live" className="flex items-center gap-1.5 text-sm font-semibold text-brand">
          <span className="live-dot" /> {liveCount} live now
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {sports.map((sp) => (
          <Link
            key={sp.id}
            href={`/sports/${sp.slug}`}
            className="card card-hover flex flex-col items-center gap-2 px-3 py-6 text-center"
          >
            <span className="text-4xl">{sp.icon}</span>
            <span className="font-semibold">{sp.name}</span>
            <span className="text-xs text-ink3">{sp._count.games} matches</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
