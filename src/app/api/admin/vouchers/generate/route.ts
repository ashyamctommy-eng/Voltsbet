import { NextRequest } from "next/server";
import { handle, ok, requireAdmin, verifyCsrf, auditLog, ApiError } from "@/lib/api";
import { generateVouchers } from "@/lib/vouchers";
import { z } from "zod";

const schema = z.object({
  currency: z.string().min(1),
  value: z.number().positive(),
  quantity: z.number().int().min(1).max(10000),
  expiresAt: z.string().optional().nullable(),
  prefix: z.string().optional(),
  batchName: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * POST /api/admin/vouchers/generate — bulk-generate voucher codes.
 * Full codes are returned ONCE in this response (for export/print); only
 * hashes are stored. Audited.
 */
export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const admin = await requireAdmin("vouchers");
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");

  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
  const result = await generateVouchers({
    currency: parsed.data.currency,
    value: parsed.data.value,
    quantity: parsed.data.quantity,
    expiresAt,
    prefix: parsed.data.prefix,
    batchName: parsed.data.batchName,
    notes: parsed.data.notes,
    createdBy: admin.id,
  });

  await auditLog({
    admin,
    action: "VOUCHER_GENERATED",
    entity: "VOUCHER_BATCH",
    entityId: result.batchId,
    prevValue: null,
    newValue: { quantity: result.count, currency: parsed.data.currency, value: parsed.data.value, prefix: result.prefix },
  });

  return ok({
    batchId: result.batchId,
    count: result.count,
    prefix: result.prefix,
    codes: result.codes, // one-shot full codes for immediate export/print
  });
});
