import { ApiError } from "./api";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Round to cents — every wallet arithmetic goes through this. */
export function toCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export type WalletOp = {
  /** Transaction type string, e.g. BET_STAKE, BET_WIN, DEPOSIT, WITHDRAWAL. */
  type: string;
  /** Payment channel for DEPOSIT/WITHDRAWAL rows: CRYPTO | MPESA | VOUCHER … */
  method?: string;
  reason: string;
  reference?: string;
  currencyCode?: string;
  /** Admin who performed the operation (balance adjustments). */
  createdById?: string;
};

/**
 * Total bankroll a user may stake: real balance + bonus balance, but the
 * bonus only counts once the user's first deposit has completed
 * (`hasDeposited`). Withdrawals never include bonus funds (see withdraw API).
 */
export function availableBankroll(balance: number, bonusBalance: number, bonusUnlocked: boolean): number {
  return toCents(balance + (bonusUnlocked ? bonusBalance : 0));
}

/** Pure split of a stake between the real and bonus pools (bonus-first). */
export function splitStakeFunds(
  balance: number,
  bonusBalance: number,
  stake: number,
  bonusUnlocked: boolean
): { fromBalance: number; fromBonus: number } {
  const amt = toCents(stake);
  if (amt <= 0) return { fromBalance: 0, fromBonus: 0 };
  let fromBonus = 0;
  if (bonusUnlocked) fromBonus = Math.min(toCents(bonusBalance), amt);
  if (fromBonus < 0) fromBonus = 0;
  return { fromBonus: toCents(fromBonus), fromBalance: toCents(amt - fromBonus) };
}

/**
 * Atomic wallet debit.
 *
 * Uses an `UPDATE … WHERE balance >= amount` guard so two concurrent debits
 * can never double-spend the same funds (previously a read-modify-write race
 * under READ COMMITTED let two transactions both pass the balance check).
 * Throws INSUFFICIENT_BALANCE when the wallet cannot cover the amount.
 */
export async function debitWallet(
  tx: Tx,
  userId: string,
  amount: number,
  opts: WalletOp
): Promise<{ prev: number; next: number }> {
  const amt = toCents(amount);
  if (amt < 0) throw new ApiError(400, "Amount cannot be negative.", "BAD_AMOUNT");

  const wallet = await tx.wallet.findUnique({ where: { userId } });
  if (!wallet) throw new ApiError(500, "Wallet not found.", "NO_WALLET");
  const prev = Number(wallet.balance);
  if (prev < amt) throw new ApiError(400, "Insufficient balance.", "INSUFFICIENT_BALANCE");

  const claimed = await tx.wallet.updateMany({
    where: { userId, balance: { gte: amt } },
    data: { balance: { decrement: amt.toFixed(2) } },
  });
  if (claimed.count === 0) {
    throw new ApiError(400, "Insufficient balance.", "INSUFFICIENT_BALANCE");
  }

  const after = await tx.wallet.findUnique({ where: { userId } });
  const next = Number(after?.balance ?? prev - amt);

  await tx.transaction.create({
    data: {
      userId,
      type: opts.type,
      method: opts.method ?? null,
      amount: (-amt).toFixed(2),
      currencyCode: opts.currencyCode ?? wallet.currencyCode,
      prevBalance: prev.toFixed(2),
      newBalance: next.toFixed(2),
      reason: opts.reason,
      reference: opts.reference ?? null,
      createdById: opts.createdById ?? null,
    },
  });
  return { prev, next };
}

/**
 * Atomic wallet credit (increment can never race into negative, so no guard
 * is needed) — always paired with a Transaction record.
 */
export async function creditWallet(
  tx: Tx,
  userId: string,
  amount: number,
  opts: WalletOp
): Promise<{ prev: number; next: number }> {
  const amt = toCents(amount);
  if (amt < 0) throw new ApiError(400, "Amount cannot be negative.", "BAD_AMOUNT");

  const wallet = await tx.wallet.findUnique({ where: { userId } });
  if (!wallet) throw new ApiError(500, "Wallet not found.", "NO_WALLET");
  const prev = Number(wallet.balance);

  await tx.wallet.update({
    where: { userId },
    data: { balance: { increment: amt.toFixed(2) } },
  });

  const after = await tx.wallet.findUnique({ where: { userId } });
  const next = Number(after?.balance ?? prev + amt);

  await tx.transaction.create({
    data: {
      userId,
      type: opts.type,
      method: opts.method ?? null,
      amount: amt.toFixed(2),
      currencyCode: opts.currencyCode ?? wallet.currencyCode,
      prevBalance: prev.toFixed(2),
      newBalance: next.toFixed(2),
      reason: opts.reason,
      reference: opts.reference ?? null,
      createdById: opts.createdById ?? null,
    },
  });
  return { prev, next };
}

// ─────────────────────────── Bonus balance pool ──────────────────────────
// BonusBalance is a separate, hard-boundary pool: it is credited by the
// signup-bonus system, is NOT withdrawable (the withdraw API only ever draws
// from `balance`), and becomes stakeable only after the user's first
// successful deposit (User.hasDeposited). Ledger rows for bonus movements
// record the BONUS pool in prevBalance/newBalance and carry a
// "(bonus balance)" marker in the reason so statements stay unambiguous.

/**
 * Atomic bonus-pool credit (signup bonus, bonus-funded stake refunds).
 * Mirrors creditWallet's invariants: paired Transaction row, toCents rounding.
 */
export async function creditBonusWallet(
  tx: Tx,
  userId: string,
  amount: number,
  opts: WalletOp
): Promise<{ prev: number; next: number }> {
  const amt = toCents(amount);
  if (amt < 0) throw new ApiError(400, "Amount cannot be negative.", "BAD_AMOUNT");

  const wallet = await tx.wallet.findUnique({ where: { userId } });
  if (!wallet) throw new ApiError(500, "Wallet not found.", "NO_WALLET");
  const prev = Number(wallet.bonusBalance);

  await tx.wallet.update({
    where: { userId },
    data: { bonusBalance: { increment: amt.toFixed(2) } },
  });
  const after = await tx.wallet.findUnique({ where: { userId } });
  const next = Number(after?.bonusBalance ?? prev + amt);

  await tx.transaction.create({
    data: {
      userId,
      type: opts.type,
      method: opts.method ?? null,
      amount: amt.toFixed(2),
      currencyCode: opts.currencyCode ?? wallet.currencyCode,
      prevBalance: prev.toFixed(2),
      newBalance: next.toFixed(2),
      reason: opts.reason ? `${opts.reason} (bonus balance)` : "(bonus balance)",
      reference: opts.reference ?? null,
      createdById: opts.createdById ?? null,
    },
  });
  return { prev, next };
}

/**
 * Atomic bonus-pool debit with an `UPDATE … WHERE bonusBalance >= amount`
 * guard — concurrent bonus spends can never double-spend (mirror of
 * debitWallet). Throws INSUFFICIENT_BALANCE when the bonus pool cannot cover
 * the amount.
 */
export async function debitBonusWallet(
  tx: Tx,
  userId: string,
  amount: number,
  opts: WalletOp
): Promise<{ prev: number; next: number }> {
  const amt = toCents(amount);
  if (amt < 0) throw new ApiError(400, "Amount cannot be negative.", "BAD_AMOUNT");

  const wallet = await tx.wallet.findUnique({ where: { userId } });
  if (!wallet) throw new ApiError(500, "Wallet not found.", "NO_WALLET");
  const prev = Number(wallet.bonusBalance);
  if (prev < amt) throw new ApiError(400, "Insufficient bonus balance.", "INSUFFICIENT_BALANCE");

  const claimed = await tx.wallet.updateMany({
    where: { userId, bonusBalance: { gte: amt } },
    data: { bonusBalance: { decrement: amt.toFixed(2) } },
  });
  if (claimed.count === 0) {
    throw new ApiError(400, "Insufficient bonus balance.", "INSUFFICIENT_BALANCE");
  }

  const after = await tx.wallet.findUnique({ where: { userId } });
  const next = Number(after?.bonusBalance ?? prev - amt);

  await tx.transaction.create({
    data: {
      userId,
      type: opts.type,
      method: opts.method ?? null,
      amount: (-amt).toFixed(2),
      currencyCode: opts.currencyCode ?? wallet.currencyCode,
      prevBalance: prev.toFixed(2),
      newBalance: next.toFixed(2),
      reason: opts.reason ? `${opts.reason} (bonus balance)` : "(bonus balance)",
      reference: opts.reference ?? null,
      createdById: opts.createdById ?? null,
    },
  });
  return { prev, next };
}

/**
 * Refund a bet's stake back to the pools it came from (voided / cancelled
 * bets): the bonus-funded portion (`bonusStake`) returns to bonusBalance,
 * the rest to balance. Winnings (BET_WIN / CASH_OUT) always land in the real
 * balance regardless of stake source.
 */
export async function refundBetStake(
  tx: Tx,
  userId: string,
  stake: number,
  bonusStake: number,
  betCode: string,
  reasonPrefix: string
): Promise<{ balanceRefund: number; bonusRefund: number }> {
  const bonusPart = Math.min(toCents(bonusStake), toCents(stake));
  const balancePart = toCents(stake - bonusPart);

  if (bonusPart > 0) {
    await creditBonusWallet(tx, userId, bonusPart, {
      type: "BET_REFUND",
      reason: `${reasonPrefix} ${betCode}`,
      reference: betCode,
    });
  }
  if (balancePart > 0) {
    await creditWallet(tx, userId, balancePart, {
      type: "BET_REFUND",
      reason: `${reasonPrefix} ${betCode}`,
      reference: betCode,
    });
  }
  return { balanceRefund: balancePart, bonusRefund: bonusPart };
}
