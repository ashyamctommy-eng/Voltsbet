"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "@/lib/client";
import { apiErrorText } from "@/lib/api-error-text";
import { useToast } from "@/components/BetSlipContext";
import { AlertTriangle } from "lucide-react";
import WithdrawalReceiptModal, { type WithdrawalReceipt } from "@/components/account/WithdrawalReceiptModal";

type ProfileData = {
  user: { currencyCode: string; status: string };
  wallet: { balance: number; currencyCode: string } | null;
  limits: { depositMethods: string[]; withdrawalMethods?: string[] };
};

export default function WithdrawPage() {
  const { push } = useToast();
  const { t } = useTranslation();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [method, setMethod] = useState<"CRYPTO" | "MPESA">("CRYPTO");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [loading, setLoading] = useState(false);
  const [receipt, setReceipt] = useState<WithdrawalReceipt | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ProfileData>("/api/account").then((r) => r.ok && setProfile(r.data));
  }, []);

  const methods = profile?.limits?.withdrawalMethods ?? ["CRYPTO"];

  // Fallback guard (render-time, no effects): M-Pesa toggled off → crypto.
  const effectiveMethod = (methods.includes(method) ? method : methods[0]) as "CRYPTO" | "MPESA" ?? "CRYPTO";
  // Withdrawable = real balance only — bonus balance is never withdrawable.
  const max = profile?.wallet?.balance ?? 0;
  const amtNum = amount ? parseFloat(amount) : NaN;
  const exceedsAvailable = Number.isFinite(amtNum) && amtNum > max;
  const noWithdrawable = max <= 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      setFormError(t("withdraw.errorValidAmount"));
      return push("error", t("withdraw.errorValidAmount"));
    }
    // Balance check on submit — fail fast with an inline alert rather than a
    // round-trip. The server re-checks atomically inside its transaction.
    if (amt > max) {
      setFormError(t("withdraw.insufficient"));
      return push("error", t("withdraw.insufficient"));
    }
    setLoading(true);
    const res = await apiFetch<{ withdrawal: { id: string; trackingId?: string; method?: string } }>(
      "/api/account/withdraw",
      { method: "POST", body: { amount: amt, method: effectiveMethod, destination } }
    );
    setLoading(false);
    if (!res.ok) {
      const msg = apiErrorText(t, res.error.code, res.error.message);
      setFormError(msg);
      return push("error", msg);
    }
    const w = res.data.withdrawal;
    setReceipt({
      id: w.id,
      trackingId: w.trackingId ?? "",
      amount: amt,
      currencyCode: profile?.wallet?.currencyCode ?? "KES",
      destination: effectiveMethod === "MPESA" ? destination.replace(/\s/g, "") : destination,
      method: effectiveMethod,
    });
    push("success", t("withdraw.success"));
    setAmount("");
    setDestination("");
  }

  return (
    <div className="max-w-xl space-y-5">
      <h2 className="text-lg font-bold">{t("withdraw.title")}</h2>

      <div className="card flex items-center justify-between p-4">
        <span className="text-sm text-ink2">{t("withdraw.available")}</span>
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
              <span className={`block text-sm font-bold ${effectiveMethod === "CRYPTO" ? "text-brand" : "text-ink"}`}>{t("withdraw.methodCrypto")}</span>
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
              <span className={`block text-sm font-bold ${effectiveMethod === "MPESA" ? "text-brand" : "text-ink"}`}>{t("withdraw.methodMpesa")}</span>
              <span className="block text-[11px] text-ink3">{t("withdraw.methodMpesaSub")}</span>
            </span>
          </button>
        )}
      </div>

      <form onSubmit={submit} className="card space-y-4 p-6">
        <div>
          <label className="label" htmlFor="w-amount">{t("withdraw.amount")}</label>
          <input
            id="w-amount"
            className={`input ${exceedsAvailable || noWithdrawable ? "!border-red-500/60" : ""}`}
            type="number"
            min="1"
            step="any"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={noWithdrawable ? t("withdraw.noFundsPlaceholder") : t("withdraw.amountPlaceholder")}
            required
          />
          {max > 0 && (
            <button type="button" className="mt-1.5 text-xs text-brand hover:underline" onClick={() => setAmount(String(max))}>
              {t("withdraw.withdrawMax")}
            </button>
          )}
        </div>
        <div>
          <label className="label" htmlFor="w-dest">
            {effectiveMethod === "MPESA" ? t("withdraw.destinationMpesa") : t("withdraw.destinationCrypto")}
          </label>
          <input
            id="w-dest"
            className="input font-mono"
            inputMode={effectiveMethod === "MPESA" ? "tel" : "text"}
            placeholder={effectiveMethod === "MPESA" ? t("withdraw.placeholderMpesa") : t("withdraw.placeholderCrypto")}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            required
            minLength={effectiveMethod === "MPESA" ? 9 : 8}
          />
          {effectiveMethod === "MPESA" && (
            <p className="mt-1.5 text-xs text-ink3">{t("withdraw.mpesaNote")}</p>
          )}
        </div>
        {(formError || exceedsAvailable || noWithdrawable) && (
          <div
            className="fade-in flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-3 text-sm text-red-300"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="leading-snug">
              <div className="font-semibold">{t("withdraw.insufficientTitle", { defaultValue: "Insufficient balance" })}</div>
              <div className="text-[11px] text-red-300/80">
                {formError ?? t("withdraw.insufficient")}
              </div>
            </div>
          </div>
        )}
        <button className="btn btn-primary w-full py-3" disabled={loading || exceedsAvailable || noWithdrawable}>
          {loading ? t("withdraw.requesting") : noWithdrawable ? t("withdraw.noWithdrawableBtn") : t("withdraw.request")}
        </button>
        <p className="text-xs text-ink3">
          {t("withdraw.reservedNote")}
        </p>
      </form>

      {receipt && <WithdrawalReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
