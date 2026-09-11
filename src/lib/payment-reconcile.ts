import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { confirmDeposit, updateDepositStatus } from "@/lib/deposits";
import { palplusListTransactions } from "@/lib/providers/palplus";
import { mpesaStkQuery } from "@/lib/providers/mpesa";
import { npGetPaymentStatus, type NpPayment } from "@/lib/providers/nowpayments";

/**
 * Payment reconciliation — the safety net for missed webhooks.
 *
 * Webhooks are the primary path. But PalPluss stops retrying after 5 attempts
 * (~9 min) and NOWPayments can drop an IPN, which would leave a genuinely paid
 * deposit stuck in AWAITING_PAYMENT forever. This pass re-derives the truth:
 *
 *   • PalPluss (live M-Pesa rail): one GET /transactions (type=STK) call,
 *     matched to our open deposits by transaction id.
 *   • Legacy Daraja fallback: STK query per open deposit.
 *   • Crypto (NOWPayments): GET /payment/{id} per open deposit.
 *
 * Every resolution goes through the same confirmDeposit/updateDepositStatus
 * guards as the webhooks, so running this can never double-credit.
 */

/** Deposit states that can still move to a terminal outcome. */
const OPEN_STATUSES = ["AWAITING_PAYMENT", "PAYMENT_DETECTED", "CONFIRMING", "CONFIRMED"];

export type ReconcileResult = {
  scanned: number;
  palplus: { listed: number; matched: number; credited: number; closed: number };
  daraja: { checked: number; credited: number };
  crypto: { checked: number; credited: number; closed: number };
  ranAt: string;
};

export type PalplusSyncOutcome = "credited" | "closed" | "pending";

/**
 * Apply a PalPluss terminal/ongoing state to one of our deposits. Shared by
 * the deposit modal's status poll and the reconciliation pass.
 */
export async function syncPalplusDeposit(
  depositId: string,
  tx: { status: string; transactionId: string }
): Promise<PalplusSyncOutcome> {
  if (tx.status === "SUCCESS") {
    await confirmDeposit(depositId, { providerRef: tx.transactionId }).catch(() => null);
    return "credited";
  }
  // Mirrors the webhook handler: failed/cancelled/expired are terminal;
  // REVERSED (wallet credited back) is treated as failed.
  const terminal: Record<string, string> = {
    FAILED: "FAILED",
    CANCELLED: "CANCELLED",
    EXPIRED: "EXPIRED",
    REVERSED: "FAILED",
  };
  const mapped = terminal[tx.status];
  if (mapped) {
    await updateDepositStatus(depositId, mapped).catch(() => null);
    return "closed";
  }
  return "pending";
}

/** NOWPayments GET /payment/{id} also returns these on top of the base type. */
type NpPaymentStatus = NpPayment & {
  actually_paid?: number;
  pay_address?: string;
  hash?: string;
};

/**
 * Mirror the crypto webhook's status mapping. `finished` credits ONLY when
 * the paid amount can be positively verified; if we can't verify, leave the
 * deposit for the webhook/admin rather than crediting on a guess.
 */
async function syncCryptoDeposit(
  deposit: { id: string; amount: unknown; status: string },
  pay: NpPaymentStatus,
  meta: Record<string, unknown>
): Promise<"credited" | "closed" | "pending" | "skipped"> {
  const status = String(pay.payment_status ?? "");
  switch (status) {
    case "finished": {
      const expected = Number(pay.pay_amount ?? meta.payAmount ?? 0);
      const paid = Number(pay.actually_paid ?? 0);
      const priceMatches =
        pay.price_amount === undefined || Math.abs(Number(pay.price_amount) - Number(deposit.amount)) <= 0.01;
      const paidEnough = expected > 0 && paid > 0 && paid >= expected * 0.995;
      if (!priceMatches || !paidEnough) return "skipped";
      // Never credit a window that already expired/failed.
      if (deposit.status === "EXPIRED" || deposit.status === "FAILED") return "skipped";
      await confirmDeposit(deposit.id, {
        providerRef: String(pay.payment_id),
        depositAddress: pay.pay_address,
        txHash: pay.hash,
      }).catch(() => null);
      return "credited";
    }
    case "confirming":
      await updateDepositStatus(deposit.id, "CONFIRMING").catch(() => null);
      return "pending";
    case "confirmed":
      await updateDepositStatus(deposit.id, "CONFIRMED").catch(() => null);
      return "pending";
    case "partially_paid":
      await updateDepositStatus(deposit.id, "PAYMENT_DETECTED").catch(() => null);
      return "pending";
    case "waiting":
      await updateDepositStatus(deposit.id, "AWAITING_PAYMENT").catch(() => null);
      return "pending";
    case "failed":
    case "refunded":
      await updateDepositStatus(deposit.id, "FAILED").catch(() => null);
      return "closed";
    case "expired":
      await updateDepositStatus(deposit.id, "EXPIRED").catch(() => null);
      return "closed";
    default:
      return "pending";
  }
}

function metaOf(metadata: string | null): Record<string, unknown> {
  try {
    return JSON.parse(metadata ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Reconcile every open deposit in the recent window. Bounded per rail so a
 * backlog can't hammer a provider (PalPluss allows 60 req/min/key).
 */
export async function reconcilePendingPayments(
  opts: { windowHours?: number; maxPerRail?: number } = {}
): Promise<ReconcileResult> {
  const windowHours = opts.windowHours ?? 24;
  const maxPerRail = opts.maxPerRail ?? 50;
  const since = new Date(Date.now() - windowHours * 3600_000);
  const settings = await getSettings();

  const out: ReconcileResult = {
    scanned: 0,
    palplus: { listed: 0, matched: 0, credited: 0, closed: 0 },
    daraja: { checked: 0, credited: 0 },
    crypto: { checked: 0, credited: 0, closed: 0 },
    ranAt: new Date().toISOString(),
  };

  const deposits = await prisma.deposit.findMany({
    where: { status: { in: OPEN_STATUSES }, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  out.scanned = deposits.length;
  if (deposits.length === 0) return out;

  // ── 1. PalPluss (live M-Pesa rail): one list call for all open deposits ──
  const palplusDeposits = deposits.filter(
    (d) => d.method === "MPESA" && metaOf(d.metadata).provider === "PALPLUS"
  );
  if (palplusDeposits.length > 0 && settings.palplusApiKey) {
    const byTx = new Map<string, (typeof palplusDeposits)[number]>();
    for (const d of palplusDeposits) {
      const m = metaOf(d.metadata);
      const tx = String(m.transactionId ?? m.checkoutRequestId ?? "");
      if (tx) byTx.set(tx, d);
    }
    if (byTx.size > 0) {
      const list = await palplusListTransactions({ type: "STK", limit: 100 }).catch(() => null);
      if (list) {
        out.palplus.listed = list.items.length;
        for (const item of list.items) {
          const d = byTx.get(item.transactionId);
          if (!d) continue;
          out.palplus.matched++;
          const r = await syncPalplusDeposit(d.id, {
            status: item.status,
            transactionId: item.transactionId,
          });
          if (r === "credited") out.palplus.credited++;
          else if (r === "closed") out.palplus.closed++;
        }
      }
    }
  }

  // ── 2. Legacy Daraja fallback: per-deposit STK query ────────────────────
  if (settings.mpesaEnabled) {
    const daraja = deposits.filter(
      (d) => d.method === "MPESA" && metaOf(d.metadata).provider !== "PALPLUS"
    );
    for (const d of daraja.slice(0, maxPerRail)) {
      const m = metaOf(d.metadata);
      const checkout = String(m.checkoutRequestId ?? m.transactionId ?? m.providerCheckoutId ?? "");
      if (!checkout) continue;
      out.daraja.checked++;
      const q = await mpesaStkQuery(checkout).catch(() => null);
      if (q?.ok) {
        await confirmDeposit(d.id, {
          txHash: `mpesa-${checkout.slice(0, 12)}`,
          providerRef: checkout,
        }).catch(() => null);
        out.daraja.credited++;
      }
    }
  }

  // ── 3. Crypto (NOWPayments): per-deposit payment status ─────────────────
  if (settings.cryptoApiKey) {
    const crypto = deposits.filter((d) => d.provider === "NOWPAYMENTS");
    for (const d of crypto.slice(0, maxPerRail)) {
      const m = metaOf(d.metadata);
      const paymentId = String(m.providerRef ?? m.payment_id ?? "");
      if (!paymentId) continue;
      out.crypto.checked++;
      const pay = await npGetPaymentStatus(paymentId).catch(() => null);
      if (!pay) continue;
      const r = await syncCryptoDeposit(
        { id: d.id, amount: d.amount, status: d.status },
        pay as NpPaymentStatus,
        m
      );
      if (r === "credited") out.crypto.credited++;
      else if (r === "closed") out.crypto.closed++;
    }
  }

  return out;
}
