import { NextRequest } from "next/server";
import { handle, ok, auditLog, ApiError, sharedAdminGuard } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { generateReferralCode } from "@/lib/referral";
import { z } from "zod";

/** Roles an admin may create from the panel — SUPER_ADMIN is excluded so this
 *  endpoint can't be used for privilege escalation. */
const CREATABLE_ROLES = [
  "CUSTOMER",
  "SPORTS_MANAGER",
  "FINANCE_MANAGER",
  "SUPPORT_MANAGER",
  "CONTENT_MANAGER",
] as const;

const createSchema = z.object({
  fullName: z.string().min(2).max(80),
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers and underscore only"),
  email: z.string().email(),
  phone: z.string().regex(/^\+?[0-9]{9,15}$/, "Enter a valid phone number"),
  password: z.string().min(8).regex(/[a-zA-Z]/).regex(/[0-9]/),
  role: z.enum(CREATABLE_ROLES).default("CUSTOMER"),
  status: z.enum(["ACTIVE", "PENDING_VERIFICATION", "SUSPENDED"]).default("ACTIVE"),
  currencyCode: z.string().min(3).max(5).default("KES"),
  initialBalance: z.number().min(0).max(10_000_000).default(0),
});

export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "users");
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const status = req.nextUrl.searchParams.get("status") ?? "";
  const users = await prisma.user.findMany({
    where: {
      role: "CUSTOMER",
      ...(q ? { OR: [{ username: { contains: q } }, { email: { contains: q } }, { fullName: { contains: q } }] } : {}),
      ...(status ? { status } : {}),
    },
    include: { wallet: true, _count: { select: { bets: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return ok({
    users: users.map((u) => ({
      id: u.id, fullName: u.fullName, username: u.username, email: u.email, phone: u.phone,
      status: u.status, verified: u.verified, currencyCode: u.currencyCode,
      balance: u.wallet ? Number(u.wallet.balance) : 0,
      betCount: u._count.bets, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
    })),
  });
});

/** POST — create a REAL user (not demo/seed): identity + hashed password +
 *  wallet + referral share code. Admin-created users are verified + active by
 *  default so they can bet/withdraw immediately. */
export const POST = handle(async (req: NextRequest) => {
  const admin = await sharedAdminGuard(req, "users");
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");
  const d = parsed.data;

  // Admin/staff accounts may ONLY be created by a SUPER_ADMIN — a FINANCE or
  // SUPPORT manager must not be able to mint new privileged logins.
  if (d.role !== "CUSTOMER" && admin.role !== "SUPER_ADMIN") {
    throw new ApiError(403, "Only a Super Admin can create admin accounts.", "FORBIDDEN");
  }

  const email = d.email.toLowerCase().trim();
  const username = d.username.trim().toLowerCase();

  const [uEmail, uName, uPhone] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.user.findUnique({ where: { username } }),
    prisma.user.findUnique({ where: { phone: d.phone } }),
  ]);
  if (uEmail) throw new ApiError(409, "An account with this email already exists.", "EMAIL_TAKEN");
  if (uName) throw new ApiError(409, "This username is already taken.", "USERNAME_TAKEN");
  if (uPhone) throw new ApiError(409, "This phone number is already registered.", "PHONE_TAKEN");

  const currency = await prisma.currency.findUnique({ where: { code: d.currencyCode } });
  const walletCurrency = currency?.active ? d.currencyCode : "KES";

  const user = await prisma.user.create({
    data: {
      fullName: d.fullName.trim(),
      username,
      email,
      phone: d.phone,
      passwordHash: await hashPassword(d.password),
      role: d.role,
      status: d.status,
      verified: true, // admin-added users skip manual verification
      currencyCode: walletCurrency,
      referralCode: generateReferralCode(),
      wallet: { create: { balance: d.initialBalance.toFixed(2), currencyCode: walletCurrency } },
    },
    select: { id: true, fullName: true, username: true, email: true, phone: true, role: true, status: true },
  });

  await auditLog({ admin, action: "CREATE", entity: "USER", entityId: user.id, newValue: { ...user, initialBalance: d.initialBalance } });
  return ok({ user });
});

export const PATCH = handle(async () => {
  // Route conflict guard — PATCH goes to /api/admin/users/[id]
  throw new ApiError(404, "Not found.", "NOT_FOUND");
});
