"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";

export default function AdminSettings() {
  const { push } = useToast();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<{ settings: Record<string, string> }>("/api/admin/settings").then((r) => r.ok && setSettings(r.data.settings));
  }, []);

  const groups: { title: string; keys: [string, string][] }[] = [
    {
      title: "Branding",
      keys: [
        ["site.name", "Site name"],
        ["site.tagline", "Tagline"],
        ["branding.primaryColor", "Primary color (hex)"],
        ["branding.secondaryColor", "Background color (hex)"],
        ["branding.accentColor", "Accent color (hex)"],
      ],
    },
    {
      title: "Betting",
      keys: [
        ["betting.minStake", "Minimum stake"],
        ["betting.maxStake", "Maximum stake"],
        ["betting.maxPayout", "Maximum payout"],
      ],
    },
    {
      title: "Support",
      keys: [
        ["support.whatsapp", "WhatsApp number"],
        ["support.whatsappMessage", "WhatsApp default message"],
        ["support.whatsappEnabled", "WhatsApp button enabled (true/false)"],
        ["support.whatsappPosition", "WhatsApp position (bottom-left / bottom-right)"],
        ["support.telegram", "Telegram URL"],
        ["support.telegramText", "Telegram button text"],
        ["support.telegramEnabled", "Telegram button enabled (true/false)"],
        ["support.telegramPosition", "Telegram position (bottom-left / bottom-right)"],
        ["support.email", "Support email"],
      ],
    },
    {
      title: "Crypto Payments (NOWPayments)",
      keys: [
        ["crypto.provider", "Provider (NOWPAYMENTS)"],
        ["crypto.apiKey", "API key (create payments)"],
        ["crypto.ipnSecret", "IPN secret (webhook HMAC)"],
        ["crypto.payoutApiKey", "Payout API key (withdrawals)"],
        ["crypto.minDeposit", "Minimum deposit"],
        ["crypto.maxDeposit", "Maximum deposit"],
        ["crypto.confirmations", "Required confirmations"],
        ["crypto.expirationMinutes", "Payment expiration (minutes)"],
        ["crypto.currencies", "Supported cryptos (JSON array)"],
        ["crypto.rates", "Crypto rates in KES per 1 coin (JSON, for deposit estimates)"],
      ],
    },
    {
      title: "M-Pesa (Daraja)",
      keys: [
        ["mpesa.enabled", "M-Pesa enabled (true/false)"],
        ["mpesa.env", "Environment (sandbox / production)"],
        ["mpesa.consumerKey", "Consumer key"],
        ["mpesa.consumerSecret", "Consumer secret"],
        ["mpesa.passkey", "Lipa na M-Pesa passkey"],
        ["mpesa.shortcode", "Paybill shortcode (e.g. 174379 sandbox)"],
        ["mpesa.initiatorName", "B2C initiator name"],
        ["mpesa.securityCredential", "B2C security credential (generated — see docs)"],
        ["mpesa.callbackSecret", "Webhook URL secret (keep random)"],
        ["app.url", "Public app URL for webhooks (e.g. https://yourapp.up.railway.app)"],
      ],
    },
    {
      title: "Homepage",
      keys: [
        ["home.heroTitle", "Hero title"],
        ["home.heroSubtitle", "Hero subtitle"],
      ],
    },
  ];

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
      <h2 className="text-lg font-bold">Website Settings</h2>
      {groups.map((g) => (
        <div key={g.title} className="card p-5">
          <h3 className="font-bold">{g.title}</h3>
          <div className="mt-3 space-y-3">
            {g.keys.map(([key, label]) => (
              <div key={key}>
                <label className="label">{label}</label>
                <input
                  className="input font-mono text-xs"
                  value={settings[key] ?? ""}
                  onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      <button className="btn btn-primary px-8" disabled={loading}>{loading ? "Saving…" : "Save All Settings"}</button>
    </form>
  );
}
