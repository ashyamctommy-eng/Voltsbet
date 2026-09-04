import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Deposit-lock unlock: flips User.hasDeposited on the user's FIRST successful
 * deposit. Until this flag is set, bonusBalance is neither stakeable (the bet
 * engine excludes it from the bankroll) nor withdrawable (withdrawals only
 * ever draw from `balance`). Called from every deposit-success funnel:
 * crypto (demo webhook / NOWPayments IPN / M-Pesa / Palplus / admin manual
 * confirm) via confirmDeposit, and voucher redemptions. The updateMany guard
 * makes repeat calls no-ops, so it is safe to invoke on every completed
 * deposit.
 */
export async function unlockDepositFlag(tx: Tx, userId: string): Promise<boolean> {
  const res = await tx.user.updateMany({
    where: { id: userId, hasDeposited: false },
    data: { hasDeposited: true },
  });
  return res.count > 0;
}
