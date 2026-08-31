"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";

type ProfileData = {
  user: { currencyCode: string; status: string };
  wallet: { balance: number; currencyCode: string } | null;
  limits: { depositMethods: string[]; withdrawalMethods?: string[] };
};

export default function WithdrawPage() {
  const { push } = useToast();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [method, setMethod] = useState<"CRYPTO" | "MPESA">("CRYPTO");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [loading, setLoading] = useState(false);
  const [trackingId, setTrackingId] = useState("");

  useEffect(() => {
    apiFetch<ProfileData>("/api/account").then((r) => r.ok && setProfile(r.data));
  }, []);

  const methods = profile?.limits?.withdrawalMethods ?? ["CRYPTO"];

  // Fallback guard (render-time, no effects): M-Pesa toggled off → crypto.
  const effectiveMethod = (methods.includes(method) ? method : methods[0]) as "CRYPTO" | "MPESA" ?? "CRYPTO";
  const max = profile?.wallet?.balance ?? 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return push("error", "Enter a valid amount");
    if (amt > max) return push("error", "Amount exceeds your available balance");
    setLoading(true);
    const res = await apiFetch<{ withdrawal: { trackingId?: string } }>("/api/account/withdraw", {
      method: "POST",
      body: { amount: amt, method: effectiveMethod, destination },
    });
    setLoading(false);
    if (!res.ok) return push("error", res.error.message);
    setTrackingId(res.data.withdrawal.trackingId ?? "");
    push("success", `Withdrawal requested${res.data.withdrawal.trackingId ? ` — ${res.data.withdrawal.trackingId}` : ""}. The amount is reserved until review.`);
    setAmount("");
    setDestination("");
  }

  return (
    <div className="max-w-xl space-y-5">
      <h2 className="text-lg font-bold">Withdraw</h2>

      <div className="card flex items-center justify-between p-4">
        <span className="text-sm text-ink2">Available balance</span>
        <span className="font-extrabold text-green-400">
          {profile?.wallet ? `${Number(profile.wallet.balance).toLocaleString()} ${profile.wallet.currencyCode}` : "—"}
        </span>
      </div>

      {/* Method toggle */}
      <div className="grid grid-cols-2 gap-2">
        {methods.includes("CRYPTO") && (
          <button
            type="button"
            onClick={() => setMethod("CRYPTO")}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
              effectiveMethod === "CRYPTO" ? "border-brand bg-brand/10" : "border-line2 hover:border-ink3"
            }`}
          >
            <span className={`flex h-9 w-9 items-center justify-center rounded-full text-base font-black ${effectiveMethod === "CRYPTO" ? "bg-brand text-[#052e16]" : "bg-card2 text-ink2"}`}>₿</span>
            <span>
              <span className={`block text-sm font-bold ${effectiveMethod === "CRYPTO" ? "text-brand" : "text-ink"}`}>Crypto</span>
              <span className="block text-[11px] text-ink3">BTC · ETH · USDT</span>
            </span>
          </button>
        )}
        {methods.includes("MPESA") && (
          <button
            type="button"
            onClick={() => setMethod("MPESA")}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
              effectiveMethod === "MPESA" ? "border-brand bg-brand/10" : "border-line2 hover:border-ink3"
            }`}
          >
            <span className={`flex h-9 w-9 items-center justify-center rounded-full text-base font-black ${effectiveMethod === "MPESA" ? "bg-brand text-[#052e16]" : "bg-card2 text-ink2"}`}>📱</span>
            <span>
              <span className={`block text-sm font-bold ${effectiveMethod === "MPESA" ? "text-brand" : "text-ink"}`}>M-Pesa</span>
              <span className="block text-[11px] text-ink3">Instant to your number</span>
            </span>
          </button>
        )}
      </div>

      <form onSubmit={submit} className="card space-y-4 p-6">
        <div>
          <label className="label" htmlFor="w-amount">Amount</label>
          <input id="w-amount" className="input" type="number" min="1" step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Enter amount" required />
          <button type="button" className="mt-1.5 text-xs text-brand hover:underline" onClick={() => setAmount(String(max))}>
            Withdraw max
          </button>
        </div>
        <div>
          <label className="label" htmlFor="w-dest">
            {effectiveMethod === "MPESA" ? "M-Pesa number" : "Crypto destination address"}
          </label>
          <input
            id="w-dest"
            className="input font-mono"
            inputMode={effectiveMethod === "MPESA" ? "tel" : "text"}
            placeholder={effectiveMethod === "MPESA" ? "0712 345 678" : "0x… / bc1q… / TRC20…"}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            required
            minLength={effectiveMethod === "MPESA" ? 9 : 8}
          />
          {effectiveMethod === "MPESA" && (
            <p className="mt-1.5 text-xs text-ink3">Payouts are sent from our Paybill via B2C. You may be required to verify identity first.</p>
          )}
        </div>
        <button className="btn btn-primary w-full py-3" disabled={loading}>
          {loading ? "Requesting…" : "Request Withdrawal"}
        </button>
        {trackingId && (
          <p className="rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-center text-sm font-bold text-brand">
            Tracking ID: {trackingId}
          </p>
        )}
        <p className="text-xs text-ink3">
          The amount is reserved from your balance immediately, then reviewed by our finance team and paid out. Save your tracking ID for support queries.
        </p>
      </form>
    </div>
  );
}
