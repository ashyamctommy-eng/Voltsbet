import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { convert, formatMoney } from "@/lib/currency";
import { userBlockReason } from "@/lib/statuses";
import { getSettings } from "@/lib/settings";
import AccountDashboard from "@/components/account/AccountDashboard";

export const dynamic = "force-dynamic";

/** Account dashboard — server component: auth + data, rendered client-side
 *  (AccountDashboard) so every label follows the selected language. */
export default async function AccountDashboardPage() {
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
    <AccountDashboard
      bettingLockReason={bettingLockReason}
      balanceLabel={balanceLabel}
      bonusLabel={bonusLabel}
      walletCur={walletCur}
      userStatus={user.status}
      verified={user.verified}
      appUrl={s.appUrl}
      referralCode={user.referralCode}
      openBets={openBets.map((b) => ({
        id: b.id,
        code: b.code,
        type: b.type,
        status: b.status,
        totalOdds: Number(b.totalOdds),
        stake: Number(b.stake),
        potentialWin: Number(b.potentialWin),
        selections: b.selections.map((s) => ({ outcomeName: s.outcomeName })),
      }))}
      transactions={transactions.map((t) => ({
        id: t.id,
        type: t.type,
        reason: t.reason,
        amount: Number(t.amount),
        currencyCode: t.currencyCode,
        createdAt: t.createdAt.toISOString(),
      }))}
    />
  );
}
