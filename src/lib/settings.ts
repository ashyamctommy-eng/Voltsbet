import { prisma } from "./prisma";
import { RECOMMENDED_DETAIL_MARKETS } from "./market-catalog";

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
  /** coin → NOWPayments network token (e.g. USDT → "TRC20"). Empty/absent =
   *  NOWPayments default (bare code). Tokens listed in NP_REQUIRED_NETWORK
   *  (USDT, BNB) have NO bare code on NOWPayments, so they always resolve. */
  cryptoNetworks: Record<string, string>;
  cryptoRates: Record<string, number>; // KES per 1 coin, for deposit estimates
  mpesaEnabled: boolean; // M-Pesa rail on (deposit tab): ENABLE_MPESA_PAYMENTS env wins; else explicit admin toggle; auto-on when a Palplus API key is saved and the toggle was never set
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
  palplusChannelId: string; // optional — only needed when the account has no default channel
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
  // Signup (registration) bonus — credited to the user's bonusBalance at
  // account creation when signupBonusEnabled. The bonus is locked (not
  // stakeable / withdrawable) until the user's first successful deposit.
  signupBonusEnabled: boolean;
  signupBonusAmount: number; // in the wallet currency chosen at registration (USD | KES)
  // Responsible gambling — per-user daily velocity caps (rolling 24h)
  dailyStakeLimit: number; // max total STAKED per user per 24h (0 = unlimited)
  dailyLossLimit: number; // max net LOSS per user per 24h (0 = unlimited)
  /** The Odds API league whitelist (sport keys, in priority order). When
   *  non-empty, sync queries ONLY these leagues (1 request each) — the
   *  remaining catalog is skipped, saving credits on leagues the client
   *  doesn't offer. Empty = legacy behavior: every bettable league in API
   *  catalog order, capped by ODDS_API_FEED_MAX_LEAGUES. */
  oddsSyncLeagues: string[];
  /** Per-event (deep-market) pass — max fixtures per featured league that
   *  get the extended menu (Correct Score, BTTS, HT markets…). 0 disables
   *  the whole pass. Env ODDS_API_EVENT_MARKET_LIMIT overrides. */
  oddsEventMarketLimit: number;
  /** Featured leagues for the per-event pass (Odds API keys). Empty = pass
   *  off. Env ODDS_API_EVENT_MARKET_LEAGUES overrides. */
  oddsEventMarketLeagues: string[];
  /** Open the bet slip automatically when the first pick is added. Off by
   *  default: adding a selection is SILENT (the odds cell highlights and the
   *  floating counter updates) — no sheet/rail is yanked open. Admin →
   *  Website Settings → Betting. Env BETSLIP_AUTO_OPEN overrides. */
  betSlipAutoOpen: boolean;
  /** Settlement stats feed: "off" (default) | "api-football". Env STATS_PROVIDER overrides. */
  statsProvider: string;
  /** API-Football key. Env API_FOOTBALL_KEY overrides (recommended for prod). */
  statsApiKey: string;
  /** Hard daily request ceiling for the stats feed (free tier = 100). Env STATS_DAILY_BUDGET. */
  statsDailyBudget: number;
  /** Allow the stats feed to settle corners/cards markets (flips them auto). */
  statsSettleCorners: boolean;
  /** Allow the stats feed to settle half-time markets via the real HT score. */
  statsSettleHalfTime: boolean;
  /** How long a broadcast banner stays live (hours). 0 = never expires.
   *  Admin → Website Settings → Broadcast. Env BROADCAST_TTL_HOURS overrides. */
  broadcastTtlHours: number;
  /** Site-wide maintenance screen. Admin → Website Settings → Maintenance
   *  (no redeploy needed). Env MAINTENANCE_MODE=1 forces it on — that env path
   *  also covers the DB-down case, since proxy.ts reads it without the DB. */
  maintenanceEnabled: boolean;
  /** Optional custom line shown on the maintenance screen. */
  maintenanceMessage: string;
  /** TIER 2 — deep single-event markets fetched ON DEMAND when a user opens
   *  a match detail page (never in the bulk sweep: quota). Env
   *  SOCCER_DETAIL_MARKETS overrides. */
  soccerDetailMarkets: string[];
  /** TIER 2 cache TTL (seconds) for match-detail odds — a detail page hit
   *  inside this window is served from the DB with zero API cost. Env
   *  SOCCER_DETAIL_CACHE_TTL_SECONDS overrides. */
  soccerDetailCacheTtlSeconds: number;
  /** Bookmaker regions requested per league ("eu" | "us" | "eu,us"). eu
   *  = 3 credits/league (Pinnacle soccer — the default: cheapest and
   *  football-first), eu,us = 6 (adds US books for US sports pricing).
   *  Env ODDS_API_REGIONS overrides. */
  oddsRegions: string;
  /** Min ms between Odds API requests (rate limiting). Env
   *  ODDS_API_RATE_LIMIT_MS overrides. */
  oddsRateLimitMs: number;
  /** Books used for the deep per-event pass ("bovada,pinnacle"). Env
   *  ODDS_API_EVENT_BOOKMAKERS overrides. */
  oddsEventBookmakers: string;
  /** Market keys requested (list pass uses h2h/spreads/totals; the rest are
   *  per-event). Empty = the built-in default menu. Env ODDS_API_MARKETS
   *  overrides. */
  oddsMarkets: string[];
  /** Cap on leagues queried per sync/feed when no whitelist is set. Env
   *  ODDS_API_FEED_MAX_LEAGUES overrides. */
  oddsFeedMaxLeagues: number;
  /** Live scores: min seconds between provider /scores sweeps. Env
   *  LIVE_SCORES_THROTTLE_SECONDS overrides. */
  liveScoresThrottleSeconds: number;
  /** Live: lookback window for candidate games that kicked off (hours).
   *  Env LIVE_SCORES_LOOKBACK_HOURS overrides. */
  liveLookbackHours: number;
  /** Live odds: min seconds between in-play price refreshes. Env
   *  LIVE_ODDS_THROTTLE_SECONDS overrides. */
  liveOddsThrottleSeconds: number;
  /** Live odds: market keys refreshed in-play (default h2h). Env
   *  ODDS_API_LIVE_MARKETS overrides. */
  liveOddsMarkets: string[];
  // Automation
  settlementDelayMinutes: number; // settle finished games only after this many minutes
  cronSecret: string; // bearer token for /api/cron/* endpoints
};

/**
 * The crypto.currencies default shipped before the 11-coin expansion
 * (commit 53324a1). A stored value equal to this is treated as "never
 * customized" and auto-upgraded to DEFAULTS.cryptoCurrencies at read time.
 */
const LEGACY_CRYPTO_CURRENCIES = ["BTC", "ETH", "USDT", "USDC"];

const DEFAULTS: SiteSettings = {
  siteName: "Voltbets",
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
  cryptoCurrencies: ["BTC", "ETH", "USDT", "USDC", "BNB", "TRX", "LTC", "SOL", "XRP", "DOGE", "TON"],
  // USDT & BNB must carry a network suffix — NOWPayments has no bare code for
  // them (verified live 2026-09-02: /v1/currencies lists usdttrc20, bnbbsc…).
  // USDC/ETH/BTC and the native coins accept their bare code (NOWPayments auto).
  cryptoNetworks: { USDT: "TRC20", BNB: "BSC" },
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
  palplusChannelId: "",
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
  signupBonusEnabled: false,
  signupBonusAmount: 0,
  dailyStakeLimit: 0,
  dailyLossLimit: 0,
  settlementDelayMinutes: 10,
  cronSecret: "",
  oddsSyncLeagues: [],
  oddsRegions: "eu",
  oddsRateLimitMs: 1100,
  oddsEventBookmakers: "bovada,pinnacle",
  oddsMarkets: [],
  oddsFeedMaxLeagues: 120,
  liveScoresThrottleSeconds: 300,
  liveLookbackHours: 4,
  liveOddsThrottleSeconds: 900,
  liveOddsMarkets: ["h2h"],
  betSlipAutoOpen: false,
  broadcastTtlHours: 72,
  maintenanceEnabled: false,
  maintenanceMessage: "",
  statsProvider: "off",
  statsApiKey: "",
  statsDailyBudget: 90,
  statsSettleCorners: false,
  statsSettleHalfTime: false,
  oddsEventMarketLimit: 4,
  oddsEventMarketLeagues: [
    "soccer_epl",
    "soccer_uefa_champs_league",
    "soccer_italy_serie_a",
    "soccer_spain_la_liga",
    "soccer_germany_bundesliga",
    "soccer_france_ligue_one",
  ],
  // Includes the corners family so they show on match detail out of the box.
  soccerDetailMarkets: [...RECOMMENDED_DETAIL_MARKETS],
  soccerDetailCacheTtlSeconds: 45,
};

let cache: SiteSettings | null = null;
let cacheAt = 0;
// Short in-process TTL: bounds cross-replica staleness (Railway/ multi-node)
// to a few seconds while keeping the per-request DB read cheap. A settings
// save clears the cache immediately in the process that handled it.
const SETTINGS_TTL_MS = 3_000;

async function rawSettings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function getSettings(): Promise<SiteSettings> {
  const now = Date.now();
  if (cache && now - cacheAt < SETTINGS_TTL_MS) return cache;
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
  // Auto-upgrade: a stored list that still equals the LEGACY 4-coin default
  // (shipped before the 11-coin expansion) means the admin never customized
  // it — promote to the extended default so the new majors appear without a
  // manual settings/DB edit. A genuinely customized list is left untouched.
  else if (
    s.cryptoCurrencies.length === LEGACY_CRYPTO_CURRENCIES.length &&
    LEGACY_CRYPTO_CURRENCIES.every((c) => s.cryptoCurrencies.includes(c))
  ) {
    s.cryptoCurrencies = DEFAULTS.cryptoCurrencies;
  }
  // Merge over the defaults so USDT/BNB stay pinned even when the admin never
  // saved crypto.networks (or saved an empty object) — stored values win.
  try { s.cryptoNetworks = JSON.parse(raw["crypto.networks"] ?? "{}"); } catch {}
  s.cryptoNetworks = { ...DEFAULTS.cryptoNetworks, ...s.cryptoNetworks };
  try { s.cryptoRates = JSON.parse(raw["crypto.rates"] ?? "{}"); } catch {}
  if (!Object.keys(s.cryptoRates).length) s.cryptoRates = DEFAULTS.cryptoRates;
  // Palplus (gateway M-Pesa) config is read BEFORE the enable flags below:
  // a saved `palplus.apiKey` is itself an "M-Pesa enabled" signal.
  s.palplusApiKey = raw["palplus.apiKey"] ?? s.palplusApiKey;
  // channelId replaced the old merchantId field; fall back to the legacy key if set.
  s.palplusChannelId = raw["palplus.channelId"] ?? raw["palplus.merchantId"] ?? s.palplusChannelId;
  s.palplusWebhookSecret = raw["palplus.webhookSecret"] ?? s.palplusWebhookSecret;
  s.palplusEnv = raw["palplus.env"] ?? s.palplusEnv;
  // M-Pesa rail enablement precedence:
  //   1. ENABLE_MPESA_PAYMENTS env — hard force/kill switch, wins over everything.
  //   2. Explicit admin toggle (Setting row "mpesa.enabled") — true/false as saved.
  //   3. Toggle NEVER saved (row absent) — the rail is on when Palpluss is
  //      configured (an API key is present). Filling in the Palplus gateway
  //      under Admin → M-Pesa (Palplus) IS the act of enabling M-Pesa on a
  //      Palplus install — previously this fell through to `false`, so a
  //      configured Palplus account never surfaced the M-Pesa Deposit tab
  //      (users only saw Crypto + Voucher).
  s.mpesaEnabled =
    process.env.ENABLE_MPESA_PAYMENTS !== undefined
      ? process.env.ENABLE_MPESA_PAYMENTS === "true"
      : raw["mpesa.enabled"] !== undefined
        ? raw["mpesa.enabled"] === "true"
        : Boolean(s.palplusApiKey);
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
  s.signupBonusEnabled = raw["signupBonus.enabled"] === "true";
  s.signupBonusAmount = Number(raw["signupBonus.amount"] ?? s.signupBonusAmount) || 0;
  s.dailyStakeLimit = Number(raw["betting.dailyStakeLimit"] ?? s.dailyStakeLimit);
  s.dailyLossLimit = Number(raw["betting.dailyLossLimit"] ?? s.dailyLossLimit);
  s.settlementDelayMinutes = Number(raw["settlement.delayMinutes"] ?? s.settlementDelayMinutes);
  s.cronSecret = raw["cron.secret"] ?? s.cronSecret;
  // League sync whitelist (JSON array of Odds API sport keys). Tolerant
  // parse: anything invalid/absent = empty = sync every bettable league.
  try {
    const v = JSON.parse(raw["odds.syncLeagues"] ?? "[]");
    s.oddsSyncLeagues = Array.isArray(v)
      ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))]
      : [];
  } catch {
    s.oddsSyncLeagues = [];
  }
  // Per-event deep-market pass: limit (0 = off) + featured leagues (CSV or
  // JSON array). Env overrides (ODDS_API_EVENT_MARKET_LIMIT / _LEAGUES) are
  // applied by the consumer in lib/sync.ts, not here.
  {
    const rawLimit = raw["odds.eventMarketLimit"];
    const n = Number(rawLimit);
    s.oddsEventMarketLimit = rawLimit !== undefined && Number.isFinite(n) ? Math.max(0, n) : s.oddsEventMarketLimit;
    try {
      const rawLeagues = raw["odds.eventMarketLeagues"] ?? "";
      const v: unknown = rawLeagues.trim().startsWith("[") ? JSON.parse(rawLeagues) : rawLeagues.split(",");
      s.oddsEventMarketLeagues = Array.isArray(v)
        ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))]
        : [];
    } catch {
      s.oddsEventMarketLeagues = [];
    }
    // Settlement stats feed (API-Football): provider, key, budget, toggles.
    const rawProvider = (process.env.STATS_PROVIDER ?? raw["stats.provider"] ?? "").trim().toLowerCase();
    if (rawProvider) s.statsProvider = rawProvider === "api-football" ? "api-football" : "off";
    if (raw["stats.apiKey"] !== undefined) s.statsApiKey = String(raw["stats.apiKey"]).trim();
    const rawBudget = Number(process.env.STATS_DAILY_BUDGET ?? raw["stats.dailyBudget"]);
    if (Number.isFinite(rawBudget) && rawBudget >= 0) s.statsDailyBudget = Math.round(rawBudget);
    for (const [key, field] of [
      ["stats.settleCorners", "statsSettleCorners"],
      ["stats.settleHalfTime", "statsSettleHalfTime"],
    ] as const) {
      if (raw[key] !== undefined) s[field] = raw[key] === "true";
    }

    // Broadcast banner lifetime (hours; 0 = never expires).
    const rawBcastTtl = Number(raw["broadcast.ttlHours"]);
    s.broadcastTtlHours =
      raw["broadcast.ttlHours"] !== undefined && Number.isFinite(rawBcastTtl) && rawBcastTtl >= 0
        ? Math.round(rawBcastTtl)
        : s.broadcastTtlHours;
    // Maintenance mode — DB toggle (Admin → Website Settings) with the env var
    // as a hard override. The env path is what proxy.ts uses for DB-down cases.
    if (raw["maintenance.enabled"] !== undefined) {
      s.maintenanceEnabled = raw["maintenance.enabled"] === "true";
    }
    if (process.env.MAINTENANCE_MODE === "1" || process.env.MAINTENANCE_MODE === "true") {
      s.maintenanceEnabled = true;
    }
    if (raw["maintenance.message"] !== undefined) {
      s.maintenanceMessage = String(raw["maintenance.message"]);
    }
    // Bet slip: silent pick-up unless explicitly enabled.
    const rawAutoOpen = process.env.BETSLIP_AUTO_OPEN ?? raw["betSlip.autoOpen"];
    if (rawAutoOpen !== undefined) s.betSlipAutoOpen = rawAutoOpen === "true";
    // TIER 2: deep match-detail markets + their cache TTL.
    try {
      const rawDetail = raw["soccer.detailMarkets"] ?? "";
      const v: unknown = rawDetail.trim().startsWith("[") ? JSON.parse(rawDetail) : rawDetail.split(",");
      const parsed = Array.isArray(v)
        ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))]
        : [];
      // An explicitly-cleared list stays empty (admin turned the tier off).
      s.soccerDetailMarkets = rawDetail !== undefined ? parsed : s.soccerDetailMarkets;
    } catch {
      /* keep the default menu */
    }
    const rawTtl = Number(raw["soccer.detailCacheTtlSeconds"]);
    s.soccerDetailCacheTtlSeconds =
      raw["soccer.detailCacheTtlSeconds"] !== undefined && Number.isFinite(rawTtl) && rawTtl >= 5
        ? Math.min(3600, Math.round(rawTtl))
        : s.soccerDetailCacheTtlSeconds;
    // Provider prefs: regions, rate-limit ms, event bookmakers, market set,
    // feed/sync league cap. Env overrides are applied by the consumers.
    const rawRegions = raw["odds.regions"];
    s.oddsRegions = rawRegions && ["eu", "us", "eu,us"].includes(rawRegions) ? rawRegions : s.oddsRegions;
    const rawRl = Number(raw["odds.rateLimitMs"]);
    s.oddsRateLimitMs = raw["odds.rateLimitMs"] !== undefined && Number.isFinite(rawRl) && rawRl > 0 ? Math.round(rawRl) : s.oddsRateLimitMs;
    s.oddsEventBookmakers = (raw["odds.eventBookmakers"] ?? s.oddsEventBookmakers).trim() || s.oddsEventBookmakers;
    const rawMarkets = raw["odds.markets"] ?? "";
    try {
      const v: unknown = rawMarkets.trim().startsWith("[") ? JSON.parse(rawMarkets) : rawMarkets.split(",");
      s.oddsMarkets = Array.isArray(v)
        ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))]
        : [];
    } catch {
      s.oddsMarkets = [];
    }
    const rawCap = Number(raw["odds.feedMaxLeagues"]);
    s.oddsFeedMaxLeagues = raw["odds.feedMaxLeagues"] !== undefined && Number.isFinite(rawCap) && rawCap > 0 ? Math.round(rawCap) : s.oddsFeedMaxLeagues;
    // Live scores & in-play odds (poll + sweep throttles, lookback, markets)
    const rawPoll = Number(raw["live.refreshSeconds"]);
    if (raw["live.refreshSeconds"] !== undefined && Number.isFinite(rawPoll) && rawPoll >= 10) s.liveRefreshSeconds = Math.round(rawPoll);
    const rawSt = Number(raw["live.scoresThrottleSeconds"]);
    if (raw["live.scoresThrottleSeconds"] !== undefined && Number.isFinite(rawSt) && rawSt >= 10) s.liveScoresThrottleSeconds = Math.round(rawSt);
    const rawLb = Number(raw["live.lookbackHours"]);
    if (raw["live.lookbackHours"] !== undefined && Number.isFinite(rawLb) && rawLb >= 1) s.liveLookbackHours = Math.round(rawLb);
    const rawOt = Number(raw["live.oddsThrottleSeconds"]);
    if (raw["live.oddsThrottleSeconds"] !== undefined && Number.isFinite(rawOt) && rawOt >= 10) s.liveOddsThrottleSeconds = Math.round(rawOt);
    const rawLm = raw["live.oddsMarkets"] ?? "";
    try {
      const v: unknown = rawLm.trim().startsWith("[") ? JSON.parse(rawLm) : rawLm.split(",");
      s.liveOddsMarkets = Array.isArray(v)
        ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))]
        : [];
    } catch {
      s.liveOddsMarkets = [];
    }
  }
  cache = s;
  cacheAt = Date.now();
  return s;
}

export async function setSetting(key: string, value: string) {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  cache = null;
  cacheAt = 0;
}

export async function invalidateSettingsCache() {
  cache = null;
  cacheAt = 0;
}
