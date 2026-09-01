import { NextRequest } from "next/server";
import { handle, ok, sharedAdminGuard } from "@/lib/api";
import { palplusServiceBalance } from "@/lib/providers/palplus";

/**
 * POST /api/admin/payments/palplus-test — "Test connection" button.
 * Calls the read-only service-wallet balance endpoint with the key from the
 * settings form (unsaved value) or the saved key when the form still holds
 * the masked placeholder. Never initiates a payment.
 */
export const POST = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "settings");
  const body = (await req.json().catch(() => ({}))) as { apiKey?: string; env?: string };
  const apiKey = body.apiKey && body.apiKey !== "__MASKED__" ? body.apiKey : undefined;
  const balance = await palplusServiceBalance({ apiKey, env: body.env || undefined });
  return ok({
    balance: {
      availableBalance: balance.availableBalance,
      ledgerBalance: balance.ledgerBalance,
      currency: balance.currency,
    },
  });
});
