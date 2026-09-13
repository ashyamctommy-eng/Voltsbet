import { convert, formatMoney } from "@/lib/currency";

/**
 * The one rule for showing money to a customer.
 *
 * The wallet transacts in ONE currency. Every balance surface therefore shows
 * that currency, RAW, as the authoritative figure — the balance the customer
 * will actually withdraw. A display currency is a convenience, so it is offered
 * as a secondary line, never as the number itself and never mixed into the same
 * string as the wallet code.
 *
 * This exists because three surfaces drifted from that rule: /account and
 * /account/transactions converted the figure but kept printing the ORIGINAL
 * currency code beside it (rendering "+$15.20 (KES)" — a dollar amount labelled
 * Kenyan shilling), while the header and betslip showed the raw wallet value.
 *
 * When the wallet and display currency are the same, there is nothing to add.
 */
export type WalletAmount = {
  /** Authoritative: "<amount> <wallet currency>". */
  walletLabel: string;
  /** Convenience: "<converted> <display currency>", or null when identical. */
  displayLabel: string | null;
  /** e.g. "+" | "−" | "" — sign for a ledger row. */
  sign: string;
};

export async function walletAmount(
  amount: number,
  walletCur: string,
  displayCur: string,
): Promise<WalletAmount> {
  const walletLabel = await formatMoney(amount, walletCur);
  if (walletCur === displayCur) return { walletLabel, displayLabel: null, sign: "" };
  const converted = await convert(amount, walletCur, displayCur);
  const displayLabel = await formatMoney(converted, displayCur);
  return { walletLabel, displayLabel, sign: "" };
}

/** Signed ledger row: wallet figure authoritative, display as the hint. */
export async function ledgerAmount(
  amount: number,
  walletCur: string,
  displayCur: string,
): Promise<WalletAmount & { positive: boolean }> {
  const abs = Math.abs(amount);
  const base = await walletAmount(abs, walletCur, displayCur);
  return { ...base, positive: amount >= 0 };
}
