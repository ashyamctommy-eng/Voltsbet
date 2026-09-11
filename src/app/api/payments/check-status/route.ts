import { NextRequest } from "next/server";
import { handle, ok, requireUser, verifyCsrf, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { confirmDeposit, mpesaCheckoutId } from "@/lib/deposits";
import { mpesaStkQuery } from "@/lib/providers/mpesa";
import { palplusGetTransaction } from "@/lib/providers/palplus";
import { syncPalplusDeposit } from "@/lib/payment-reconcile";

/**
 * Payment status endpoint for the deposit modal.
 *
 *   GET  /api/payments/check-status?depositId=<id>
 *        → { deposit: { id, status, amount, currencyCode, method, … } }
 *
 *   POST /api/payments/check-status   { depositId, event: "TIMEOUT_CANCELLED" }
 *        → records the client-side cancellation event.
 *
 * The GET resolves live status without waiting on a callback:
 *   • PalPluss (the live M-Pesa rail): `GET /transactions/{id}`, throttled to
 *     one outbound call per deposit per 10 s — their documented polling
 *     cadence, and well under their 60 req/min/key limit.
 *   • Legacy Daraja fallback: query Safaricom's STK status directly.
 * A confirmed result credits the wallet through the shared confirmDeposit
 * path, so polling can never double-credit. The 3 s UI cadence is the modal's.
 */

function safeMeta(metadata: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(metadata ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * PalPluss status polls are throttled to one outbound GET per deposit per
 * 10 s. Their docs recommend 10 s polling and their API key allows only
 * 60 req/min — the modal's 3 s UI cadence must not translate 1:1 into
 * provider calls. Best-effort, per-process (fine: webhooks remain primary).
 */
const PALPLUS_POLL_MS = 10_000;
const palplusPolledAt = new Map<string, number>();

function shouldPollPalplus(depositId: string): boolean {
  const now = Date.now();
  const last = palplusPolledAt.get(depositId) ?? 0;
  if (now - last < PALPLUS_POLL_MS) return false;
  palplusPolledAt.set(depositId, now);
  if (palplusPolledAt.size > 500) {
    for (const [key, at] of palplusPolledAt) if (now - at > 60_000) palplusPolledAt.delete(key);
  }
  return true;
}

export const GET = handle(async (req: NextRequest) => {
  const user = await requireUser();
  const depositId =
    req.nextUrl.searchParams.get("depositId") ?? req.nextUrl.searchParams.get("id") ?? "";
  if (!depositId) throw new ApiError(400, "depositId is required.", "VALIDATION");

  let deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  // Admins may look up any deposit; a customer only their own.
  if (!deposit || (deposit.userId !== user.id && user.role === "CUSTOMER")) {
    throw new ApiError(404, "Deposit not found.", "NOT_FOUND");
  }

  if (deposit.method === "MPESA" && deposit.status !== "COMPLETED") {
    const settings = await getSettings();
    const meta = safeMeta(deposit.metadata);
    const checkout = mpesaCheckoutId(meta);
    if (checkout) {
      if (meta.provider === "PALPLUS") {
        // Live rail: PalPluss GET /transactions/{id} is authoritative.
        // Webhooks stay primary; this is the documented fallback + the path
        // that makes the modal resolve quickly if a callback lags.
        if (shouldPollPalplus(deposit.id)) {
          const tx = await palplusGetTransaction(checkout).catch(() => null);
          if (tx) await syncPalplusDeposit(deposit.id, tx);
        }
      } else if (settings.mpesaEnabled) {
        // Legacy Daraja fallback rail — query Safaricom directly.
        const q = await mpesaStkQuery(checkout).catch(() => null);
        if (q?.ok) {
          await confirmDeposit(deposit.id, {
            txHash: `mpesa-${checkout.slice(0, 12)}`,
            providerRef: checkout,
          }).catch(() => null);
        }
      }
    }
    deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  }

  const meta = safeMeta(deposit!.metadata);
  return ok({
    deposit: {
      id: deposit!.id,
      status: deposit!.status,
      amount: Number(deposit!.amount),
      currencyCode: deposit!.currencyCode,
      method: deposit!.method,
      cryptoCurrency: deposit!.cryptoCurrency,
      confirmedAt: deposit!.confirmedAt,
      timeoutCancelled: meta.timeoutCancelled === true,
    },
  });
});

export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const user = await requireUser();
  const body = (await req.json().catch(() => null)) as
    | { depositId?: string; event?: string }
    | null;
  const depositId = String(body?.depositId ?? "");
  const event = String(body?.event ?? "");
  if (!depositId) throw new ApiError(400, "depositId is required.", "VALIDATION");
  if (event !== "TIMEOUT_CANCELLED") {
    throw new ApiError(400, "Unsupported event.", "VALIDATION");
  }

  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit || (deposit.userId !== user.id && user.role === "CUSTOMER")) {
    throw new ApiError(404, "Deposit not found.", "NOT_FOUND");
  }

  // Money-safety: record the timeout event, but DO NOT move the deposit to a
  // non-creditable status. If the customer entered their PIN just as the
  // window lapsed, the provider callback can still land — and a real payment
  // must always be able to credit the wallet.
  if (deposit.status !== "COMPLETED") {
    const meta = safeMeta(deposit.metadata);
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: {
        metadata: JSON.stringify({
          ...meta,
          timeoutCancelled: true,
          timeoutCancelledAt: new Date().toISOString(),
        }),
      },
    });
  }

  const fresh = await prisma.deposit.findUnique({ where: { id: depositId }, select: { status: true } });
  return ok({
    cancelled: true,
    status: fresh?.status ?? deposit.status,
    message: "Timed out — you can retry the payment.",
  });
});
