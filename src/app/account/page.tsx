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

  // WALLET CURRENCY, RAW — the app's one rule for money (see the comment in
  // layout.tsx). This page used to convert the balance into the user's display
  // currency, so it disagreed with the header, betslip and withdrawal screen
  // about how much money the customer had, and it was the figure they'd most
  // likely trust before withdrawing. The display equivalent is kept, but as a
  // secondary hint.
  const walletCur = wallet?.currencyCode ?? "KES";
  const displayCur = user.displayCurrencyCode ?? s.currencyDefault;
  const balanceLabel = wallet ? await formatMoney(Number(wallet.balance), walletCur) : await formatMoney(0, walletCur);
  const displayLabel =
    wallet && displayCur !== walletCur
      ? await formatMoney(await convert(Number(wallet.balance), walletCur, displayCur), displayCur)
      : null;
  const bonusLabel = wallet ? await formatMoney(Number(wallet.bonusBalance), walletCur) : null;
  const pendingPayouts = await prisma.withdrawal.count({ where: { userId: user.id, status: "PENDING" } });

  return (
    <AccountDashboard
      bettingLockReason={bettingLockReason}
      balanceLabel={balanceLabel}
      displayLabel={displayLabel}
      displayCur={displayCur}
      pendingPayouts={pendingPayouts}
      bonusLabel={bonusLabel}
      hasDeposited={user.hasDeposited}
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
