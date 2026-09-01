import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { confirmDeposit, updateDepositStatus } from "@/lib/deposits";

/**
 * M-Pesa STK Push callback — Safaricom calls this URL (with ?secret=) when the
 * customer completes the PIN prompt. ResultCode 0 = paid.
 *
 * Guarded by a secret query param because Safaricom callbacks are unauthenticated
 * (no signature). The secret is generated once and stored in settings
 * (mpesa.callbackSecret); the URL sent to Safaricom includes it.
 */
export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret") ?? "";
  const s = await getSettings();
  if (!s.mpesaCallbackSecret || secret !== s.mpesaCallbackSecret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let payload: { Body?: { stkCallback?: Record<string, unknown> } };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 });
  }

  const cb = payload.Body?.stkCallback;
  const checkoutRequestId = String(cb?.CheckoutRequestID ?? "");
  const resultCode = Number(cb?.ResultCode ?? -1);
  const resultDesc = String(cb?.ResultDesc ?? "");

  if (!checkoutRequestId) {
    return NextResponse.json({ ok: false, error: "Missing CheckoutRequestID" }, { status: 400 });
  }

  // Metadata Items → map (Amount, MpesaReceiptNumber, PhoneNumber, TransactionDate)
  const items = (cb?.CallbackMetadata as { Item?: { Name: string; Value: unknown }[] } | undefined)?.Item ?? [];
  const meta: Record<string, unknown> = {};
  for (const it of items) meta[it.Name] = it.Value;
  const receipt = String(meta.MpesaReceiptNumber ?? "");

  // Find the deposit we created with this checkoutRequestId
  const deposits = await prisma.deposit.findMany({ where: { method: "MPESA" } });
  const deposit = deposits.find((d) => {
    try {
      return JSON.parse(d.metadata ?? "{}").checkoutRequestId === checkoutRequestId;
    } catch {
      return false;
    }
  });

  if (!deposit) {
    // Acknowledge anyway (Safaricom doesn't need more than a 200).
    return NextResponse.json({ ok: true, message: "Unknown checkout" });
  }

  if (resultCode === 0) {
    await confirmDeposit(deposit.id, { txHash: receipt, providerRef: checkoutRequestId });
  } else {
    // Not paid yet (or failed): leave awaiting, but record the provider description.
    await updateDepositStatus(deposit.id, "AWAITING_PAYMENT");
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { metadata: JSON.stringify({ ...safeMeta(deposit.metadata), lastCallback: resultDesc }) },
    });
  }

  return NextResponse.json({ ok: true });
}

function safeMeta(metadata: string | null): Record<string, unknown> {
  try {
    return JSON.parse(metadata ?? "{}");
  } catch {
    return {};
  }
}
