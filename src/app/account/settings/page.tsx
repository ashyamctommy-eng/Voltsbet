"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import { formatDateTime } from "@/lib/odds";

type ProfileData = {
  user: {
    fullName: string; username: string; email: string; phone: string; country: string;
    languageCode: string; currencyCode: string; displayCurrencyCode: string;
    status: string; verified: boolean; createdAt: string;
  };
};

type Notification = { id: string; title: string; message: string; type: string; read: boolean; createdAt: string };

export default function SettingsPage() {
  const { push } = useToast();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [currencies, setCurrencies] = useState<{ code: string; name: string; symbol: string }[]>([]);
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  const [displayCurrency, setDisplayCurrency] = useState("");
  const [language, setLanguage] = useState("");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await apiFetch<ProfileData>("/api/account");
      if (p.ok) {
        setProfile(p.data);
        setDisplayCurrency(p.data.user.displayCurrencyCode);
        setLanguage(p.data.user.languageCode);
      }
      const c = await apiFetch<{ currencies: { code: string; name: string; symbol: string }[] }>("/api/public/currencies");
      if (c.ok) setCurrencies(c.data.currencies);
      const l = await apiFetch<{ languages: { code: string; name: string }[] }>("/api/public/languages");
      if (l.ok) setLanguages(l.data.languages);
      const n = await apiFetch<{ notifications: Notification[] }>("/api/notifications");
      if (n.ok) setNotifications(n.data.notifications);
    })();
  }, []);

  async function saveSettings() {
    setSaving(true);
    const res = await apiFetch("/api/account", {
      method: "PATCH",
      body: { displayCurrency, language },
    });
    setSaving(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", "Settings saved. Display currency change does not affect your wallet value.");
  }

  async function markRead() {
    await apiFetch("/api/notifications", { method: "POST", body: {} });
    setNotifications((ns) => ns.map((n) => ({ ...n, read: true })));
    push("success", "Notifications marked as read");
  }

  if (!profile) return <div className="card p-8 text-center text-ink3">Loading…</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-lg font-bold">Account Settings</h2>

      {/* Profile */}
      <div className="card space-y-3 p-6 text-sm">
        <h3 className="font-bold">Profile</h3>
        <Row k="Full name" v={profile.user.fullName} />
        <Row k="Username" v={profile.user.username} />
        <Row k="Email" v={profile.user.email} />
        <Row k="Phone" v={profile.user.phone} />
        <Row k="Country" v={profile.user.country || "—"} />
        <Row k="Wallet currency" v={profile.user.currencyCode} note="Your balance is held in this currency" />
        <Row
          k="Verification"
          v={profile.user.verified ? "Verified" : "Pending"}
          highlight={profile.user.verified ? "text-green-400" : "text-amber-400"}
        />
      </div>

      {/* Preferences */}
      <div className="card space-y-4 p-6">
        <h3 className="font-bold">Display Preferences</h3>
        <div>
          <label className="label" htmlFor="cur">Display currency</label>
          <select id="cur" className="input" value={displayCurrency} onChange={(e) => setDisplayCurrency(e.target.value)}>
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>{c.code} — {c.name} ({c.symbol})</option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-ink3">Display-only. Your wallet balance is never converted — values are shown in your chosen currency using live rates.</p>
        </div>
        <div>
          <label className="label" htmlFor="lang">Language</label>
          <select id="lang" className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" onClick={saveSettings} disabled={saving}>
          {saving ? "Saving…" : "Save preferences"}
        </button>
      </div>

      {/* Notifications */}
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <h3 className="font-bold">Notifications</h3>
          <button className="text-xs font-semibold text-brand hover:underline" onClick={markRead}>Mark all read</button>
        </div>
        <div className="mt-3 space-y-2">
          {notifications.length === 0 && <p className="text-sm text-ink3">No notifications.</p>}
          {notifications.map((n) => (
            <div key={n.id} className={`rounded-lg border px-3 py-2.5 text-sm ${n.read ? "border-line opacity-60" : "border-brand/30 bg-brand/5"}`}>
              <div className="font-semibold">{n.title}</div>
              <div className="text-xs text-ink2">{n.message}</div>
              <div className="mt-1 text-[10px] text-ink3">{formatDateTime(new Date(n.createdAt))}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, note, highlight }: { k: string; v: string; note?: string; highlight?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-0">
      <div>
        <span className="text-ink2">{k}</span>
        {note && <div className="text-[11px] text-ink3">{note}</div>}
      </div>
      <span className={`font-semibold ${highlight ?? ""}`}>{v}</span>
    </div>
  );
}
