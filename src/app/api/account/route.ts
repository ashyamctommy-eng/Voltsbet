import { NextRequest } from "next/server";
import { handle, ok, requireUser, verifyCsrf, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { isUserActionAllowed, userBlockReason } from "@/lib/statuses";
import { currencyMap, convert, formatMoney } from "@/lib/currency";
import { toCents } from "@/lib/wallet";
import { npCreatePayment, npPayCurrency } from "@/lib/providers/nowpayments";
import { palplusStkPush } from "@/lib/providers/palplus";
import { mpesaStkPush, normalizeMpesaPhone, publicBaseUrl } from "@/lib/providers/mpesa";
import { z } from "zod";

// ── GET profile ────────────────────────────────────────────────
export const GET = handle(async () => {
  const user = await requireUser();
  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  const blocked = await userBlockReason(user.status, "bet");
  const settings = await getSettings();
  const [recentDeposits, displayCur] = await Promise.all([
    prisma.deposit.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    user.displayCurrencyCode ?? Promise.resolve(user.currencyCode),
  ]);

  const walletCur = wallet?.currencyCode ?? user.currencyCode;
  const balance = wallet ? await convert(Number(wallet.balance), walletCur, displayCur) : 0;

  // Voucher deposit history (method=VOUCHER redemptions, newest first).
  const recentVoucherDeposits = await prisma.voucherRedemption.findMany({
    where: { userId: user.id },
    orderBy: { redeemedAt: "desc" },
    take: 5,
  });
  const voucherTxnRefs = new Map(
    (
      await prisma.transaction.findMany({
        where: { id: { in: recentVoucherDeposits.map((r) => r.transactionId).filter(Boolean) as string[] } },
        select: { id: true, reference: true },
      })
    ).map((t) => [t.id, t.reference]),
  );

  return ok({
    user: {
      id: user.id,
      role: user.role,
      referralCode: user.referralCode,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      phone: user.phone,
      country: user.country,
      languageCode: user.languageCode,
      currencyCode: user.currencyCode,
      displayCurrencyCode: displayCur,
      status: user.status,
      verified: user.verified,
      createdAt: user.createdAt,
    },
    wallet: wallet
      ? {
          balance: Number(wallet.balance),
          bonusBalance: Number(wallet.bonusBalance),
          currencyCode: wallet.currencyCode,
          balanceLabel: await formatMoney(balance, displayCur),
          displayCurrencyCode: displayCur,
        }
      : null,
    limits: {
      minStake: settings.minStake,
      maxStake: settings.maxStake,
      maxPayout: settings.maxPayout,
      depositMin: settings.cryptoMinDeposit,
      depositMax: settings.cryptoMaxDeposit,
      cryptoCurrencies: settings.cryptoCurrencies,
      cryptoRates: settings.cryptoRates,
      // KES per 1 unit of each active currency — lets the client compute
      // crypto estimates for non-KES wallets (mirrors cryptoAmountFor()).
      currencyRates: Object.fromEntries(
        Object.entries(await currencyMap()).map(([code, c]) => [code, c.rate])
      ),
      depositMethods: [
        "CRYPTO",
        ...(settings.mpesaEnabled ? ["MPESA" as const] : []),
        ...(settings.paymentsVoucherEnabled ? ["VOUCHER" as const] : []),
      ],
      withdrawalMethods: [
        "CRYPTO",
        ...(settings.mpesaWithdrawalsEnabled ? ["MPESA" as const] : []),
      ],
    },
    recentDeposits: recentDeposits.map((d) => ({
      id: d.id,
      amount: Number(d.amount),
      currencyCode: d.currencyCode,
      status: d.status,
      cryptoCurrency: d.cryptoCurrency,
      createdAt: d.createdAt,
    })),
    recentVoucherDeposits: recentVoucherDeposits.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      currencyCode: r.currency,
      redeemedAt: r.redeemedAt,
      reference: r.transactionId ? voucherTxnRefs.get(r.transactionId) ?? null : null,
    })),
    bettingLocked: !!blocked,
    bettingLockReason: blocked,
  });
});

// ── PATCH profile settings (display currency / language) ───────
const patchSchema = z.object({
  displayCurrency: z.string().optional(),
  language: z.string().optional(),
});

export const PATCH = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const user = await requireUser();
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");

  const data: { displayCurrencyCode?: string; languageCode?: string } = {};
  if (parsed.data.displayCurrency) {
    const map = await currencyMap();
    if (!map[parsed.data.displayCurrency]) {
      throw new ApiError(400, "Unknown currency.", "BAD_CURRENCY");
    }
    // Display-only: wallet value stays in currencyCode (spec §23)
    data.displayCurrencyCode = parsed.data.displayCurrency;
  }
  if (parsed.data.language) {
    const lang = await prisma.language.findUnique({ where: { code: parsed.data.language } });
    if (!lang?.active) throw new ApiError(400, "Unknown language.", "BAD_LANGUAGE");
    data.languageCode = parsed.data.language;
  }

  await prisma.user.update({ where: { id: user.id }, data });
  return ok({ message: "Settings updated" });
});

// ── POST deposit request (CRYPTO | MPESA) ─────────────────────
const depositSchema = z.object({
  amount: z.number().positive("Enter a deposit amount"),
  method: z.enum(["CRYPTO", "MPESA"]).optional().default("CRYPTO"),
  cryptoCurrency: z.string().optional().default(""),
  phone: z.string().optional().default(""),
});

export const POST = handle(async (req: NextRequest) => {
  await verifyCsrf(req);
  const user = await requireUser();

  if (!(await isUserActionAllowed(user.status, "deposit"))) {
    const reason = await userBlockReason(user.status, "deposit");
    throw new ApiError(403, reason ?? "Deposits are currently disabled for your account.", "DEPOSIT_LOCKED");
  }

  const body = await req.json().catch(() => null);
  const parsed = depositSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, "VALIDATION");
  const { amount, method, cryptoCurrency, phone } = parsed.data;

  const settings = await getSettings();
  if (amount < settings.cryptoMinDeposit) {
    throw new ApiError(400, `Minimum deposit is ${settings.cryptoMinDeposit}.`, "MIN_DEPOSIT");
  }
  if (amount > settings.cryptoMaxDeposit) {
    throw new ApiError(400, `Maximum deposit is ${settings.cryptoMaxDeposit}.`, "MAX_DEPOSIT");
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  if (!wallet) throw new ApiError(500, "Wallet not found.", "NO_WALLET");

  // ── M-Pesa deposit (STK Push) ────────────────────────────────
  if (method === "MPESA") {
    if (!settings.mpesaEnabled) throw new ApiError(503, "M-Pesa deposits are not enabled yet.", "MPESA_DISABLED");

    // M-Pesa charges in KES only. Non-KES wallets are charged the converted
    // KES amount via STK but CREDITED in their own currency (deposit.amount
    // stays wallet-currency; the KES charge is kept in metadata for
    // reconciliation). Refuse when no conversion rate is available — never
    // guess.
    let kesAmount = amount;
    if (wallet.currencyCode !== "KES") {
      const map = await currencyMap();
      if (!map[wallet.currencyCode] || !map["KES"]) {
        throw new ApiError(400, "Currency conversion is unavailable for M-Pesa deposits right now.", "RATE_UNAVAILABLE");
      }
      kesAmount = toCents(await convert(amount, wallet.currencyCode, "KES"));
    }
    // Safaricom STK transaction cap — reject before the push, not after.
    if (kesAmount > 150_000) {
      throw new ApiError(
        400,
        "M-Pesa deposits are limited to KSh 150,000 per transaction — deposit a smaller amount.",
        "MPESA_LIMIT"
      );
    }

    const usePalplus = Boolean(settings.palplusApiKey);
    const deposit = await prisma.deposit.create({
      data: {
        userId: user.id,
        provider: usePalplus ? "PALPLUS" : "MPESA",
        method: "MPESA",
        amount: amount.toFixed(2),
        currencyCode: wallet.currencyCode,
        status: "AWAITING_PAYMENT",
        metadata: JSON.stringify({
          transactionId: "",
          phone: normalizeMpesaPhone(phone),
          ...(wallet.currencyCode !== "KES" ? { kesAmount, walletAmount: amount } : {}),
        }),
      },
    });

    try {
      const base = publicBaseUrl(settings);
      const push = usePalplus
        ? await palplusStkPush({
            amount: kesAmount,
            phone,
            accountReference: `VB-${user.id.slice(-6)}`,
            callbackUrl: `${base}/api/webhooks/palplus`,
          })
        : await mpesaStkPush({
            amount: kesAmount,
            phone,
            accountReference: `VB-${user.id.slice(-6)}`,
            callbackUrl: `${base}/api/webhooks/mpesa/stk?secret=${settings.mpesaCallbackSecret}`,
          });
      const checkoutRequestId =
        "transactionId" in push
          ? push.transactionId
          : "checkoutRequestId" in push
            ? push.checkoutRequestId
            : push.CheckoutRequestID;
      const providerCheckoutId =
        "providerCheckoutId" in push ? push.providerCheckoutId : ("CheckoutRequestID" in push ? push.CheckoutRequestID : null);
      const providerRequestId =
        "providerRequestId" in push ? push.providerRequestId : ("MerchantRequestID" in push ? push.MerchantRequestID : null);
      await prisma.deposit.update({
        where: { id: deposit.id },
        data: {
          metadata: JSON.stringify({
            transactionId: checkoutRequestId,
            ...(providerCheckoutId ? { providerCheckoutId } : {}),
            ...(providerRequestId ? { providerRequestId } : {}),
            phone: normalizeMpesaPhone(phone),
            provider: usePalplus ? "PALPLUS" : "MPESA",
            ...(wallet.currencyCode !== "KES" ? { kesAmount, walletAmount: amount } : {}),
          }),
        },
      });
      return ok({
        deposit: {
          id: deposit.id,
          amount,
          method: "MPESA",
          checkoutRequestId,
          status: "AWAITING_PAYMENT",
          note: "Check your phone and enter your M-Pesa PIN to complete the payment.",
        },
      });
    } catch (e) {
      await prisma.deposit.update({ where: { id: deposit.id }, data: { status: "FAILED" } });
      throw e;
    }
  }

  // ── Crypto deposit ───────────────────────────────────────────
  if (!settings.cryptoCurrencies.includes(cryptoCurrency)) {
    throw new ApiError(400, `Deposits in ${cryptoCurrency} are not supported.`, "BAD_CRYPTO");
  }

  // Real provider configured (NOWPayments)? Get a real payment address.
  if (settings.cryptoProvider === "NOWPAYMENTS" && settings.cryptoApiKey) {
    // Resolve the network-qualified pay_currency (e.g. USDT → usdttrc20).
    // USDT/BNB have no bare code on NOWPayments — pinning the network here is
    // what makes the deposit deterministic instead of provider-chosen.
    const { code: payCurrency, network: networkToken } = npPayCurrency(
      cryptoCurrency,
      settings.cryptoNetworks?.[cryptoCurrency]
    );
    // Create the deposit row FIRST and use its id as the provider order_id.
    // NOWPayments dedupes on order_id — before, order_id was user.id, so a
    // user's second deposit collided with the first and the webhook could
    // never credit it (the deposit hung in AWAITING_PAYMENT forever).
    const deposit = await prisma.deposit.create({
      data: {
        userId: user.id,
        provider: "NOWPAYMENTS",
        method: "CRYPTO",
        amount: amount.toFixed(2),
        currencyCode: wallet.currencyCode,
        status: "AWAITING_PAYMENT",
        cryptoCurrency,
        network: networkToken,
        metadata: JSON.stringify({}),
      },
    });

    try {
      const base = publicBaseUrl(settings);
      const ipn = `${base}/api/webhooks/crypto/nowpayments`;
      const np = await npCreatePayment({
        priceAmount: amount,
        priceCurrency: wallet.currencyCode,
        payCurrency,
        orderId: deposit.id,
        ipnCallbackUrl: ipn,
      });
      await prisma.deposit.update({
        where: { id: deposit.id },
        data: {
          paymentAddress: np.pay_address,
          expiresAt: np.expires_at ? new Date(np.expires_at) : null,
          metadata: JSON.stringify({ providerRef: String(np.payment_id), payAmount: np.pay_amount, payCurrency: np.pay_currency }),
        },
      });
      return ok({
        deposit: {
          id: deposit.id,
          amount,
          cryptoCurrency,
          network: networkToken,
          paymentAddress: np.pay_address,
          payAmount: np.pay_amount,
          payCurrency: np.pay_currency,
          expiresAt: np.expires_at ?? null,
          status: deposit.status,
        },
      });
    } catch (e) {
      await prisma.deposit.update({ where: { id: deposit.id }, data: { status: "FAILED" } }).catch(() => {});
      throw e;
    }
  }

  // Demo mode: generate a mock payment address (dev only).
  const mockAddress = `vb${(cryptoCurrency === "BTC" ? "bc1q" : "0x")}${Math.random().toString(16).slice(2, 12)}${user.id.slice(-6)}`;
  const expiresAt = new Date(Date.now() + settings.cryptoExpirationMinutes * 60_000);
  const { network: demoNetwork } = npPayCurrency(cryptoCurrency, settings.cryptoNetworks?.[cryptoCurrency]);

  const deposit = await prisma.deposit.create({
    data: {
      userId: user.id,
      provider: settings.cryptoProvider || "DEMO",
      method: "CRYPTO",
      amount: amount.toFixed(2),
      currencyCode: wallet.currencyCode,
      status: "AWAITING_PAYMENT",
      cryptoCurrency,
      network: demoNetwork,
      paymentAddress: mockAddress,
      expiresAt,
      metadata: JSON.stringify({ demoMode: true }),
    },
  });

  return ok({
    deposit: {
      id: deposit.id,
      amount,
      cryptoCurrency,
      network: demoNetwork,
      paymentAddress: mockAddress,
      expiresAt,
      status: deposit.status,
      demoMode: true,
      note: "Demo mode: use the demo webhook to simulate payment confirmation.",
    },
  });
});
