import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { npVerifyIpn } from "@/lib/providers/nowpayments";
import { confirmDeposit, updateDepositStatus } from "@/lib/deposits";

/**
 * NOWPayments IPN webhook.
 * Configure the URL in the NOWPayments dashboard (or pass ipn_callback_url per
 * payment): {APP_URL}/api/webhooks/crypto/nowpayments
 * Signature header: x-nowpayments-sig = HMAC-SHA512(raw body, IPN secret).
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
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 });
  }

  const paymentId = String(body.payment_id ?? "");
  const status = body.payment_status ?? "";
  if (!paymentId || !status) {
    return NextResponse.json({ ok: false, error: "Missing payment_id/status" }, { status: 400 });
  }

  // Find our deposit via metadata.providerRef = NOWPayments payment_id
  const deposits = await prisma.deposit.findMany({ where: { provider: "NOWPAYMENTS" } });
  const deposit = deposits.find((d) => {
    try {
      return JSON.parse(d.metadata ?? "{}").providerRef === paymentId;
    } catch {
      return false;
    }
  });
  if (!deposit) {
    // Unknown payment — acknowledge so the provider stops retrying, log only.
    return NextResponse.json({ ok: true, message: "Unknown order" });
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
