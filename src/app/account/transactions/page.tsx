import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/odds";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const transactions = await prisma.transaction.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">Transactions</h2>
      {transactions.length === 0 ? (
        <div className="card p-10 text-center text-sm text-ink3">No transactions yet.</div>
      ) : (
        <div className="card divide-y divide-line">
          {transactions.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <div className="font-semibold capitalize">{t.type.replace("_", " ")}</div>
                <div className="truncate text-xs text-ink3">
                  {formatDateTime(t.createdAt)}
                  {t.reference ? ` · Ref: ${t.reference}` : ""}
                </div>
                {t.reason && <div className="truncate text-xs text-ink3">{t.reason}</div>}
              </div>
              <div className="text-right">
                <div className={`font-bold ${Number(t.amount) >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {Number(t.amount) >= 0 ? "+" : ""}{Number(t.amount).toLocaleString("en-US", { maximumFractionDigits: 2 })} {t.currencyCode}
                </div>
                <div className="text-xs text-ink3">
                  Bal: {Number(t.newBalance).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
