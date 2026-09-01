import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { checkCronSecret } from "@/lib/cron-guard";
import { syncMarketRates } from "@/lib/rates";

/**
 * GET /api/cron/rates — automated market-rate sync (fiat + crypto).
 *
 * Fetches live rates from free, keyless sources (open.er-api.com base KES +
 * CoinGecko USD prices) and writes them into the Currency table + settings
 * cryptoRates, so admins never maintain rates by hand. See src/lib/rates.ts.
 *
 * Throttled to one run per RATES_SYNC_THROTTLE_MINUTES (default 60);
 * overlapping triggers return { throttled: true } (escape hatch: ?force=1).
 * Protect with the cron secret (Admin → Website Settings → Automation, or
 * CRON_SECRET env). Run daily — the FX source updates once a day.
 *
 *   200 with counts · 401 without the secret · 503 if unconfigured
 */
const THROTTLE_MS = (Number(process.env.RATES_SYNC_THROTTLE_MINUTES) || 60) * 60 * 1000;
let lastSyncAt = 0;
let inFlight: Promise<Record<string, unknown>> | null = null;

export const GET = handle(async (req: NextRequest) => {
  await checkCronSecret(req);
  const force = req.nextUrl.searchParams.get("force") === "1";

  if (!force && lastSyncAt > 0 && Date.now() - lastSyncAt < THROTTLE_MS) {
    return ok({
      ok: true,
      throttled: true,
      retryInSeconds: Math.ceil((THROTTLE_MS - (Date.now() - lastSyncAt)) / 1000),
      lastSyncAt: new Date(lastSyncAt).toISOString(),
    });
  }

  if (inFlight) return ok({ ...(await inFlight), coalesced: true });

  inFlight = (async () => {
    const result = await syncMarketRates();
    return { ok: true, ...result };
  })();
  try {
    return ok(await inFlight);
  } finally {
    inFlight = null;
    lastSyncAt = Date.now();
  }
});

export const POST = GET;
