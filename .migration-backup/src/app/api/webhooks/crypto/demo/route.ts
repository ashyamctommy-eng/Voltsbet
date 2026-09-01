import { NextRequest } from "next/server";
import { handle, ok, ApiError } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { confirmDeposit } from "@/lib/deposits";

/**
 * DEMO-ONLY webhook: simulates a crypto provider confirming a payment.
 * A real provider (NOWPayments etc.) verifies its HMAC signature and then
 * runs the same confirmDeposit() logic — see /api/webhooks/crypto/nowpayments.
 */
export const POST = handle(async (req: NextRequest) => {
  const raw = await req.json().catch(() => null);
  const depositId = (raw?.deposit_id ?? raw?.depositId ?? "") as string;
  if (!depositId) throw new ApiError(400, "Missing deposit_id.", "BAD_REQUEST");

  // Demo mode only: real providers are enforced in their own routes
  const settings = await getSettings();
  if (settings.cryptoApiKey) {
    throw new ApiError(403, "Demo webhook disabled while a real provider is configured.", "DEMO_DISABLED");
  }

  const result = await confirmDeposit(depositId, {
    txHash: raw?.tx_hash ?? raw?.txHash ?? `demo-${Date.now().toString(16)}`,
    providerRef: "demo",
  });
  return ok({ message: result.alreadyCompleted ? "Already completed" : "Deposit confirmed and credited", ...result });
});
