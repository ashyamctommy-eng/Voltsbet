import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, ApiError } from "@/lib/api";
import { hashPassword, createSession } from "@/lib/auth";
import { generateReferralCode } from "@/lib/referral";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { rateLimit } from "@/lib/rate-limit";
import { toCents } from "@/lib/wallet";
import { requireRecaptcha } from "@/lib/recaptcha";

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
  gRecaptchaToken: z.string().optional().default(""),
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

  // Bot protection: verify the reCAPTCHA token BEFORE any credential or
  // uniqueness work (no-op when RECAPTCHA_SECRET_KEY is unset).
  await requireRecaptcha(d.gRecaptchaToken);

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

  // Wallet base currencies are STRICTLY USD | KES — the account currency is
  // assigned at registration and never involves FX (no other codes minted).
  const walletCurrency = d.currency === "USD" || d.currency === "KES" ? d.currency : "KES";
  const language = await prisma.language.findUnique({ where: { code: d.language } });
  const langCode = language?.active ? d.language : "en";
  const settings = await getSettings();
  const signupBonusAmount = settings.signupBonusEnabled ? settings.signupBonusAmount : 0;

  const user = await prisma.$transaction(async (tx) => {
    // Registration bonus: credited to the BONUS pool at signup when enabled.
    // It is locked — not stakeable/withdrawable — until the user's first
    // successful deposit flips hasDeposited (see lib/deposits + lib/vouchers).
    const signupBonus = toCents(signupBonusAmount > 0 ? signupBonusAmount : 0);
    const created = await tx.user.create({
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
        wallet: {
          create: {
            balance: "0",
            bonusBalance: signupBonus > 0 ? signupBonus.toFixed(2) : "0",
            currencyCode: walletCurrency,
          },
        },
      },
    });
    if (signupBonus > 0) {
      await tx.transaction.create({
        data: {
          userId: created.id,
          type: "BONUS",
          method: "SIGNUP",
          amount: signupBonus.toFixed(2),
          currencyCode: walletCurrency,
          prevBalance: "0",
          newBalance: signupBonus.toFixed(2),
          reason: "Registration bonus (bonus balance)",
        },
      });
    }
    return created;
  });

  const bonusCredited = signupBonusAmount > 0;

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
      message: bonusCredited
        ? `Your welcome bonus of ${toCents(signupBonusAmount)} ${walletCurrency} has been added to your bonus balance. Make your first deposit to unlock it for betting.`
        : "Thanks for joining UNIBET360. Deposit and start betting — fast odds, live betting, instant crypto deposits.",
    },
  });

  return ok({ user: { id: user.id, username: user.username, email: user.email } });
});

