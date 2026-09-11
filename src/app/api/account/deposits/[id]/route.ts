import { handle, ok, requireUser, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { mpesaStkQuery } from "@/lib/providers/mpesa";
import { getSettings } from "@/lib/settings";
import { confirmDeposit, mpesaCheckoutId } from "@/lib/deposits";

/**
 * GET /api/account/deposits/[id] — poll a deposit's live status.
 * For M-Pesa this queries Safaricom directly so the UI can reflect the
 * payment the moment the user's PIN prompt completes.
 */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const deposit = await prisma.deposit.findUnique({ where: { id } });
  if (!deposit || deposit.userId !== user.id) {
    throw new ApiError(404, "Deposit not found.", "NOT_FOUND");
  }

  // M-Pesa (legacy Daraja rail): poll Safaricom for the result, since the
  // webhook may lag by seconds. Palplus deposits are confirmed by their own
  // webhook — querying Safaricom for them would 404 on an unknown checkout.
  if (deposit.method === "MPESA" && deposit.status !== "COMPLETED") {
    const settings = await getSettings();
    if (settings.mpesaEnabled) {
      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(deposit.metadata ?? "{}"); } catch {}
      const checkout = mpesaCheckoutId(meta);
      if (checkout && meta.provider !== "PALPLUS") {
        const q = await mpesaStkQuery(checkout).catch(() => null);
        if (q?.ok) {
          await confirmDeposit(deposit.id, { txHash: `mpesa-${checkout.slice(0, 12)}`, providerRef: checkout });
        }
      }
    }
  }

  const fresh = await prisma.deposit.findUnique({ where: { id } });
  return ok({
    deposit: {
      id: fresh!.id,
      amount: Number(fresh!.amount),
      currencyCode: fresh!.currencyCode,
      status: fresh!.status,
      method: fresh!.method,
      cryptoCurrency: fresh!.cryptoCurrency,
      createdAt: fresh!.createdAt,
      confirmedAt: fresh!.confirmedAt,
    },
  });
});
