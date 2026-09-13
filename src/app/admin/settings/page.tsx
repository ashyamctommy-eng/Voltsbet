"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { useRouter } from "next/navigation";
import { useSiteSettings } from "@/components/SiteSettingsContext";
import BrandPreview from "@/components/admin/BrandPreview";
import { IconWhatsApp, IconCoins, IconSmartphone, IconGear, IconGlobe, IconGift2, IconPencil } from "@/components/icons";
import { IconBell } from "@/components/icons";

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
      { key: "site.name", label: "Site name", type: "text", hint: "Shown in the header logo, drawer, browser-tab title, footer © line, splash screen, login/register copy, voucher prints, bet share text, and payment/OTP messages" },
      { key: "site.tagline", label: "Tagline", type: "text", hint: "Used in the footer + browser-tab meta description" },
      { key: "support.email", label: "Support email (support@yourdomain)", type: "text", hint: "Shown in the footer contact list + support surfaces. Set per client, e.g. support@voltbets.com — same value as Support & Social → Support email" },
      { key: "branding.primaryColor", label: "Primary color", type: "text", hint: "Hex, e.g. #00e676" },
      { key: "branding.secondaryColor", label: "Background color", type: "text", hint: "NOT IN USE — this value is stored but no stylesheet reads it; the page background is fixed in globals.css. Leave as-is." },
      { key: "branding.accentColor", label: "Accent color", type: "text", hint: "Hex, e.g. #7c3aed" },
    ],
  },
  {
    title: "Broadcast",
    anchor: "broadcast",
    icon: <IconBell className="h-4 w-4" />,
    fields: [
      { key: "broadcast.ttlHours", label: "Broadcast banner lifetime (hours)", type: "number", hint: "How long a Broadcast stays visible site-wide before it disappears on its own. 72 = three days (default), 0 = never expires. Deactivating a broadcast hides it immediately without deleting the history." },
    ],
  },
  {
    title: "Maintenance",
    anchor: "maintenance",
    icon: <IconGear className="h-4 w-4" />,
    fields: [
      { key: "maintenance.enabled", label: "Maintenance mode", type: "toggle", hint: "Shows a branded maintenance screen to customers and returns 503 to the API. Staff and /login stay reachable so you can switch it back OFF; /api/health, cron and payment webhooks keep running. Takes effect within ~3 s — no redeploy. Env MAINTENANCE_MODE=1 forces it on and also works when the database is down." },
      { key: "maintenance.message", label: "Maintenance message", type: "text", hint: "Optional line shown on the maintenance screen, e.g. \"Back at 14:00 EAT.\"" },
    ],
  },
  {
    title: "Betting",
    anchor: "betting",
    icon: <IconGear className="h-4 w-4" />,
    fields: [
      { key: "betSlip.autoOpen", label: "Auto-open bet slip on first pick", type: "toggle", hint: "Off (default) = picking a price is SILENT: the odds cell highlights and the floating slip counter updates, but the slip never pops open. Turn on to open the rail/sheet on the first selection." },
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
    title: "Registration Bonus",
    anchor: "signup-bonus",
    icon: <IconGift2 className="h-4 w-4" />,
    fields: [
      {
        key: "signupBonus.enabled",
        label: "Registration bonus enabled",
        type: "toggle",
        hint: "Credit a welcome bonus to every new account's bonus balance at signup",
      },
      {
        key: "signupBonus.amount",
        label: "Registration bonus amount",
        type: "number",
        hint: "In the wallet currency chosen at registration (e.g. 4000 KES or 50 USD). The bonus is locked — it cannot be staked or withdrawn — until the player's first successful deposit (crypto, M-Pesa or voucher).",
      },
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
      { key: "support.telegram", label: "Telegram URL", type: "text", hint: "e.g. https://t.me/yourbrand" },
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
      { key: "crypto.currencies", label: "Supported cryptos", type: "text", hint: 'JSON array, e.g. ["BTC","ETH","USDT","USDC","BNB","TRX","LTC","SOL","XRP","DOGE","TON"]' },
      { key: "crypto.networks", label: "Crypto networks (coin → chain)", type: "text", hint: 'JSON map, e.g. {"USDT":"TRC20","BNB":"BSC","USDC":"SOL"}. USDT/BNB always need a chain (no bare code on NOWPayments). Leave native coins (BTC, ETH, TRX, LTC, SOL, XRP, DOGE, TON) empty — ETH’s network IS Ethereum ERC20. Valid tokens: TRC20, ERC20, BSC, SOL, TON, BASE, MATIC, OP, OPBNB, ARB, ALGO.' },
      { key: "crypto.rates", label: "Crypto rates (KES per 1 coin)", type: "text", hint: 'JSON object, e.g. {"BTC":8500000,"USDT":129}' },
      { key: "payments.voucherEnabled", label: "Voucher deposits enabled", type: "toggle", hint: "Let players redeem prepaid voucher codes in Wallet → Deposit → Voucher" },
    ],
  },
  {
    title: "M-Pesa (Palplus)",
    anchor: "mpesa",
    icon: <IconSmartphone className="h-4 w-4" />,
    fields: [
      { key: "mpesa.enabled", label: "M-Pesa payments enabled", type: "toggle", hint: "Shows the M-Pesa tab on Deposit & Withdraw. Auto-enables when a Palplus API key is saved below and this switch was never touched. Env ENABLE_MPESA_PAYMENTS (true/false) overrides all of this." },
      { key: "payments.mpesaWithdrawalsEnabled", label: "M-Pesa withdrawals enabled", type: "toggle", hint: "Offer M-Pesa as a payout method (env ENABLE_MPESA_WITHDRAWALS overrides)" },
      { key: "palplus.apiKey", label: "PALPLUS_API_KEY", type: "password", hint: "Gateway API key from the Palplus merchant dashboard. Saving one enables the M-Pesa Deposit tab automatically (unless the toggle above is explicitly OFF or ENABLE_MPESA_PAYMENTS=false)" },
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

/**
 * The rail's five intent buckets. The section list above is grouped by WHEN a
 * setting was added, which is not how anyone looks for one — "min stake" and
 * "odds margin" belong together, and a payment key does not belong next to the
 * site tagline. Order here is the order an operator thinks in.
 */
const BUCKETS: { id: string; label: string; anchors: string[] }[] = [
  { id: "brand", label: "Brand & Identity", anchors: ["branding", "app"] },
  { id: "betting", label: "Betting & Risk", anchors: ["betting", "odds-risk", "referrals", "signup-bonus"] },
  { id: "money", label: "Money & Payments", anchors: ["payments", "mpesa"] },
  { id: "integrations", label: "Integrations", anchors: ["automation", "telegram-bot"] },
  { id: "content", label: "Content & Support", anchors: ["support", "broadcast"] },
];
/** Global-behaviour switches get their own area instead of sitting by a tagline. */
const DANGER_ANCHORS = ["maintenance"];

export default function AdminSettings() {
  const { push } = useToast();
  const router = useRouter();
  const { refresh: refreshBrand } = useSiteSettings();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  /** Settings an env var currently overrides (key → {env, value, effect}). */
  const [envOverrides, setEnvOverrides] = useState<Record<string, { env: string; value: string; effect: string }>>({});

  /** Which secret fields are currently shown in plain text. */
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  useEffect(() => {
    apiFetch<{ settings: Record<string, string>; env?: Record<string, { env: string; value: string; effect: string }> }>(
      "/api/admin/settings",
    ).then((r) => {
      if (!r.ok) return;
      setSettings(r.data.settings);
      setBaseline(r.data.settings);
      setEnvOverrides(r.data.env ?? {});
    });
  }, []);

  const set = (key: string, value: string) => setSettings((s) => ({ ...s, [key]: value }));

  /** Keys whose unsaved value differs from what the server last confirmed. */
  const dirtyKeys = useMemo(
    () => Object.keys(settings).filter((k) => (settings[k] ?? "") !== (baseline[k] ?? "")),
    [settings, baseline],
  );
  const dirtySet = useMemo(() => new Set(dirtyKeys), [dirtyKeys]);

  const sectionKeys = (g: { fields: Field[] }) => g.fields.map((f) => f.key);
  const sectionDirty = (g: { fields: Field[] }) => sectionKeys(g).filter((k) => dirtySet.has(k));

  /** Save only the listed keys. The PUT is a per-key upsert, so a section save
   *  cannot clobber a field the operator never touched. */
  async function saveKeys(keys: string[], successMessage: string) {
    if (!keys.length) return;
    setLoading(true);
    const body: Record<string, string> = {};
    for (const k of keys) body[k] = settings[k] ?? "";
    const res = await apiFetch("/api/admin/settings", { method: "PUT", body });
    setLoading(false);
    if (!res.ok) return push("error", res.error.message);
    setBaseline((b) => ({ ...b, ...body }));
    void refreshBrand();
    router.refresh();
    push("success", successMessage);
  }

  const discard = () => setSettings(baseline);

  /** Renders nothing unless an env var is winning over this field. */
  const EnvTag = ({ k }: { k: string }) => {
    const e = envOverrides[k];
    if (!e) return null;
    return (
      <span
        className="ml-1.5 inline-flex items-center gap-1 rounded border border-warn/45 bg-warn/10 px-1.5 py-0.5 align-middle text-[9.5px] font-black uppercase tracking-wide text-warn"
        title={`${e.env}=${e.value} — ${e.effect}. Change it in the host environment, not here.`}
      >
        ⛔ {e.env}
      </span>
    );
  };

  // ── ⌘K search: match across key, label AND hint, then drop empty sections.
  const term = query.trim().toLowerCase();
  const matches = (f: Field) =>
    !term ||
    f.key.toLowerCase().includes(term) ||
    f.label.toLowerCase().includes(term) ||
    (f.hint ?? "").toLowerCase().includes(term);
  const visibleGroups = GROUPS.map((g) => ({ ...g, fields: g.fields.filter(matches) })).filter(
    (g) => g.fields.length > 0,
  );
  const groupsIn = (anchors: string[]) => GROUPS.filter((g) => anchors.includes(g.anchor));
  const allDirty = (anchors: string[]) => groupsIn(anchors).some((g) => sectionDirty(g).length > 0);

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
    // Re-brand instantly: refetch the public brand payload for the client
    // context (header/drawer/logo) and re-render server components (root
    // layout → metadata + props) without a full page reload.
    void refreshBrand();
    router.refresh();
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
    <form onSubmit={save} className="max-w-6xl">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">Website Settings</h2>
        <div className="relative ml-auto w-full max-w-xs">
          <input
            className="input pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all settings…"
            aria-label="Search all settings"
          />
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3">⌕</span>
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Unsaved-changes bar. Dirty state has to be visible from anywhere on the
          page, not only at the footer — the old single "Save All" at the bottom
          meant a change could sit unsaved for a 3,000px scroll. */}
      {dirtyKeys.length > 0 && (
        <div className="sticky top-16 z-30 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2 backdrop-blur-md">
          <span className="h-2 w-2 rounded-full bg-brand" />
          <span className="text-xs font-bold">
            {dirtyKeys.length} unsaved {dirtyKeys.length === 1 ? "change" : "changes"}
          </span>
          <span className="ml-auto flex gap-1.5">
            <button type="button" className="btn btn-ghost btn-sm" onClick={discard} disabled={loading}>
              Discard
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>
              {loading ? "Saving…" : "Save changes"}
            </button>
          </span>
        </div>
      )}

      <div className="mt-4 flex items-start gap-5">
        {/* Grouped rail — replaces the horizontal pill scroller. */}
        <aside className="sticky top-20 hidden w-56 shrink-0 lg:block">
          <div className="card p-2">
            <div className="px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-ink3">Groups</div>
            {BUCKETS.map((b) => (
              <div key={b.id}>
                {groupsIn(b.anchors).map((g) => (
                  <button
                    key={g.anchor}
                    type="button"
                    onClick={() => jump(g.anchor)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-ink2 transition-colors hover:bg-hover-tint hover:text-ink"
                  >
                    <span className="text-brand-text">{g.icon}</span>
                    <span className="truncate">{g.title.replace(" (NOWPayments)", "").replace(" (Palplus)", "")}</span>
                    {allDirty([g.anchor]) ? (
                      <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-warn" title="unsaved changes" />
                    ) : (
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-ink3">{g.fields.length}</span>
                    )}
                  </button>
                ))}
                <div className="my-1 border-t border-line/60" />
              </div>
            ))}
            <div className="px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-bad">Danger zone</div>
            {groupsIn(DANGER_ANCHORS).map((g) => (
              <button
                key={g.anchor}
                type="button"
                onClick={() => jump(g.anchor)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-bad transition-colors hover:bg-bad/10"
              >
                <span>{g.icon}</span>
                <span className="truncate">{g.title}</span>
                {allDirty([g.anchor]) && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />}
              </button>
            ))}
          </div>
          <p className="mt-2 px-1 text-[10px] leading-relaxed text-ink3">
            Each section saves on its own; the footer saves everything at once.
          </p>
        </aside>

        <div className="min-w-0 flex-1 space-y-5">
          {visibleGroups.length === 0 && (
            <div className="card p-6 text-sm text-ink2">
              No setting matches “{query}”. Try a shorter term — search covers each field&apos;s name, key and help text.
            </div>
          )}
      {visibleGroups.map((g) => (
        <div key={g.title} id={`section-${g.anchor}`} className="scroll-mt-40 card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="flex items-center gap-2 font-bold">
              <span className="text-brand-text">{g.icon}</span>
              {g.title}
            </h3>
            {sectionDirty(g).length > 0 && (
              <button
                type="button"
                className="btn btn-primary btn-sm ml-auto"
                disabled={loading}
                onClick={() => void saveKeys(sectionDirty(g), `${g.title} saved`)}
              >
                Save section ({sectionDirty(g).length})
              </button>
            )}
          </div>
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
                      disabled={!!envOverrides[f.key]}
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
                    <label className="label">{f.label}<EnvTag k={f.key} /></label>
                    <select className="input" value={value} disabled={!!envOverrides[f.key]} onChange={(e) => set(f.key, e.target.value)}>
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
                    <label className="label">{f.label}<EnvTag k={f.key} /></label>
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
              // The generic renderer is why a hex colour used to get a plain
              // text box and a secret got a bare input. Fields that HAVE a
              // better control now get one; everything else is unchanged.
              const isColour = /\.(primaryColor|secondaryColor|accentColor)$/.test(f.key);
              const isSecret = f.type === "password";
              const shown = revealed.has(f.key);

              if (isColour) {
                const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
                return (
                  <div key={f.key}>
                    <label className="label">{f.label}<EnvTag k={f.key} /></label>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-9 w-9 shrink-0 rounded-lg border border-line"
                        style={{ background: hex }}
                        aria-hidden
                      />
                      <input
                        className="input font-mono text-xs"
                        value={value}
                        disabled={!!envOverrides[f.key]}
                        onChange={(e) => set(f.key, e.target.value)}
                      />
                      <input
                        type="color"
                        className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent"
                        value={hex}
                        onChange={(e) => set(f.key, e.target.value)}
                        aria-label={`${f.label} picker`}
                      />
                    </div>
                    {f.hint && <p className="mt-1 text-[11px] text-ink3">{f.hint}</p>}
                  </div>
                );
              }

              if (isSecret) {
                return (
                  <div key={f.key} className="sm:col-span-2">
                    <label className="label">{f.label}<EnvTag k={f.key} /></label>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        className="input min-w-0 flex-1 font-mono text-xs"
                        type={shown ? "text" : "password"}
                        value={value}
                        onChange={(e) => set(f.key, e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          setRevealed((r) => {
                            const next = new Set(r);
                            if (next.has(f.key)) next.delete(f.key);
                            else next.add(f.key);
                            return next;
                          })
                        }
                      >
                        {shown ? "Hide" : "Reveal"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title="Generate a new 32-byte hex secret"
                        onClick={() => {
                          const bytes = new Uint8Array(24);
                          crypto.getRandomValues(bytes);
                          set(f.key, Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
                        }}
                      >
                        Generate
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={!value}
                        onClick={() => {
                          void navigator.clipboard.writeText(value);
                          push("success", `${f.label} copied`);
                        }}
                      >
                        Copy
                      </button>
                    </div>
                    {f.hint && <p className="mt-1 text-[11px] text-ink3">{f.hint}</p>}
                  </div>
                );
              }

              return (
                <div key={f.key}>
                  <label className="label">{f.label}<EnvTag k={f.key} /></label>
                  <input
                    className="input font-mono text-xs"
                    type={f.type === "number" ? "number" : "text"}
                    value={value}
                    disabled={!!envOverrides[f.key]}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                  {f.hint && <p className="mt-1 text-[11px] text-ink3">{f.hint}</p>}
                </div>
              );
            })}
          </div>
          {g.anchor === "branding" && (
            <div className="mt-4 border-t border-line pt-4">
              <BrandPreview
                primary={settings["branding.primaryColor"] ?? ""}
                accent={settings["branding.accentColor"] ?? ""}
                siteName={settings["site.name"] ?? ""}
                onApply={(primary, accent) =>
                  setSettings((s) => ({
                    ...s,
                    "branding.primaryColor": primary,
                    "branding.accentColor": accent,
                  }))
                }
              />
            </div>
          )}
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

        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button className="btn btn-primary px-8" disabled={loading}>
          {loading ? "Saving…" : "Save All Settings"}
        </button>
        {dirtyKeys.length > 0 && (
          <span className="text-xs font-semibold text-warn">{dirtyKeys.length} unsaved</span>
        )}
      </div>
    </form>
  );
}
