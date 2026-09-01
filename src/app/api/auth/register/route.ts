import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, ApiError } from "@/lib/api";
import { hashPassword, createSession } from "@/lib/auth";
import { generateReferralCode } from "@/lib/referral";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  fullName: z.string().min(2, "Enter your full name").max(80),
  username: z.string().min(3, "Username must be at least 3 characters").max(20).regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers and underscore only"),
  email: z.string().email("Enter a valid email"),
  phone: z.string().regex(/^\+?[0-9]{9,15}$/, "Enter a valid phone number"),
  password: z.string().min(8, "Password must be at least 8 characters").regex(/[a-zA-Z]/, "Must contain a letter").regex(/[0-9]/, "Must contain a number"),
  confirmPassword: z.string(),
  country: z.string().optional().default(""),
  language: z.string().optional().default("en"),
  currency: z.string().optional().default("KES"),
  referralCode: z.string().optional().default(""),
  terms: z.boolean().refine((v) => v, "You must accept the terms and conditions"),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export const POST = handle(async (req: NextRequest) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = rateLimit(`register:${ip}`, 10, 15 * 60_000);
  if (!rl.ok) throw new ApiError(429, "Too many attempts. Try again later.", "RATE_LIMITED");

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");
  }
  const d = parsed.data;

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

  const currency = await prisma.currency.findUnique({ where: { code: d.currency } });
  const walletCurrency = currency?.active ? d.currency : "KES";
  const language = await prisma.language.findUnique({ where: { code: d.language } });
  const langCode = language?.active ? d.language : "en";

  const user = await prisma.user.create({
    data: {
      fullName: d.fullName.trim(),
      username,
      email,
      phone: d.phone,
      passwordHash: await hashPassword(d.password),
      country: d.country,
      languageCode: langCode,
      currencyCode: walletCurrency,
      // own unique share code + the referrer's code they entered (if any)
      referralCode: generateReferralCode(),
      referredByCode: d.referralCode.trim() ? d.referralCode.trim().toUpperCase() : null,
      wallet: { create: { balance: "0", currencyCode: walletCurrency } },
    },
  });

  await createSession(user.id, {
    ip,
    userAgent: req.headers.get("user-agent") ?? undefined,
    remember: false,
  });

  await prisma.notification.create({
    data: {
      userId: user.id,
      type: "GENERAL",
      title: "Welcome to UNIBET360! 🎉",
      message: "Thanks for joining. Claim your 100% welcome bonus today.",
    },
  });

  return ok({ user: { id: user.id, username: user.username, email: user.email } });
});

