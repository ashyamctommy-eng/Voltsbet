import { createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";
import { ApiError } from "./api";
import { getSettings } from "./settings";
import { isUserActionAllowed } from "./statuses";
import { creditWallet, toCents } from "./wallet";
import { currencyMap, convert } from "./currency";
import type { User } from "@prisma/client";

/**
 * Voucher deposit engine.
 *
 * Security model:
 *  - The full voucher code is a bearer credential: generated with
 *    cryptographically-secure randomness, shown ONCE at generation (and on
 *    elevated export/print), and NEVER stored — only a sha256 hash (unique),
 *    the last 4 chars and a masked display form live in the DB.
 *  - All validation is server-side; the value/currency/status always come
 *    from the DB, never from the client.
 *  - Redemption claims the voucher UNUSED → REDEEMED atomically inside the
 *    same transaction that credits the wallet (row-level claim via
 *    updateMany + the unique codeHash), so two concurrent requests can never
 *    both credit, and the wallet is never credited without the voucher being
 *    marked used (and vice versa).
 */

export const VOUCHER_STATUSES = ["UNUSED", "REDEEMED", "EXPIRED", "CANCELLED", "SUSPENDED"] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
const CODE_GROUPS = 3; // PREFIX-XXXX-XXXX-XXXX
const CODE_GROUP_LEN = 4;
const DEFAULT_PREFIX = "TTB";
/** Max vouchers per generation call (guards the createMany batch). */
const MAX_GENERATE = 10_000;
/** Generation retries on the (astronomically rare) DB hash collision. */
const MAX_GENERATE_ATTEMPTS = 3;

/** sha256 hex — the only representation of a code we persist. */
export function hashVoucherCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Normalize user/admin input: strip separators/whitespace, uppercase. */
export function normalizeVoucherCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function randomGroup(): string {
  const bytes = randomBytes(CODE_GROUP_LEN);
  let out = "";
  for (let i = 0; i < CODE_GROUP_LEN; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

/** Full code: PREFIX-XXXX-XXXX-XXXX (~56 bits of entropy). The prefix is
 *  normalized (uppercase alphanumeric) so displayed and hashed forms are
 *  always consistent. */
export function generateVoucherCode(prefix: string): string {
  const groups = Array.from({ length: CODE_GROUPS }, randomGroup);
  return `${normalizeVoucherCode(prefix) || DEFAULT_PREFIX}-${groups.join("-")}`;
}

/** Masked display form: PREFIX-****-****-ABCD (last group kept for reference). */
export function maskVoucherCode(code: string): string {
  const groups = code.split("-");
  const last = groups[groups.length - 1] ?? "";
  return `${groups.slice(0, -1).join("-")}-****-${last}`;
}

/** Build a unique batch of codes locally (Set-based); DB uniqueness is
 *  enforced by the unique codeHash index with a retry on P2002. */
function generateUniqueCodes(prefix: string, count: number): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  let guard = 0;
  while (codes.length < count && guard < count * 10 + 100) {
    guard++;
    const code = generateVoucherCode(prefix);
    if (!seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }
  if (codes.length < count) {
    throw new ApiError(500, "Could not generate enough unique codes — retry.", "GENERATION_FAILED");
  }
  return codes;
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof ApiError ? false : e instanceof Error && "code" in e && (e as { code: string }).code === "P2002";
}

export type GenerateVouchersInput = {
  currency: string;
  value: number;
  quantity: number;
  expiresAt?: Date | null;
  prefix?: string;
  batchName?: string;
  notes?: string;
  createdBy?: string;
};

export type GenerateVouchersResult = {
  batchId: string;
  count: number;
  prefix: string;
  codes: string[]; // full codes — returned ONCE; only hashes are stored
};

/** Bulk-generate vouchers: batch row + N unique codes (hashed at rest). */
export async function generateVouchers(input: GenerateVouchersInput): Promise<GenerateVouchersResult> {
  const quantity = Math.floor(input.quantity);
  if (!(quantity >= 1 && quantity <= MAX_GENERATE)) {
    throw new ApiError(400, `Quantity must be between 1 and ${MAX_GENERATE}.`, "BAD_QUANTITY");
  }
  const value = Math.round(input.value * 100) / 100;
  if (!(value > 0)) throw new ApiError(400, "Voucher value must be positive.", "BAD_VALUE");
  const currency = input.currency.trim().toUpperCase();
  const currencyRow = await prisma.currency.findUnique({ where: { code: currency } });
  if (!currencyRow?.active) throw new ApiError(400, `Unknown or inactive currency: ${currency}.`, "BAD_CURRENCY");
  if (input.expiresAt && !(input.expiresAt.getTime() > Date.now())) {
    throw new ApiError(400, "Expiry date must be in the future.", "BAD_EXPIRY");
  }

  const prefix = (input.prefix?.trim().toUpperCase() || DEFAULT_PREFIX).replace(/[^A-Z0-9]/g, "").slice(0, 8) || DEFAULT_PREFIX;
  const batch = await prisma.voucherBatch.create({
    data: {
      name: input.batchName?.trim() || null,
      currency,
      value: value.toFixed(2),
      quantity,
      prefix,
      notes: input.notes?.trim() || null,
      createdBy: input.createdBy ?? null,
    },
  });

  let codes: string[] = [];
  for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
    codes = generateUniqueCodes(prefix, quantity);
    try {
      await prisma.voucher.createMany({
        data: codes.map((code) => ({
          // Hash the NORMALIZED code (no separators, uppercase) — redemption
          // and admin search both hash the normalized form, so a code is
          // found no matter how the holder types it (dashes/spaces/case).
          codeHash: hashVoucherCode(normalizeVoucherCode(code)),
          codeLast4: code.slice(-4),
          displayCode: maskVoucherCode(code),
          value: value.toFixed(2),
          currency,
          status: "UNUSED",
          batchId: batch.id,
          expiresAt: input.expiresAt ?? null,
          notes: input.notes?.trim() || null,
          createdById: input.createdBy ?? null,
        })),
        skipDuplicates: true, // belt-and-braces: never let a hash collision abort the batch
      });
      break;
    } catch (e) {
      if (isUniqueViolation(e) && attempt < MAX_GENERATE_ATTEMPTS - 1) continue;
      throw e;
    }
  }
  if (codes.length !== quantity) {
    // A (practically impossible) collision with an existing code dropped rows.
    await prisma.voucherBatch.delete({ where: { id: batch.id } }).catch(() => {});
    throw new ApiError(500, "Voucher generation failed — try again.", "GENERATION_FAILED");
  }

  return { batchId: batch.id, count: quantity, prefix, codes };
}

export type RedeemResult = {
  amount: number;
  currency: string;
  transactionId: string; // DEP-YYYYMMDD-XXXXXX reference
  newBalance: number;
};

/** Human-friendly deposit reference: DEP-20260829-A1B2C3. */
function depositReference(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const suffix = randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
  return `DEP-${ymd}-${suffix}`;
}

/**
 * Redeem a voucher: validate server-side, then claim + credit atomically.
 * All failure messages are user-safe (no enumeration of whether a code
 * exists — nonexistent codes get the same generic error).
 */
export async function redeemVoucher(
  user: User,
  rawCode: string,
  meta: { ip?: string; deviceInfo?: string },
): Promise<RedeemResult> {
  const settings = await getSettings();
  if (!settings.paymentsVoucherEnabled) {
    throw new ApiError(403, "Voucher deposits are currently disabled.", "VOUCHER_DISABLED");
  }
  if (!(await isUserActionAllowed(user.status, "deposit"))) {
    throw new ApiError(403, "Deposits are currently disabled for your account.", "DEPOSIT_LOCKED");
  }

  const code = normalizeVoucherCode(rawCode);
  if (code.length < 8) {
    throw new ApiError(400, "The voucher code is invalid. Please check the code and try again.", "INVALID_VOUCHER");
  }
  const codeHash = hashVoucherCode(code);

  const voucher = await prisma.voucher.findUnique({ where: { codeHash } });
  if (!voucher) {
    await auditRedemptionFailure("NOT_FOUND", user, codeHash, meta, "The voucher code is invalid. Please check the code and try again.");
    // Generic on purpose — never confirm whether a guessed code exists.
    throw new ApiError(400, "The voucher code is invalid. Please check the code and try again.", "INVALID_VOUCHER");
  }

  // Multi-currency redemption: a voucher issued in a different currency is
  // converted to the wallet's currency at the system exchange rates before
  // crediting. The voucher is refused ONLY when no usable rate exists
  // (unknown/inactive currency) — we never guess a conversion.
  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  const walletCurrency = wallet?.currencyCode ?? user.currencyCode;
  let amount = toCents(Number(voucher.value));
  let creditCurrency = voucher.currency;
  if (walletCurrency !== voucher.currency) {
    const map = await currencyMap();
    if (!map[voucher.currency] || !map[walletCurrency]) {
      throw new ApiError(400, "This voucher is not valid for your account's currency.", "CURRENCY_MISMATCH");
    }
    amount = toCents(await convert(amount, voucher.currency, walletCurrency));
    creditCurrency = walletCurrency;
  }
  // Deposit cap: check the amount actually credited (post-conversion).
  if (settings.cryptoMaxDeposit > 0 && amount > settings.cryptoMaxDeposit) {
    throw new ApiError(400, "This voucher exceeds the maximum deposit allowed on your account.", "MAX_DEPOSIT");
  }

  // Status gates (specific messages for a REAL code the holder legitimately owns).
  const expired =
    voucher.status === "EXPIRED" || (voucher.expiresAt && voucher.expiresAt.getTime() < Date.now());
  switch (voucher.status) {
    case "REDEEMED":
      throw new ApiError(409, "This voucher has already been redeemed.", "ALREADY_REDEEMED");
    case "CANCELLED":
      throw new ApiError(409, "This voucher is no longer valid.", "CANCELLED");
    case "SUSPENDED":
      throw new ApiError(409, "This voucher is temporarily unavailable.", "SUSPENDED");
    case "EXPIRED":
      throw new ApiError(410, "This voucher has expired.", "EXPIRED");
    case "UNUSED":
      if (expired) {
        // Lazy expiry: mark it expired now (idempotent) so admin lists are honest.
        await prisma.voucher.update({ where: { id: voucher.id }, data: { status: "EXPIRED" } }).catch(() => {});
        throw new ApiError(410, "This voucher has expired.", "EXPIRED");
      }
      break;
  }

  const result = await prisma.$transaction(async (tx) => {
    // Atomic claim — exactly one concurrent request can flip UNUSED → REDEEMED.
    const claimed = await tx.voucher.updateMany({
      where: { id: voucher.id, status: "UNUSED" },
      data: { status: "REDEEMED", redeemedAt: new Date(), redeemedById: user.id },
    });
    if (claimed.count === 0) {
      const fresh = await tx.voucher.findUnique({ where: { id: voucher.id }, select: { status: true } });
      throw new ApiError(409, voucherMessageFor(fresh?.status), "ALREADY_REDEEMED");
    }

    const ref = depositReference();
    const { next } = await creditWallet(tx, user.id, amount, {
      type: "DEPOSIT",
      method: "VOUCHER",
      reason: `Voucher deposit${creditCurrency !== voucher.currency ? ` (${voucher.currency} → ${creditCurrency})` : ""}`,
      reference: ref,
      currencyCode: creditCurrency,
    });

    const redemption = await tx.voucherRedemption.create({
      data: {
        voucherId: voucher.id,
        userId: user.id,
        amount: amount.toFixed(2),
        currency: creditCurrency,
        ipAddress: meta.ip ?? null,
        deviceInfo: meta.deviceInfo ?? null,
      },
    });

    await tx.notification.create({
      data: {
        userId: user.id,
        type: "DEPOSIT",
        title: "Voucher Deposit Successful ✅",
        message: `${amount} ${creditCurrency} has been added to your wallet.\nTransaction: ${ref}\nNew balance: ${next} ${creditCurrency}`,
      },
    });

    // Immutable audit trail (in-tx, same row as the money movement).
    await tx.auditLog.create({
      data: {
        adminId: user.id,
        adminName: user.username,
        action: "VOUCHER_REDEEMED",
        entity: "VOUCHER",
        entityId: voucher.id,
        userId: user.id,
        ip: meta.ip ?? null,
        prevValue: JSON.stringify({ status: "UNUSED", codeLast4: voucher.codeLast4 }),
        newValue: JSON.stringify({
          status: "REDEEMED",
          amount,
          currency: creditCurrency,
          ...(creditCurrency !== voucher.currency
            ? { originalCurrency: voucher.currency, originalAmount: Number(voucher.value) }
            : {}),
          reference: ref,
        }),
      },
    });

    return { next, ref, redemptionId: redemption.id };
  });

  return {
    amount,
    currency: creditCurrency,
    transactionId: result.ref,
    newBalance: result.next,
  };
}

function voucherMessageFor(status: string | undefined): string {
  switch (status) {
    case "REDEEMED":
      return "This voucher has already been redeemed.";
    case "CANCELLED":
      return "This voucher is no longer valid.";
    case "SUSPENDED":
      return "This voucher is temporarily unavailable.";
    case "EXPIRED":
      return "This voucher has expired.";
    default:
      return "This voucher is no longer available.";
  }
}

/** Audit a failed redemption attempt (brute-force monitoring). The raw code
 *  is never logged — only its hash. */
async function auditRedemptionFailure(
  reason: string,
  user: User,
  codeHash: string,
  meta: { ip?: string },
  message: string,
) {
  await prisma.auditLog
    .create({
      data: {
        adminId: user.id,
        adminName: user.username,
        action: "VOUCHER_REDEEM_FAILED",
        entity: "VOUCHER",
        userId: user.id,
        ip: meta.ip ?? null,
        newValue: JSON.stringify({ reason, codeHashPrefix: codeHash.slice(0, 12), message }),
      },
    })
    .catch(() => {}); // audit must never block the redemption flow
}

/** Admin status transitions (cancel / suspend / reactivate). */
export async function updateVoucherStatus(
  admin: { id: string; username: string },
  voucherId: string,
  newStatus: Extract<VoucherStatus, "CANCELLED" | "SUSPENDED" | "UNUSED">,
): Promise<{ status: string }> {
  const voucher = await prisma.voucher.findUnique({ where: { id: voucherId } });
  if (!voucher) throw new ApiError(404, "Voucher not found.", "NOT_FOUND");
  if (voucher.status === "REDEEMED") {
    throw new ApiError(409, "A redeemed voucher cannot be changed.", "LOCKED");
  }
  if (voucher.status === newStatus) {
    throw new ApiError(409, `Voucher is already ${newStatus.toLowerCase()}.`, "SAME_STATUS");
  }
  if (newStatus === "UNUSED" && voucher.status !== "CANCELLED" && voucher.status !== "SUSPENDED") {
    throw new ApiError(409, "Only cancelled/suspended vouchers can be reactivated.", "BAD_TRANSITION");
  }

  const data: Record<string, unknown> = { status: newStatus };
  if (newStatus === "CANCELLED") {
    data.cancelledAt = new Date();
    data.cancelledBy = admin.id;
    data.suspendedAt = null;
    data.suspendedBy = null;
  } else if (newStatus === "SUSPENDED") {
    data.suspendedAt = new Date();
    data.suspendedBy = admin.id;
    data.cancelledAt = null;
    data.cancelledBy = null;
  } else {
    data.cancelledAt = null;
    data.cancelledBy = null;
    data.suspendedAt = null;
    data.suspendedBy = null;
  }

  const updated = await prisma.voucher.update({ where: { id: voucherId }, data });
  await prisma.auditLog.create({
    data: {
      adminId: admin.id,
      adminName: admin.username,
      action: `VOUCHER_${newStatus}`,
      entity: "VOUCHER",
      entityId: voucherId,
      prevValue: JSON.stringify({ status: voucher.status }),
      newValue: JSON.stringify({ status: newStatus }),
    },
  });
  return { status: updated.status };
}

// ─────────────────────────── Admin queries ──────────────────────────────

export type VoucherFilters = {
  status?: string;
  currency?: string;
  value?: number;
  batchId?: string;
  q?: string; // full code (hashed), last-4, or masked display match
  from?: Date;
  to?: Date;
  redeemedFrom?: Date;
  redeemedTo?: Date;
  page?: number;
  limit?: number;
  sort?: "createdAt" | "redeemedAt" | "value" | "expiresAt";
  order?: "asc" | "desc";
};

/** Admin voucher list — masked codes only; full codes never leave the server
 *  (except the one-shot generation/export responses). */
export async function listVouchers(f: VoucherFilters) {
  const where: Record<string, unknown> = {};
  if (f.status && f.status !== "ALL") where.status = f.status;
  if (f.currency) where.currency = f.currency;
  if (f.value) where.value = Number(f.value).toFixed(2);
  if (f.batchId) where.batchId = f.batchId;
  if (f.from || f.to) {
    where.createdAt = {
      ...(f.from ? { gte: f.from } : {}),
      ...(f.to ? { lt: f.to } : {}),
    };
  }
  if (f.redeemedFrom || f.redeemedTo) {
    where.redeemedAt = {
      ...(f.redeemedFrom ? { gte: f.redeemedFrom } : {}),
      ...(f.redeemedTo ? { lt: f.redeemedTo } : {}),
    };
  }
  if (f.q) {
    const q = f.q.trim();
    const normalized = normalizeVoucherCode(q);
    if (normalized.length >= 8) {
      where.OR = [
        { codeHash: hashVoucherCode(normalized) },
        { codeLast4: normalized.slice(-4) },
        { displayCode: { contains: normalized, mode: "insensitive" } },
      ];
    } else {
      where.OR = [
        { codeLast4: normalized },
        { displayCode: { contains: normalized, mode: "insensitive" } },
      ];
    }
  }

  const page = Math.max(1, f.page ?? 1);
  const limit = Math.min(Math.max(f.limit ?? 20, 1), 200);
  const orderBy = { [f.sort ?? "createdAt"]: f.order ?? "desc" };

  const [total, vouchers, stats] = await Promise.all([
    prisma.voucher.count({ where }),
    prisma.voucher.findMany({
      where,
      include: {
        batch: { select: { name: true } },
        redemption: { select: { userId: true, redeemedAt: true, transactionId: true, ipAddress: true } },
      },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.voucher.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  // Resolve redeemed-by usernames (list display).
  const redeemedByIds = [...new Set(vouchers.map((v) => v.redemption?.userId).filter(Boolean))] as string[];
  const users = redeemedByIds.length
    ? await prisma.user.findMany({ where: { id: { in: redeemedByIds } }, select: { id: true, username: true } })
    : [];
  const usernameOf = new Map(users.map((u) => [u.id, u.username]));

  return {
    vouchers: vouchers.map((v) => ({
      id: v.id,
      displayCode: v.displayCode,
      codeLast4: v.codeLast4,
      value: Number(v.value),
      currency: v.currency,
      status: v.status,
      batchId: v.batchId,
      batchName: v.batch?.name ?? null,
      expiresAt: v.expiresAt,
      createdAt: v.createdAt,
      redeemedBy: v.redemption?.userId ? usernameOf.get(v.redemption.userId) ?? null : null,
      redeemedAt: v.redemption?.redeemedAt ?? null,
      transactionId: v.redemption?.transactionId ?? null,
    })),
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    page,
    limit,
    stats: Object.fromEntries(stats.map((s) => [s.status, s._count._all])) as Record<string, number>,
  };
}

/** Dashboard statistics — totals + usage over the last 30 days. */
export async function voucherStats() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo30 = new Date(now.getTime() - 30 * 86400_000);

  const [byStatus, valueAgg, today, month, daily] = await Promise.all([
    prisma.voucher.groupBy({ by: ["status"], _count: { _all: true }, _sum: { value: true } }),
    prisma.voucher.aggregate({ _sum: { value: true } }),
    prisma.voucherRedemption.count({ where: { redeemedAt: { gte: todayStart } } }),
    prisma.voucherRedemption.count({ where: { redeemedAt: { gte: monthStart } } }),
    prisma.voucherRedemption.groupBy({
      by: ["redeemedAt"],
      _count: { _all: true },
      _sum: { amount: true },
      where: { redeemedAt: { gte: daysAgo30 } },
    }),
  ]);

  const byStatusMap = Object.fromEntries(byStatus.map((s) => [s.status, { count: s._count._all, value: Number(s._sum.value ?? 0) }]));
  const redeemed = byStatusMap["REDEEMED"];
  const byDay = new Map<string, { count: number; value: number }>();
  for (const d of daily) {
    const key = d.redeemedAt.toISOString().slice(0, 10);
    byDay.set(key, {
      count: (byDay.get(key)?.count ?? 0) + d._count._all,
      value: (byDay.get(key)?.value ?? 0) + Number(d._sum.amount ?? 0),
    });
  }

  return {
    total: { count: byStatusMap["UNUSED"]?.count ?? 0 + Object.values(byStatusMap).reduce((a, b) => a + b.count, 0), value: Number(valueAgg._sum.value ?? 0) },
    unused: byStatusMap["UNUSED"]?.count ?? 0,
    redeemed: redeemed?.count ?? 0,
    redeemedValue: redeemed?.value ?? 0,
    expired: byStatusMap["EXPIRED"]?.count ?? 0,
    cancelled: byStatusMap["CANCELLED"]?.count ?? 0,
    suspended: byStatusMap["SUSPENDED"]?.count ?? 0,
    todayRedemptions: today,
    monthRedemptions: month,
    last30Days: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, count: v.count, value: v.value })),
  };
}

/** Batch list with per-batch status counts. */
export async function listVoucherBatches(limit = 50) {
  const batches = await prisma.voucherBatch.findMany({
    include: { _count: { select: { vouchers: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const counts = await prisma.voucher.groupBy({
    by: ["batchId", "status"],
    where: { batchId: { in: batches.map((b) => b.id) } },
    _count: { _all: true },
  });
  const byBatch = new Map<string, Record<string, number>>();
  for (const c of counts) {
    const key = c.batchId ?? "";
    const m = byBatch.get(key) ?? {};
    m[c.status] = c._count._all;
    byBatch.set(key, m);
  }
  return batches.map((b) => ({
    id: b.id,
    name: b.name,
    currency: b.currency,
    value: Number(b.value),
    quantity: b._count.vouchers,
    createdAt: b.createdAt,
    createdBy: b.createdBy,
    statuses: byBatch.get(b.id) ?? {},
  }));
}
