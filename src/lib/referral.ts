import type { Prisma, Deposit } from "@prisma/client";
import { getSettings } from "./settings";

/**
 * Referral engine — the moment a referee's FIRST deposit completes, the
 * referrer gets a one-time bonus (percent of the deposit, capped). Configured
 * in Admin → Website Settings → Referrals.
 */

type Tx = Prisma.TransactionClient;
type DepositWithUser = Deposit & { user: { id: string; referredByCode: string | null } };

export async function awardReferralBonusIfFirstDeposit(tx: Tx, deposit: DepositWithUser) {
  const s = await getSettings();
  if (!s.referralEnabled || !deposit.user.referredByCode) return null;

  // Only the referee's very first completed deposit triggers a bonus.
  const earlier = await tx.deposit.findFirst({
    where: { userId: deposit.userId, status: "COMPLETED", id: { not: deposit.id } },
  });
  if (earlier) return null;

  const amount = Number(deposit.amount);
  if (amount < s.referralMinDeposit) return null;

  const referrer = await tx.user.findUnique({
    where: { referralCode: deposit.user.referredByCode },
    include: { wallet: true },
  });
  if (!referrer || referrer.id === deposit.userId || referrer.status !== "ACTIVE") return null;

  const bonus = Math.min(Math.round((amount * s.referralBonusPercent) / 100 * 100) / 100, s.referralBonusCap);
  if (bonus <= 0) return null;

  const wallet = referrer.wallet;
  if (!wallet) return null;

  const prev = Number(wallet.balance);
  const next = Math.round((prev + bonus) * 100) / 100;

  await tx.wallet.update({ where: { id: wallet.id }, data: { balance: next.toFixed(2) } });
  await tx.transaction.create({
    data: {
      userId: referrer.id,
      type: "REFERRAL_BONUS",
      amount: bonus.toFixed(2),
      currencyCode: wallet.currencyCode,
      prevBalance: prev.toFixed(2),
      newBalance: next.toFixed(2),
      reason: `Referral bonus — ${deposit.user.referredByCode} made their first deposit`,
      reference: deposit.id,
    },
  });
  await tx.notification.create({
    data: {
      userId: referrer.id,
      type: "REFERRAL_BONUS",
      title: "Referral Bonus 🎉",
      message: `A friend you referred made their first deposit. ${bonus.toFixed(2)} ${wallet.currencyCode} was added to your balance.`,
    },
  });

  return { referrerId: referrer.id, bonus };
}
