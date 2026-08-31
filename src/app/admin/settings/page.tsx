"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { IconWhatsApp, IconTelegram, IconCoins, IconSmartphone, IconGear, IconGlobe, IconGift2, IconPencil, IconTv } from "@/components/icons";

type FieldType = "text" | "password" | "number" | "toggle" | "select" | "copy";
type Field = {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  /** Label rendered for an empty-string option (defaults to "— none —"). */
  emptyLabel?: string;
  hint?: string;
};

const GROUPS: { title: string; anchor: string; icon: React.ReactNode; fields: Field[] }[] = [
  {
    title: "Branding",
    anchor: "branding",
    icon: <IconPencil className="h-4 w-4" />,
    fields: [
      { key: "site.name", label: "Site name", type: "text" },
      { key: "site.tagline", label: "Tagline", type: "text" },
      { key: "branding.primaryColor", label: "Primary color", type: "text", hint: "Hex, e.g. #00e676" },
      { key: "branding.secondaryColor", label: "Background color", type: "text", hint: "Hex, e.g. #0b1220" },
      { key: "branding.accentColor", label: "Accent color", type: "text", hint: "Hex, e.g. #7c3aed" },
    ],
  },
  {
    title: "Betting",
    anchor: "betting",
    icon: <IconGear className="h-4 w-4" />,
    fields: [
      { key: "betting.minStake", label: "Minimum stake", type: "number" },
      { key: "betting.maxStake", label: "Maximum stake", type: "number" },
      { key: "betting.maxPayout", label: "Maximum payout", type: "number" },
      { key: "betting.cashoutEnabled", label: "Cash-out enabled", type: "toggle", hint: "Let players cash out open bets early at a live quote" },
      { key: "betting.cashoutMarginPercent", label: "Cash-out margin %", type: "number", hint: "Book margin taken off the fair-value quote (e.g. 5 = player gets 95% of fair value)" },
      { key: "betting.dailyStakeLimit", label: "Daily stake limit per user", type: "number", hint: "Responsible gambling: max total staked per user per rolling 24h. 0 = unlimited" },
      { key: "betting.dailyLossLimit", label: "Daily loss limit per user", type: "number", hint: "Responsible gambling: max net loss per user per rolling 24h. 0 = unlimited" },
    ],
  },
  {
    title: "Odds & Risk",
    anchor: "odds-risk",
    icon: <IconGear className="h-4 w-4" />,
    fields: [
      { key: "odds.marginPercent", label: "Odds margin %", type: "number", hint: "Overround added to feed odds — this is your edge. 0 = pass through, 6 = 6% book" },
      { key: "games.hideSeeded", label: "Disable seeded / virtual matches", type: "toggle", hint: "Show only live API-feed matches (source=API). Turns on automatically after the first successful sync that adds games. Env override: SHOW_SEEDED_GAMES=false" },
      { key: "currency.forceDefault", label: "Force default currency (ignore IP auto-detect)", type: "toggle", hint: "ON = every visitor sees the platform default currency regardless of location or profile. OFF = per-user display preference wins, then IP auto-detection (ipapi.co → currency, fallback USD)." },
      { key: "betting.maxLiabilityPerMarket", label: "Max liability per market", type: "number", hint: "Reject bets that push exposure past this cap" },
    ],
  },
  {
    title: "Live",
    anchor: "live",
    icon: <IconTv className="h-4 w-4" />,
    fields: [
      { key: "live.refreshSeconds", label: "Live page auto-refresh (seconds)", type: "number", hint: "How often /live polls for fresh scores/timers. The Odds API /scores sweep runs at most once per this window per active league (throttled separately, default 5 min)" },
    ],
  },
  {
    title: "Referrals",
    anchor: "referrals",
    icon: <IconGift2 className="h-4 w-4" />,
    fields: [
      { key: "referral.enabled", label: "Referral program enabled", type: "toggle" },
      { key: "referral.bonusPercent", label: "Bonus % of referee's first deposit", type: "number" },
      { key: "referral.bonusCap", label: "Max bonus per referee", type: "number" },
      { key: "referral.minDeposit", label: "Min referee deposit to trigger", type: "number" },
    ],
  },
  {
    title: "Automation",
    anchor: "automation",
    icon: <IconGear className="h-4 w-4" />,
    fields: [
      { key: "settlement.delayMinutes", label: "Settle finished games after (minutes)", type: "number", hint: "Delay so late score corrections don't cause bad settlements" },
      { key: "cron.secret", label: "Cron secret", type: "password", hint: "Bearer token for /api/cron/settle — call from any scheduler every ~10 min" },
    ],
  },
  {
    title: "Support & Social (sliding menu)",
    anchor: "support",
    icon: <IconWhatsApp className="h-4 w-4" />,
    fields: [
      { key: "support.whatsapp", label: "WhatsApp number", type: "text", hint: "International format, e.g. 254712345678" },
      { key: "support.whatsappMessage", label: "WhatsApp default message", type: "text" },
      { key: "support.whatsappEnabled", label: "Show WhatsApp button", type: "toggle" },
      { key: "support.whatsappPosition", label: "WhatsApp position", type: "select", options: ["bottom-left", "bottom-right"] },
      { key: "support.telegram", label: "Telegram URL", type: "text", hint: "e.g. https://t.me/voltbet" },
      { key: "support.telegramEnabled", label: "Show Telegram button", type: "toggle" },
      { key: "support.telegramPosition", label: "Telegram position", type: "select", options: ["bottom-left", "bottom-right"] },
      { key: "support.email", label: "Support email", type: "text" },
      { key: "support.phone", label: "Support phone (Call Us)", type: "text", hint: "Shown in the support modal" },
    ],
  },
  {
    title: "Crypto Payments (NOWPayments)",
    anchor: "payments",
    icon: <IconCoins className="h-4 w-4" />,
    fields: [
      { key: "crypto.provider", label: "Provider", type: "select", options: ["", "NOWPAYMENTS"] },
      { key: "crypto.apiKey", label: "API key (create payments)", type: "password" },
      { key: "crypto.ipnSecret", label: "IPN secret (webhook HMAC)", type: "password" },
      { key: "crypto.payoutApiKey", label: "Payout API key (withdrawals)", type: "password" },
      { key: "crypto.minDeposit", label: "Minimum deposit", type: "number" },
      { key: "crypto.maxDeposit", label: "Maximum deposit", type: "number" },
      { key: "crypto.confirmations", label: "Required confirmations", type: "number" },
      { key: "crypto.expirationMinutes", label: "Payment expiration (minutes)", type: "number" },
      { key: "crypto.currencies", label: "Supported cryptos", type: "text", hint: 'JSON array, e.g. ["BTC","USDT"]' },
      { key: "crypto.rates", label: "Crypto rates (KES per 1 coin)", type: "text", hint: 'JSON object, e.g. {"BTC":8500000,"USDT":129}' },
      { key: "payments.voucherEnabled", label: "Voucher deposits enabled", type: "toggle", hint: "Let players redeem prepaid voucher codes in Wallet → Deposit → Voucher" },
    ],
  },
  {
    title: "M-Pesa (Palplus)",
    anchor: "mpesa",
    icon: <IconSmartphone className="h-4 w-4" />,
    fields: [
      { key: "mpesa.enabled", label: "M-Pesa payments enabled", type: "toggle", hint: "Show the M-Pesa tab on Deposit & Withdraw (env ENABLE_MPESA_PAYMENTS overrides)" },
      { key: "payments.mpesaWithdrawalsEnabled", label: "M-Pesa withdrawals enabled", type: "toggle", hint: "Offer M-Pesa as a payout method (env ENABLE_MPESA_WITHDRAWALS overrides)" },
      { key: "palplus.apiKey", label: "PALPLUS_API_KEY", type: "password", hint: "Gateway API key from the Palplus merchant dashboard" },
      { key: "palplus.channelId", label: "PALPLUS_CHANNEL_ID (optional)", type: "text", hint: "Payment-channel UUID from the Palpluss console — only needed if your account has no default channel" },
      { key: "palplus.webhookSecret", label: "PALPLUS_WEBHOOK_SECRET", type: "password", hint: "Appended to callback URLs as ?secret= — callbacks without it are rejected" },
      { key: "palplus.env", label: "PALPLUS_ENV", type: "select", options: ["sandbox", "production"], hint: "Keys start with pp_live_ (production) / pp_test_ (test) — check the console" },
      { key: "palplus.webhookUrl", label: "Palpluss webhook URL", type: "copy", hint: "Callbacks are POSTed here; the ?secret= suffix is appended automatically by the app" },
    ],
  },
  {
    title: "Telegram Bot (OTP)",
    anchor: "telegram-bot",
    icon: <IconGlobe className="h-4 w-4" />,
    fields: [
      { key: "telegram.botToken", label: "Bot token", type: "password", hint: "From @BotFather" },
      { key: "telegram.botUsername", label: "Bot username", type: "text", hint: "Without @ — used for t.me deep links" },
      { key: "telegram.webhookSecret", label: "Webhook secret", type: "password", hint: "Set as secret_token on setWebhook" },
      { key: "telegram.otpEnabled", label: "Require Telegram OTP at login", type: "toggle", hint: "Linked accounts get a 6-digit code in Telegram" },
    ],
  },
  {
    title: "App & Homepage",
    anchor: "app",
    icon: <IconGlobe className="h-4 w-4" />,
    fields: [
      { key: "app.url", label: "Public app URL", type: "text", hint: "e.g. https://yourapp.up.railway.app — used for webhook callbacks" },
      { key: "home.heroTitle", label: "Hero title", type: "text" },
      { key: "home.heroSubtitle", label: "Hero subtitle", type: "text" },
    ],
  },
];

export default function AdminSettings() {
  const { push } = useToast();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<{ settings: Record<string, string> }>("/api/admin/settings").then((r) => r.ok && setSettings(r.data.settings));
  }, []);

  const set = (key: string, value: string) => setSettings((s) => ({ ...s, [key]: value }));

  const jump = (anchor: string) => {
    document.getElementById(`section-${anchor}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Jump to a section when arriving with a hash (e.g. #payments from sidebar)
  useEffect(() => {
    const h = window.location.hash.replace("#", "");
    if (h) {
      const t = setTimeout(() => jump(h), 350);
      return () => clearTimeout(t);
    }
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await apiFetch("/api/admin/settings", { method: "PUT", body: settings });
    setLoading(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", "Settings saved — the whole site updates instantly");
  }

  const [testing, setTesting] = useState(false);
  const [palplusTest, setPalplusTest] = useState<string | null>(null);

  // Read-only connectivity check against the PalPluss API (service-wallet
  // balance) using the unsaved key from the form — no payment is initiated.
  async function testPalplus() {
    setTesting(true);
    setPalplusTest(null);
    const res = await apiFetch<{ balance: { availableBalance: number; currency: string } }>(
      "/api/admin/payments/palplus-test",
      { method: "POST", body: { apiKey: settings["palplus.apiKey"], env: settings["palplus.env"] } },
    );
    setTesting(false);
    if (!res.ok) return setPalplusTest(`❌ ${res.error?.message ?? "Connection failed"}`);
    setPalplusTest(
      `✅ Connected — service wallet ${res.data.balance.availableBalance.toLocaleString()} ${res.data.balance.currency}`,
    );
  }

  return (
    <form onSubmit={save} className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Website Settings</h2>
        <span className="hidden items-center gap-1.5 text-xs text-ink3 sm:flex">
          <IconTelegram className="h-4 w-4" /> Sliding-menu social links &amp; payment keys live here
        </span>
      </div>

      {/* Sticky section quick-nav */}
      <div className="sticky top-16 z-30 -mx-1 px-1 py-2">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto rounded-2xl border border-line bg-panel-bg/95 p-1.5 backdrop-blur-md">
          {GROUPS.map((g) => (
            <button
              key={g.title}
              type="button"
              onClick={() => jump(g.anchor)}
              className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-ink2 transition-colors hover:bg-hover-tint hover:text-ink"
            >
              <span className="text-brand">{g.icon}</span>
              {g.title.replace(" (NOWPayments)", "").replace(" (Palplus)", "")}
            </button>
          ))}
        </div>
      </div>

      {GROUPS.map((g) => (
        <div key={g.title} id={`section-${g.anchor}`} className="scroll-mt-40 card p-5">
          <h3 className="flex items-center gap-2 font-bold">
            <span className="text-brand">{g.icon}</span>
            {g.title}
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {g.fields.map((f) => {
              const value = settings[f.key] ?? "";
              if (f.type === "toggle") {
                const on = value === "true";
                return (
                  <div key={f.key} className="flex items-center justify-between rounded-xl border border-line bg-card px-4 py-3">
                    <span className="text-sm font-medium text-ink2">{f.label}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      onClick={() => set(f.key, on ? "false" : "true")}
                      className={`relative h-6 w-11 rounded-full transition-colors ${on ? "bg-brand" : "bg-line2"}`}
                    >
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </div>
                );
              }
              if (f.type === "select") {
                return (
                  <div key={f.key}>
                    <label className="label">{f.label}</label>
                    <select className="input" value={value} onChange={(e) => set(f.key, e.target.value)}>
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>{o === "" ? (f.emptyLabel ?? "— none —") : o}</option>
                      ))}
                    </select>
                  </div>
                );
              }
              if (f.type === "copy") {
                const appUrl = settings["app.url"]?.replace(/\/$/, "") ?? "";
                const url = appUrl ? `${appUrl}/api/webhooks/palplus` : "";
                return (
                  <div key={f.key} className="sm:col-span-2">
                    <label className="label">{f.label}</label>
                    <div className="flex gap-2">
                      <input className="input flex-1 font-mono text-xs" readOnly value={url} placeholder="Set App & Homepage → Public app URL first" />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm shrink-0"
                        disabled={!url}
                        onClick={() => {
                          void navigator.clipboard.writeText(url);
                          push("success", "Webhook URL copied");
                        }}
                      >
                        Copy
                      </button>
                    </div>
                    {f.hint && <p className="mt-1 text-xs text-ink3">{f.hint}</p>}
                  </div>
                );
              }
              return (
                <div key={f.key}>
                  <label className="label">{f.label}</label>
                  <input
                    className="input font-mono text-xs"
                    type={f.type === "password" ? "password" : f.type === "number" ? "number" : "text"}
                    value={value}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                  {f.hint && <p className="mt-1 text-[11px] text-ink3">{f.hint}</p>}
                </div>
              );
            })}
          </div>
          {g.title.includes("Palplus") && (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <button type="button" className="btn btn-ghost btn-sm" disabled={testing} onClick={testPalplus}>
                {testing ? "Testing…" : "⟳ Test Palpluss connection"}
              </button>
              {palplusTest && <span className="text-xs font-medium text-ink2">{palplusTest}</span>}
            </div>
          )}
        </div>
      ))}

      <button className="btn btn-primary px-8" disabled={loading}>{loading ? "Saving…" : "Save All Settings"}</button>
    </form>
  );
}
