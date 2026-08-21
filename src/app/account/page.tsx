import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { convert, formatMoney } from "@/lib/currency";
import { userBlockReason } from "@/lib/statuses";
import { formatDateTime, statusColor } from "@/lib/odds";
import { getSettings } from "@/lib/settings";
import CopyButton from "@/components/CopyButton";
import { IconGift } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function AccountDashboard() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [s, wallet, openBets, transactions, bettingLockReason] = await Promise.all([
    getSettings(),
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

  // Wallet balance → user's display currency when set, else the platform's
  // admin-configured default operating currency (settings.currencyDefault).
  const displayCur = user.displayCurrencyCode ?? s.currencyDefault;
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

      {/* Referral */}
      {user.referralCode && (
        <section className="card relative overflow-hidden p-5">
          <div className="absolute -left-8 -top-10 h-32 w-32 rounded-full bg-brand/10 blur-xl" />
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-bold">
                <IconGift className="h-5 w-5 text-brand" /> Refer &amp; Earn
              </h2>
              <p className="mt-1 text-sm text-ink2">
                Share your link — when a friend makes their first deposit, you earn a bonus.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="rounded-lg border border-line bg-card px-3 py-1.5 font-mono text-sm text-brand">
                  {user.referralCode}
                </code>
                <CopyButton
                  text={`${s.appUrl ? s.appUrl.replace(/\/$/, "") : ""}/register?ref=${user.referralCode}`}
                  label="Copy link"
                />
              </div>
            </div>
          </div>
        </section>
      )}

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
