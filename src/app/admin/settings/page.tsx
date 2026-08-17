"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { IconWhatsApp, IconTelegram, IconCoins, IconSmartphone, IconGear, IconGlobe, IconPencil } from "@/components/icons";

type FieldType = "text" | "password" | "number" | "toggle" | "select";
type Field = {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
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
    ],
  },
  {
    title: "M-Pesa (Daraja)",
    anchor: "mpesa",
    icon: <IconSmartphone className="h-4 w-4" />,
    fields: [
      { key: "mpesa.enabled", label: "M-Pesa enabled", type: "toggle" },
      { key: "mpesa.env", label: "Environment", type: "select", options: ["sandbox", "production"] },
      { key: "mpesa.consumerKey", label: "Consumer key", type: "password" },
      { key: "mpesa.consumerSecret", label: "Consumer secret", type: "password" },
      { key: "mpesa.passkey", label: "Lipa na M-Pesa passkey", type: "password" },
      { key: "mpesa.shortcode", label: "Paybill shortcode", type: "text", hint: "Sandbox: 174379" },
      { key: "mpesa.initiatorName", label: "B2C initiator name", type: "text", hint: "Sandbox default: testapi" },
      { key: "mpesa.securityCredential", label: "B2C security credential", type: "password", hint: "Generate via scripts/gen-mpesa-credential.ts" },
      { key: "mpesa.callbackSecret", label: "Webhook URL secret", type: "password", hint: "Keep random; don't rotate mid-test" },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await apiFetch("/api/admin/settings", { method: "PUT", body: settings });
    setLoading(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", "Settings saved — the whole site updates instantly");
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
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto rounded-2xl border border-line bg-[#0d1726]/95 p-1.5 backdrop-blur-md">
          {GROUPS.map((g) => (
            <button
              key={g.title}
              type="button"
              onClick={() => jump(g.anchor)}
              className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-ink2 transition-colors hover:bg-white/5 hover:text-ink"
            >
              <span className="text-brand">{g.icon}</span>
              {g.title.replace(" (NOWPayments)", "").replace(" (Daraja)", "")}
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
                  <div key={f.key} className="flex items-center justify-between rounded-xl border border-line bg-[#0d1526] px-4 py-3">
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
                        <option key={o} value={o}>{o === "" ? "— none —" : o}</option>
                      ))}
                    </select>
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
        </div>
      ))}

      <button className="btn btn-primary px-8" disabled={loading}>{loading ? "Saving…" : "Save All Settings"}</button>
    </form>
  );
}
