import { prisma } from "./prisma";

export type SiteSettings = {
  siteName: string;
  tagline: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  // Platform-wide default operating currency (ISO code, e.g. KES) — the
  // frontend formats all display money through this (Admin → Default Currency)
  currencyDefault: string;
  /** When true, EVERY visitor sees the platform default currency — IP
   *  auto-detect and per-user display preferences are ignored. */
  forceDefaultCurrency: boolean;
  minStake: number;
  maxStake: number;
  maxPayout: number;
  whatsapp: string;
  whatsappMessage: string;
  whatsappEnabled: boolean;
  whatsappPosition: string;
  telegram: string;
  telegramText: string;
  telegramEnabled: boolean;
  telegramPosition: string;
  // Telegram bot (OTP delivery + account linking)
  telegramBotToken: string;
  telegramBotUsername: string; // without @ — used to build t.me deep links
  telegramWebhookSecret: string; // validates X-Telegram-Bot-Api-Secret-Token
  telegramOtpEnabled: boolean; // require Telegram OTP at login for linked accounts
  supportEmail: string;
  supportPhone: string; // displayed in the support modal (Call Us)
  cryptoProvider: string;
  paymentsVoucherEnabled: boolean; // allow Voucher deposits (redeemable codes)
  cryptoApiKey: string;
  cryptoIpnSecret: string;
  cryptoPayoutApiKey: string;
  cryptoMinDeposit: number;
  cryptoMaxDeposit: number;
  cryptoConfirmations: number;
  cryptoExpirationMinutes: number;
  cryptoCurrencies: string[];
  cryptoRates: Record<string, number>; // KES per 1 coin, for deposit estimates
  mpesaEnabled: boolean;
  mpesaWithdrawalsEnabled: boolean; // offer M-Pesa as a WITHDRAWAL method (env ENABLE_MPESA_WITHDRAWALS wins)
  mpesaEnv: string; // sandbox | production
  mpesaConsumerKey: string;
  mpesaConsumerSecret: string;
  mpesaPasskey: string;
  mpesaShortcode: string; // Paybill number
  mpesaInitiatorName: string;
  mpesaSecurityCredential: string; // encrypted B2C initiator password (see scripts/)
  mpesaCallbackSecret: string; // random string protecting webhook URLs (legacy Daraja)
  // M-Pesa via Palplus gateway (replaces Daraja for new installs)
  palplusApiKey: string;
  palplusMerchantId: string;
  palplusWebhookSecret: string; // validates Palplus callback signatures
  palplusEnv: string; // sandbox | production
  appUrl: string; // public base URL for callback URLs
  heroTitle: string;
  heroSubtitle: string;
  // Odds & risk
  oddsMarginPercent: number; // overround added on top of feed odds (e.g. 6 = 6%)
  maxLiabilityPerMarket: number; // max exposure (potential payout) per market
  // Cash-out
  cashoutEnabled: boolean; // allow players to cash out open bets early
  cashoutMarginPercent: number; // book margin applied to the cash-out quote (e.g. 5 = 5%)
  // Games display
  hideSeededGames: boolean; // show only synced (source=API) games in public lists; auto-on after first successful sync
  liveRefreshSeconds: number; // /live auto-refresh + live-score poll interval (1 Odds API scores request per window per active league)
  // Referrals
  referralEnabled: boolean;
  referralBonusPercent: number; // % of referee's first deposit credited to referrer
  referralBonusCap: number; // max bonus per referee
  referralMinDeposit: number; // referee deposit must be >= this to trigger
  // Responsible gambling — per-user daily velocity caps (rolling 24h)
  dailyStakeLimit: number; // max total STAKED per user per 24h (0 = unlimited)
  dailyLossLimit: number; // max net LOSS per user per 24h (0 = unlimited)
  // Automation
  settlementDelayMinutes: number; // settle finished games only after this many minutes
  cronSecret: string; // bearer token for /api/cron/* endpoints
};

const DEFAULTS: SiteSettings = {
  siteName: "VoltBet",
  tagline: "Live the rush",
  primaryColor: "#00e676",
  secondaryColor: "#0b1220",
  accentColor: "#7c3aed",
  currencyDefault: "KES",
  forceDefaultCurrency: false,
  minStake: 50,
  maxStake: 100000,
  maxPayout: 2000000,
  whatsapp: "",
  whatsappMessage: "Hello! I need help.",
  whatsappEnabled: false,
  whatsappPosition: "bottom-right",
  telegram: "",
  telegramText: "Join Our Telegram Group",
  telegramEnabled: false,
  telegramPosition: "bottom-left",
  telegramBotToken: "",
  telegramBotUsername: "",
  telegramWebhookSecret: "",
  telegramOtpEnabled: false,
  supportEmail: "",
  supportPhone: "0704 526 454",
  paymentsVoucherEnabled: true,
  cryptoProvider: "",
  cryptoApiKey: "",
  cryptoIpnSecret: "",
  cryptoPayoutApiKey: "",
  cryptoMinDeposit: 500,
  cryptoMaxDeposit: 500000,
  cryptoConfirmations: 1,
  cryptoExpirationMinutes: 30,
  cryptoCurrencies: ["BTC", "ETH", "USDT", "USDC"],
  cryptoRates: { BTC: 8500000, ETH: 430000, USDT: 129, USDC: 129 },
  mpesaEnabled: false,
  mpesaWithdrawalsEnabled: false,
  mpesaEnv: "sandbox",
  mpesaConsumerKey: "",
  mpesaConsumerSecret: "",
  mpesaPasskey: "",
  mpesaShortcode: "",
  mpesaInitiatorName: "",
  mpesaSecurityCredential: "",
  mpesaCallbackSecret: "",
  palplusApiKey: "",
  palplusMerchantId: "",
  palplusWebhookSecret: "",
  palplusEnv: "sandbox",
  appUrl: "",
  heroTitle: "Bet on the games you love",
  heroSubtitle: "Fast odds, instant crypto deposits, live betting.",
  oddsMarginPercent: 6,
  maxLiabilityPerMarket: 500000,
  cashoutEnabled: true,
  cashoutMarginPercent: 5,
  hideSeededGames: false,
  liveRefreshSeconds: 60,
  referralEnabled: true,
  referralBonusPercent: 10,
  referralBonusCap: 500,
  referralMinDeposit: 0,
  dailyStakeLimit: 0,
  dailyLossLimit: 0,
  settlementDelayMinutes: 10,
  cronSecret: "",
};

let cache: SiteSettings | null = null;

async function rawSettings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function getSettings(): Promise<SiteSettings> {
  if (cache) return cache;
  const raw = await rawSettings();
  const s: SiteSettings = { ...DEFAULTS };
  s.siteName = raw["site.name"] ?? s.siteName;
  s.tagline = raw["site.tagline"] ?? s.tagline;
  s.currencyDefault = raw["currency.default"] ?? s.currencyDefault;
  s.forceDefaultCurrency = raw["currency.forceDefault"] === "true";
  s.primaryColor = raw["branding.primaryColor"] ?? s.primaryColor;
  s.secondaryColor = raw["branding.secondaryColor"] ?? s.secondaryColor;
  s.accentColor = raw["branding.accentColor"] ?? s.accentColor;
  s.minStake = Number(raw["betting.minStake"] ?? s.minStake);
  s.maxStake = Number(raw["betting.maxStake"] ?? s.maxStake);
  s.maxPayout = Number(raw["betting.maxPayout"] ?? s.maxPayout);
  s.whatsapp = raw["support.whatsapp"] ?? s.whatsapp;
  s.whatsappMessage = raw["support.whatsappMessage"] ?? s.whatsappMessage;
  s.whatsappEnabled = raw["support.whatsappEnabled"] === "true";
  s.whatsappPosition = raw["support.whatsappPosition"] ?? s.whatsappPosition;
  s.telegram = raw["support.telegram"] ?? s.telegram;
  s.telegramText = raw["support.telegramText"] ?? s.telegramText;
  s.telegramEnabled = raw["support.telegramEnabled"] === "true";
  s.telegramPosition = raw["support.telegramPosition"] ?? s.telegramPosition;
  s.telegramBotToken = raw["telegram.botToken"] ?? s.telegramBotToken;
  s.telegramBotUsername = (raw["telegram.botUsername"] ?? s.telegramBotUsername).replace(/^@/, "");
  s.telegramWebhookSecret = raw["telegram.webhookSecret"] ?? s.telegramWebhookSecret;
  s.telegramOtpEnabled = raw["telegram.otpEnabled"] === "true";
  s.supportEmail = raw["support.email"] ?? s.supportEmail;
  s.supportPhone = raw["support.phone"] ?? s.supportPhone;
  s.paymentsVoucherEnabled = (raw["payments.voucherEnabled"] ?? String(DEFAULTS.paymentsVoucherEnabled)) === "true";
  s.cryptoProvider = raw["crypto.provider"] ?? s.cryptoProvider;
  s.cryptoApiKey = raw["crypto.apiKey"] ?? s.cryptoApiKey;
  s.cryptoIpnSecret = raw["crypto.ipnSecret"] ?? s.cryptoIpnSecret;
  s.cryptoPayoutApiKey = raw["crypto.payoutApiKey"] ?? s.cryptoPayoutApiKey;
  s.cryptoMinDeposit = Number(raw["crypto.minDeposit"] ?? s.cryptoMinDeposit);
  s.cryptoMaxDeposit = Number(raw["crypto.maxDeposit"] ?? s.cryptoMaxDeposit);
  s.cryptoConfirmations = Number(raw["crypto.confirmations"] ?? s.cryptoConfirmations);
  s.cryptoExpirationMinutes = Number(raw["crypto.expirationMinutes"] ?? s.cryptoExpirationMinutes);
  try { s.cryptoCurrencies = JSON.parse(raw["crypto.currencies"] ?? "[]"); } catch {}
  if (!s.cryptoCurrencies.length) s.cryptoCurrencies = DEFAULTS.cryptoCurrencies;
  try { s.cryptoRates = JSON.parse(raw["crypto.rates"] ?? "{}"); } catch {}
  if (!Object.keys(s.cryptoRates).length) s.cryptoRates = DEFAULTS.cryptoRates;
  // ENABLE_MPESA_PAYMENTS env wins when set (true|false) — the hard kill
  // switch for the whole M-Pesa rail (deposit + withdrawal tabs hide).
  s.mpesaEnabled =
    process.env.ENABLE_MPESA_PAYMENTS !== undefined
      ? process.env.ENABLE_MPESA_PAYMENTS === "true"
      : raw["mpesa.enabled"] === "true";
  s.mpesaWithdrawalsEnabled =
    process.env.ENABLE_MPESA_WITHDRAWALS !== undefined
      ? process.env.ENABLE_MPESA_WITHDRAWALS === "true" // env wins when set
      : raw["payments.mpesaWithdrawalsEnabled"] !== undefined
        ? raw["payments.mpesaWithdrawalsEnabled"] === "true"
        : s.mpesaEnabled; // backwards-compatible default: withdrawals followed deposits
  s.mpesaEnv = raw["mpesa.env"] ?? s.mpesaEnv;
  s.mpesaConsumerKey = raw["mpesa.consumerKey"] ?? s.mpesaConsumerKey;
  s.mpesaConsumerSecret = raw["mpesa.consumerSecret"] ?? s.mpesaConsumerSecret;
  s.mpesaPasskey = raw["mpesa.passkey"] ?? s.mpesaPasskey;
  s.mpesaShortcode = raw["mpesa.shortcode"] ?? s.mpesaShortcode;
  s.mpesaInitiatorName = raw["mpesa.initiatorName"] ?? s.mpesaInitiatorName;
  s.mpesaSecurityCredential = raw["mpesa.securityCredential"] ?? s.mpesaSecurityCredential;
  s.mpesaCallbackSecret = raw["mpesa.callbackSecret"] ?? s.mpesaCallbackSecret;
  s.palplusApiKey = raw["palplus.apiKey"] ?? s.palplusApiKey;
  s.palplusMerchantId = raw["palplus.merchantId"] ?? s.palplusMerchantId;
  s.palplusWebhookSecret = raw["palplus.webhookSecret"] ?? s.palplusWebhookSecret;
  s.palplusEnv = raw["palplus.env"] ?? s.palplusEnv;
  s.appUrl = raw["app.url"] ?? s.appUrl;
  s.heroTitle = raw["home.heroTitle"] ?? s.heroTitle;
  s.heroSubtitle = raw["home.heroSubtitle"] ?? s.heroSubtitle;
  s.oddsMarginPercent = Number(raw["odds.marginPercent"] ?? s.oddsMarginPercent);
  s.maxLiabilityPerMarket = Number(raw["betting.maxLiabilityPerMarket"] ?? s.maxLiabilityPerMarket);
  s.cashoutEnabled = (raw["betting.cashoutEnabled"] ?? String(DEFAULTS.cashoutEnabled)) === "true";
  s.cashoutMarginPercent = Number(raw["betting.cashoutMarginPercent"] ?? s.cashoutMarginPercent);
  s.hideSeededGames =
    process.env.SHOW_SEEDED_GAMES !== undefined
      ? process.env.SHOW_SEEDED_GAMES !== "true" // env wins: "false" = hide seeds
      : raw["games.hideSeeded"] === "true";
  s.liveRefreshSeconds = Number(raw["live.refreshSeconds"] ?? s.liveRefreshSeconds) || s.liveRefreshSeconds;
  s.referralEnabled = (raw["referral.enabled"] ?? String(DEFAULTS.referralEnabled)) === "true";
  s.referralBonusPercent = Number(raw["referral.bonusPercent"] ?? s.referralBonusPercent);
  s.referralBonusCap = Number(raw["referral.bonusCap"] ?? s.referralBonusCap);
  s.referralMinDeposit = Number(raw["referral.minDeposit"] ?? s.referralMinDeposit);
  s.dailyStakeLimit = Number(raw["betting.dailyStakeLimit"] ?? s.dailyStakeLimit);
  s.dailyLossLimit = Number(raw["betting.dailyLossLimit"] ?? s.dailyLossLimit);
  s.settlementDelayMinutes = Number(raw["settlement.delayMinutes"] ?? s.settlementDelayMinutes);
  s.cronSecret = raw["cron.secret"] ?? s.cronSecret;
  cache = s;
  return s;
}

export async function setSetting(key: string, value: string) {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  cache = null;
}

export async function invalidateSettingsCache() {
  cache = null;
}
