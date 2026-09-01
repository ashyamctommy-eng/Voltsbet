import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function PromotionsPage() {
  const promotions = await prisma.promotion.findMany({
    where: { active: true, OR: [{ endAt: null }, { endAt: { gt: new Date() } }] },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-8">
      <h1 className="mt-8 text-2xl font-extrabold">Promotions</h1>
      <p className="mt-1 text-sm text-ink2">Bonuses, free bets and boosts — always check the terms.</p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {promotions.map((p) => (
          <div key={p.id} className="card card-hover relative overflow-hidden p-6">
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-brand/10" />
            <span className="rounded-full bg-brand/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-brand">
              {p.bonusType?.replace("_", " ") ?? "Promotion"}
            </span>
            <h2 className="mt-3 text-xl font-bold">{p.title}</h2>
            <p className="mt-2 text-sm text-ink2">{p.description}</p>
            {p.bonusValue !== null && p.bonusType === "WELCOME_BONUS" && (
              <div className="mt-3 text-2xl font-extrabold text-brand">Up to {Number(p.bonusValue).toLocaleString()}</div>
            )}
            {p.terms && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs font-semibold text-ink3 hover:text-ink2">Terms & conditions</summary>
                <p className="mt-2 rounded-lg bg-card2 p-3 text-xs text-ink2">{p.terms}</p>
              </details>
            )}
            {p.endAt && (
              <div className="mt-4 text-xs text-ink3">Valid until {p.endAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
