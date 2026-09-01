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
