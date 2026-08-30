import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { npVerifyIpn } from "@/lib/providers/nowpayments";
import { confirmDeposit, updateDepositStatus } from "@/lib/deposits";

/**
 * NOWPayments IPN webhook.
 * Configure the URL in the NOWPayments dashboard (or pass ipn_callback_url per
 * payment): {APP_URL}/api/webhooks/crypto/nowpayments
 * Signature header: x-nowpayments-sig = HMAC-SHA512(raw body, IPN secret)
 *
 * Amount safety: a payment is only credited when the crypto actually paid
 * covers what we asked for (with a small tolerance for network/rounding
 * drift). Underpayments and price mismatches are marked UNDERPAID and are
 * NEVER auto-credited — the wallet only ever receives verified funds.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("x-nowpayments-sig");

  if (!(await npVerifyIpn(raw, sig))) {
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  let body: {
    payment_id?: number | string;
    payment_status?: string;
    pay_address?: string;
    order_id?: string;
    actually_paid?: number;
    pay_amount?: number;
    pay_currency?: string;
    price_amount?: number;
    price_currency?: string;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 });
  }

  const paymentId = String(body.payment_id ?? "");
  const status = body.payment_status ?? "";
  const orderId = String(body.order_id ?? "");
  if (!paymentId || !status) {
    return NextResponse.json({ ok: false, error: "Missing payment_id/status" }, { status: 400 });
  }

  // Find our deposit: prefer order_id (= our deposit id), fall back to the
  // legacy metadata.providerRef scan.
  let deposit = orderId
    ? await prisma.deposit.findUnique({ where: { id: orderId } })
    : null;
  if (!deposit) {
    const deposits = await prisma.deposit.findMany({ where: { provider: "NOWPAYMENTS" } });
    deposit = deposits.find((d) => {
      try {
        return JSON.parse(d.metadata ?? "{}").providerRef === paymentId;
      } catch {
        return false;
      }
    }) ?? null;
  }
  if (!deposit) {
    // Unknown payment — acknowledge so the provider stops retrying, log only.
    return NextResponse.json({ ok: true, message: "Unknown order" });
  }

  // Amount verification — only "finished" payments can credit, and only when
  // the paid crypto covers the requested amount.
  if (status === "finished") {
    const paid = Number(body.actually_paid ?? 0);
    let expected = Number(body.pay_amount ?? 0);
    try {
      const meta = JSON.parse(deposit.metadata ?? "{}");
      expected = expected || Number(meta.payAmount ?? 0);
    } catch {}

    const priceMatches =
      body.price_amount === undefined ||
      Math.abs(Number(body.price_amount) - Number(deposit.amount)) <= 0.01;
    const paidEnough = expected > 0 && paid >= expected * 0.995;

    if (!priceMatches || !paidEnough) {
      await updateDepositStatus(deposit.id, "UNDERPAID");
      return NextResponse.json({
        ok: true,
        note: "Underpaid or mismatched — marked UNDERPAID, not credited",
        paid,
        expected,
        depositAmount: Number(deposit.amount),
      });
    }

    // Fully paid now — if a previous IPN marked this UNDERPAID, move it back
    // to a creditable status so the credit below goes through.
    if (deposit.status === "UNDERPAID") {
      await updateDepositStatus(deposit.id, "PAYMENT_DETECTED");
    }
  }

  switch (status) {
    case "finished":
      await confirmDeposit(deposit.id, { txHash: body.pay_address, providerRef: paymentId });
      break;
    case "confirming":
      await updateDepositStatus(deposit.id, "CONFIRMING");
      break;
    case "confirmed":
      await updateDepositStatus(deposit.id, "CONFIRMED");
      break;
    case "partially_paid":
      await updateDepositStatus(deposit.id, "PAYMENT_DETECTED");
      break;
    case "waiting":
      await updateDepositStatus(deposit.id, "AWAITING_PAYMENT");
      break;
    case "failed":
    case "refunded":
      await updateDepositStatus(deposit.id, "FAILED");
      break;
    case "expired":
      await updateDepositStatus(deposit.id, "EXPIRED");
      break;
  }

  return NextResponse.json({ ok: true });
}
