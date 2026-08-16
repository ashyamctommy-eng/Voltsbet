import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { convert, formatMoney } from "@/lib/currency";
import { userBlockReason } from "@/lib/statuses";
import { formatDateTime, statusColor } from "@/lib/odds";

export const dynamic = "force-dynamic";

export default async function AccountDashboard() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [wallet, openBets, transactions, bettingLockReason] = await Promise.all([
    prisma.wallet.findUnique({ where: { userId: user.id } }),
    prisma.bet.findMany({
      where: { userId: user.id, status: "OPEN" },
      include: { selections: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.transaction.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 8 }),
    userBlockReason(user.status, "bet"),
  ]);

  const displayCur = user.displayCurrencyCode ?? user.currencyCode;
  const walletCur = wallet?.currencyCode ?? "KES";
  const balance = wallet ? await convert(Number(wallet.balance), walletCur, displayCur) : 0;
  const balanceLabel = await formatMoney(balance, displayCur);
  const bonusLabel = wallet ? await formatMoney(await convert(Number(wallet.bonusBalance), walletCur, displayCur), displayCur) : null;

  return (
    <div className="space-y-5">
      {bettingLockReason && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          ⚠️ {bettingLockReason}
        </div>
      )}

      {/* Balance card */}
      <div className="card relative overflow-hidden p-6">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-brand/15" />
        <div className="text-sm text-ink2">Available balance</div>
        <div className="mt-1 text-3xl font-extrabold text-green-400">{balanceLabel}</div>
        {bonusLabel && (
          <div className="mt-1 text-xs text-ink3">Bonus balance: {bonusLabel}</div>
        )}
        <div className="mt-5 flex gap-3">
          <Link href="/account/deposit" className="btn btn-primary btn-sm">+ Deposit</Link>
          <Link href="/account/withdraw" className="btn btn-ghost btn-sm">Withdraw</Link>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Open bets" value={openBets.length.toString()} />
        <Stat label="Status" value={user.status.replace("_", " ")} accent={user.status === "ACTIVE"} />
        <Stat label="Verified" value={user.verified ? "Yes" : "No"} accent={user.verified} />
        <Stat label="Currency" value={walletCur} />
      </div>

      {/* Open bets */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">Open Bets</h2>
          <Link href="/account/bets" className="text-sm font-semibold text-brand hover:underline">View all →</Link>
        </div>
        {openBets.length === 0 ? (
          <div className="card p-8 text-center text-sm text-ink3">
            No open bets.{" "}
            <Link href="/sports" className="text-brand hover:underline">Find a match to bet on →</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {openBets.map((bet) => (
              <div key={bet.id} className="card p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-bold">{bet.code} · {bet.type === "MULTIPLE" ? `${bet.selections.length}-fold` : "Single"}</span>
                  <span className={`text-xs font-bold ${statusColor(bet.status)}`}>{bet.status}</span>
                </div>
                <div className="mt-2 text-xs text-ink2">
                  {bet.selections.map((s) => s.outcomeName).join(" · ") || "—"}
                </div>
                <div className="mt-2 flex gap-4 text-xs text-ink2">
                  <span>Odds <b className="text-ink">{Number(bet.totalOdds).toFixed(2)}</b></span>
                  <span>Stake <b className="text-ink">{Number(bet.stake).toLocaleString()}</b></span>
                  <span>Potential <b className="text-green-400">{Number(bet.potentialWin).toLocaleString()}</b></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent transactions */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">Recent Transactions</h2>
          <Link href="/account/transactions" className="text-sm font-semibold text-brand hover:underline">View all →</Link>
        </div>
        {transactions.length === 0 ? (
          <div className="card p-8 text-center text-sm text-ink3">No transactions yet.</div>
        ) : (
          <div className="card divide-y divide-line">
            {transactions.map((t) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <div className="font-semibold capitalize">{t.type.replace("_", " ")}</div>
                  <div className="text-xs text-ink3">{formatDateTime(t.createdAt)} {t.reason ? `· ${t.reason}` : ""}</div>
                </div>
                <div className={`font-bold ${Number(t.amount) >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {Number(t.amount) >= 0 ? "+" : ""}{Number(t.amount).toLocaleString("en-US", { maximumFractionDigits: 2 })} {t.currencyCode}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, accent = true }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-ink3">{label}</div>
      <div className={`mt-1 truncate text-lg font-bold ${accent ? "" : "text-amber-400"}`}>{value}</div>
    </div>
  );
}
