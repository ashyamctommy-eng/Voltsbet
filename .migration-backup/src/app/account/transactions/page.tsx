import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { convert, formatMoney } from "@/lib/currency";
import { formatDateTime } from "@/lib/odds";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [s, transactions] = await Promise.all([
    getSettings(),
    prisma.transaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  // Display in the platform's admin-configured default currency (the wallet
  // still transacts in the user's own currency — shown as a secondary hint).
  const displayCur = user.displayCurrencyCode ?? s.currencyDefault;
  const rows = await Promise.all(
    transactions.map(async (t) => ({
      ...t,
      amountLabel: await formatMoney(
        await convert(Number(t.amount), t.currencyCode, displayCur),
        displayCur,
      ),
      balanceLabel: await formatMoney(
        await convert(Number(t.newBalance), t.currencyCode, displayCur),
        displayCur,
      ),
    })),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Transactions</h2>
        <span className="text-xs text-ink3">Displayed in {displayCur}</span>
      </div>
      {rows.length === 0 ? (
        <div className="card p-10 text-center text-sm text-ink3">No transactions yet.</div>
      ) : (
        <div className="card divide-y divide-line">
          {rows.map((t) => (
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
                  {Number(t.amount) >= 0 ? "+" : ""}{t.amountLabel}
                  <span className="ml-1 text-[10px] font-medium text-ink3">({t.currencyCode})</span>
                </div>
                <div className="text-xs text-ink3">
                  Bal: {t.balanceLabel}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
