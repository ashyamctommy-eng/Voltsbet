/**
 * POST /api/v1/settlement/process
 *
 * Intake for the external settlement worker (cPanel cron scraper → Railway).
 * See docs/AUTO-SETTLEMENT.md for the architecture, the threat model and the
 * operational runbook; worker/settle_worker.py is the other half of this
 * contract.
 *
 * WHY A NEXT.JS ROUTE HANDLER AND NOT A STANDALONE EXPRESS/FASTAPI SERVICE
 * The money path already lives in this process: `settleOutcome`, the wallet
 * ledger, the bet claims and the Prisma client. A second service would need
 * its own DB credentials, its own deploy and its own idea of the schema —
 * giving two writers to one ledger. That is the single most expensive mistake
 * available here, so the receiver is a route in the app that already owns the
 * money. It is deliberately NOT wrapped in `handle()`: that helper applies the
 * customer-facing maintenance gate, and settlement must keep running while the
 * site is in maintenance (the gate is also exempted in src/proxy.ts).
 *
 * Contract
 *   Headers: X-Voltbets-Signature: sha256=<hex(HMAC_SHA256(secret, ts + "." + body))>
 *            X-Voltbets-Timestamp: <unix seconds>   (±300s replay window)
 *            X-Voltbets-Event-Id:  <idempotency key> (mirrors body.eventId)
 *   Body:    JSON per src/lib/settlement/payload.ts
 *   Reply:   200 processed | 202 needs review | 400 bad payload
 *            401 bad signature/timestamp | 405 method | 503 secret unset
 *
 * Responses are intentionally terse: the worker logs the status code, and a
 * 4xx tells it NOT to retry (the payload is wrong), while 5xx means retry.
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { ingestSettlement } from "@/lib/settlement/ingest";
import { settlementPayloadSchema } from "@/lib/settlement/payload";
import { EVENT_ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySettlementSignature } from "@/lib/settlement/signature";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // node:crypto + Prisma — not edge

export async function POST(req: Request) {
  // The RAW bytes must be hashed, not a re-serialized object.
  const rawBody = await req.text();

  const settings = await getSettings();
  const check = verifySettlementSignature({
    secret: settings.settlementWebhookSecret,
    timestamp: req.headers.get(TIMESTAMP_HEADER),
    signature: req.headers.get(SIGNATURE_HEADER),
    rawBody,
  });
  if (!check.ok) {
    return NextResponse.json({ ok: false, error: check.reason }, { status: check.status });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "body is not valid JSON" }, { status: 400 });
  }

  const parsed = settlementPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid payload", issues: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 },
    );
  }

  // The header and the body must agree — a mismatch means a confused caller,
  // and settling the wrong event is worse than refusing it.
  const headerEventId = req.headers.get(EVENT_ID_HEADER);
  if (headerEventId && headerEventId !== parsed.data.eventId) {
    return NextResponse.json({ ok: false, error: "event id header does not match body" }, { status: 400 });
  }

  const payloadHash = createHash("sha256").update(rawBody, "utf8").digest("hex");

  try {
    const result = await ingestSettlement(parsed.data, rawBody, payloadHash);
    return NextResponse.json(
      { ok: true, ...result },
      { status: result.status === "NEEDS_REVIEW" ? 202 : 200 },
    );
  } catch (e) {
    // Unexpected failure: 500 so the worker retries. The event row (if written)
    // is re-processed on retry, and settlement is idempotent, so a retry is safe.
    console.error("[settlement] ingest failed", { eventId: parsed.data.eventId, error: e });
    return NextResponse.json({ ok: false, error: "ingest failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: false, error: "method not allowed" }, { status: 405, headers: { Allow: "POST" } });
}
