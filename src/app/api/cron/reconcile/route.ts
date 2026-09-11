import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { checkCronSecret, makeCronJob } from "@/lib/cron-guard";
import { reconcilePendingPayments } from "@/lib/payment-reconcile";

/**
 * Cron endpoint — payment reconciliation (the missed-webhook safety net).
 *
 * Protect with the cron secret (Admin → Website Settings → Automation, or the
 * CRON_SECRET env var as fallback). Call from any scheduler, e.g. every 10 min:
 *
 *   cron-job.org / Railway cron / GitHub Actions:
 *     GET https://your-app/api/cron/reconcile?secret=<cron.secret>
 *
 * Re-derives the true status of open deposits from the providers directly:
 *   - PalPluss  → GET /transactions (one call, matched by transaction id)
 *   - Daraja    → per-deposit STK query (legacy fallback rail)
 *   - Crypto    → NOWPayments GET /payment/{id} per deposit
 * Confirms through the same guarded path as the webhooks, so it can never
 * double-credit. Safe to run frequently.
 */
const job = makeCronJob(Number(process.env.RECONCILE_THROTTLE_MINUTES) || 5);

export const GET = handle(async (req: NextRequest) => {
  await checkCronSecret(req);
  const { result, throttled, coalesced, retryInSeconds } = await job.run(() => reconcilePendingPayments());
  return ok({
    ...result,
    ...(throttled ? { throttled: true, retryInSeconds } : {}),
    ...(coalesced ? { coalesced: true } : {}),
  });
});

export const POST = GET;
