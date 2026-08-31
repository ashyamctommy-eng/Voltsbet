"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";
import VoucherDeposit from "@/components/account/VoucherDeposit";

type AccountData = {
  user: { status: string; currencyCode: string };
  wallet: { balance: number; balanceLabel: string; currencyCode: string } | null;
  limits: {
    depositMin: number; depositMax: number;
    cryptoCurrencies: string[]; cryptoRates: Record<string, number>;
    /** KES per 1 unit of each active fiat currency (for non-KES wallets). */
    currencyRates: Record<string, number>;
    depositMethods: string[];
  };
  recentDeposits: {
    id: string; amount: number; currencyCode: string; status: string;
    cryptoCurrency: string | null; method: string | null; createdAt: string;
  }[];
};

type PendingDeposit = {
  id: string; paymentAddress?: string; cryptoCurrency?: string; amount: number; expiresAt?: string;
  method?: string; checkoutRequestId?: string; status?: string;
};

const COIN_META: Record<string, { symbol: string; gradient: string; dp: number }> = {
  BTC: { symbol: "₿", gradient: "linear-gradient(135deg,#f7931a,#c96e0b)", dp: 6 },
  ETH: { symbol: "Ξ", gradient: "linear-gradient(135deg,#627eea,#3f53b0)", dp: 4 },
  USDT: { symbol: "₮", gradient: "linear-gradient(135deg,#26a17b,#1c7a5e)", dp: 2 },
  USDC: { symbol: "$", gradient: "linear-gradient(135deg,#2775ca,#1c5390)", dp: 2 },
};

const STATUS_PILL: Record<string, string> = {
  AWAITING_PAYMENT: "bg-amber-500/15 text-amber-400",
  PAYMENT_DETECTED: "bg-blue-500/15 text-blue-400",
  CONFIRMING: "bg-purple-500/15 text-purple-400",
  CONFIRMED: "bg-sky-500/15 text-sky-400",
  COMPLETED: "bg-green-500/15 text-green-400",
  EXPIRED: "bg-gray-500/15 text-gray-400",
  FAILED: "bg-red-500/15 text-red-400",
  CANCELLED: "bg-gray-500/15 text-gray-400",
};

export default function DepositPage() {
  const { push } = useToast();
  const [account, setAccount] = useState<AccountData | null>(null);
  const [method, setMethod] = useState<"CRYPTO" | "MPESA" | "VOUCHER">("CRYPTO");
  const [crypto, setCrypto] = useState("USDT");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState<PendingDeposit | null>(null);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    const r = await apiFetch<AccountData>("/api/account");
    if (r.ok) setAccount(r.data);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(t);
  }, [refresh]);

  const limits = account?.limits;
  const methods = limits?.depositMethods ?? ["CRYPTO"];
  const coins = limits?.cryptoCurrencies ?? [];
  const rate = limits?.cryptoRates?.[crypto];
  const amountNum = parseFloat(amount) || 0;

  // Currency-aware estimate: cryptoRates are KES per 1 coin, so they only
  // apply directly to KES wallets. USD-pegged wallets get 1:1 for
  // USDT/USDC; other wallets convert through their KES rate. Mirrors the
  // server-side cryptoAmountFor() helper.
  const cryptoAmount = useMemo(() => {
    if (!amountNum || !rate || rate <= 0) return null;
    const walletCur = (account?.user.currencyCode ?? "KES").toUpperCase();
    const coin = crypto.toUpperCase();
    const usdPegged = (c: string) => c === "USD" || c === "USDT" || c === "USDC";
    if (usdPegged(walletCur) && usdPegged(coin)) return amountNum; // $1 = 1 USDT
    if (walletCur === "KES") return amountNum / rate;
    const kesPerWallet = limits?.currencyRates?.[walletCur];
    if (!kesPerWallet || kesPerWallet <= 0) return null;
    return amountNum / (rate / kesPerWallet);
  }, [amountNum, rate, crypto, account?.user.currencyCode, limits?.currencyRates]);

  const valid =
    amountNum >= (limits?.depositMin ?? 0) &&
    amountNum <= (limits?.depositMax ?? 0) &&
    (method === "MPESA" ? /^(\+?254|0)[17]\d{8}$/.test(phone.replace(/\s/g, "")) : true) &&
    account?.user.status !== "SUSPENDED";

  const step = !pending ? 1 : 2;

  async function createDeposit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    const res = await apiFetch<{ deposit: PendingDeposit }>("/api/account", {
      method: "POST",
      body: method === "MPESA"
        ? { amount: amountNum, method: "MPESA", phone }
        : { amount: amountNum, method: "CRYPTO", cryptoCurrency: crypto },
    });
    setLoading(false);
    if (!res.ok) return push("error", res.error.message);
    setPending(res.data.deposit);
    push("success", method === "MPESA" ? "STK push sent — check your phone 📱" : "Payment created — send the crypto to the address shown.");
  }

  async function checkMpesaStatus() {
    if (!pending?.id) return;
    setChecking(true);
    const res = await apiFetch<{ deposit: { status: string } }>(`/api/account/deposits/${pending.id}`);
    setChecking(false);
    if (!res.ok) return push("error", res.error.message);
    if (res.data.deposit.status === "COMPLETED") {
      push("success", "✅ Payment received! Balance credited.");
      setPending(null);
      setAmount("");
      setPhone("");
      refresh();
    } else {
      push("info", "Still waiting — complete the PIN prompt on your phone.");
    }
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(pending?.paymentAddress ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      push("info", "Copy the address manually");
    }
  }

  async function simulateConfirm() {
    if (!pending) return;
    setChecking(true);
    const res = await apiFetch("/api/webhooks/crypto/demo", {
      method: "POST",
      body: { deposit_id: pending.id, tx_hash: `demo-${Date.now().toString(16)}` },
    });
    setChecking(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", "✅ Payment confirmed! Balance credited.");
    setPending(null);
    setAmount("");
    refresh();
  }

  const locked = account && account.user.status !== "ACTIVE";

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h2 className="text-lg font-bold">Deposit</h2>
        <p className="text-sm text-ink3">Instant, secure — your balance is credited automatically after payment is confirmed.</p>
      </div>

      {/* Method toggle */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {methods.includes("CRYPTO") && (
          <MethodCard active={method === "CRYPTO"} icon="₿" title="Crypto" sub="BTC · ETH · USDT" onClick={() => { setMethod("CRYPTO"); setPending(null); }} />
        )}
        {methods.includes("MPESA") && (
          <MethodCard active={method === "MPESA"} icon="📱" title="M-Pesa" sub="STK push · instant" onClick={() => { setMethod("MPESA"); setPending(null); }} />
        )}
        {methods.includes("VOUCHER") && (
          <MethodCard active={method === "VOUCHER"} icon="🎟️" title="Voucher" sub="redeem a code" onClick={() => { setMethod("VOUCHER"); setPending(null); }} />
        )}
      </div>

      {/* Voucher panel replaces the amount stepper (amount comes from the code) */}
      {method === "VOUCHER" ? (
        <VoucherDeposit onSuccess={refresh} />
      ) : (
      <>
      {/* Stepper */}
      <div className="flex items-center gap-2 text-[11px] font-bold">
        {[
          ["1", method === "MPESA" ? "Enter number" : "Choose coin"],
          ["2", "Enter amount"],
          ["3", "Send & confirm"],
        ].map(([n, label], i) => (
          <div key={n} className="flex items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${step >= i ? "bg-brand text-[#052e16]" : "bg-card2 text-ink3"}`}>
              {step > i ? "✓" : n}
            </span>
            <span className={step >= i ? "text-ink" : "text-ink3"}>{label}</span>
            {i < 2 && <span className={`mx-1 h-px w-8 ${step > i ? "bg-brand" : "bg-line2"}`} />}
          </div>
        ))}
      </div>

      {locked && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          ⚠️ Deposits are limited while your account status is “{account?.user.status.replace("_", " ")}”. Contact support if you need help.
        </div>
      )}

      {!pending ? (
        <>
          {/* Coin / phone selector */}
          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold">{method === "MPESA" ? "1 · Your M-Pesa number" : "1 · Choose coin"}</h3>
              <span className="text-xs text-ink3">{method === "MPESA" ? "Lipa na M-Pesa" : "No deposit fees"}</span>
            </div>
            {method === "MPESA" ? (
              <div className="flex items-center gap-3">
                <span className="rounded-lg bg-[#1f3d2b] px-3 py-2.5 text-sm font-bold text-[#3ecf6e]">+254</span>
                <input
                  className="input flex-1"
                  inputMode="tel"
                  placeholder="712 345 678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {coins.map((c) => {
                  const meta = COIN_META[c] ?? { symbol: c.slice(0, 1), gradient: "linear-gradient(135deg,#334,#223)", dp: 2 };
                  const active = crypto === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCrypto(c)}
                      className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition-all ${
                        active ? "border-brand bg-brand/10" : "border-line2 hover:border-ink3"
                      }`}
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-black text-white shadow" style={{ background: meta.gradient }}>
                        {meta.symbol}
                      </span>
                      <span className={`text-xs font-bold ${active ? "text-brand" : "text-ink2"}`}>{c}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Amount */}
          <form onSubmit={createDeposit} className="card space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">2 · Enter amount</h3>
              <span className="text-xs text-ink3">
                Min {limits?.depositMin?.toLocaleString()} · Max {limits?.depositMax?.toLocaleString()}
              </span>
            </div>
            <div>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-ink3">
                  {account?.wallet?.currencyCode ?? "KES"}
                </span>
                <input
                  id="deposit-amount"
                  className="input pl-16 text-lg font-bold"
                  type="number"
                  min={limits?.depositMin ?? 1}
                  step="any"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  required
                />
              </div>
              {method === "CRYPTO" && cryptoAmount !== null && (
                <div className="mt-2 flex items-center justify-between rounded-lg bg-brand/5 px-3 py-2 text-sm">
                  <span className="text-ink2">You&apos;ll send</span>
                  <span className="font-bold text-brand">
                    ≈ {cryptoAmount.toFixed(COIN_META[crypto]?.dp ?? 4)} {crypto}
                  </span>
                </div>
              )}
              {method === "MPESA" && amountNum > 0 && (() => {
                // M-Pesa charges in KES — show what a non-KES wallet user
                // will actually be charged (KES per wallet unit).
                const walletCur = (account?.user.currencyCode ?? "KES").toUpperCase();
                const kesPerWallet = limits?.currencyRates?.[walletCur];
                if (walletCur === "KES" || !kesPerWallet || kesPerWallet <= 0) return null;
                const kesCharge = Math.round(amountNum * kesPerWallet * 100) / 100;
                return (
                  <div className="mt-2 flex items-center justify-between rounded-lg bg-brand/5 px-3 py-2 text-sm">
                    <span className="text-ink2">You&apos;ll be charged</span>
                    <span className="font-bold text-brand">≈ KSh {kesCharge.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
                  </div>
                );
              })()}
              <div className="mt-3 flex gap-2">
                {[5000, 10000, 25000].map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="flex-1 rounded-lg border border-line2 py-1.5 text-xs font-bold text-ink2 hover:border-ink3"
                    onClick={() => setAmount(String(q))}
                  >
                    {q.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>

            <button className={`btn w-full py-3 ${method === "MPESA" ? "bg-[#1f3d2b] text-[#3ecf6e] hover:brightness-110" : "btn-primary"}`} disabled={loading || !valid}>
              {loading
                ? "Processing…"
                : method === "MPESA"
                  ? "Pay with M-Pesa"
                  : "Create Payment"}
            </button>
            {amountNum > 0 && !valid && (
              <p className="text-center text-[11px] font-medium text-amber-400">
                {amountNum < (limits?.depositMin ?? 0)
                  ? `Minimum deposit is ${limits?.depositMin?.toLocaleString()}`
                  : amountNum > (limits?.depositMax ?? 0)
                    ? `Maximum deposit is ${limits?.depositMax?.toLocaleString()}`
                    : method === "MPESA"
                      ? "Enter a valid Kenyan phone number"
                      : "Deposits are disabled for your account status"}
              </p>
            )}
            <p className="text-center text-[11px] text-ink3">
              {method === "MPESA"
                ? "You'll get an M-Pesa PIN prompt on your phone. Confirm it to complete the deposit."
                : "Demo mode: use “Simulate provider confirmation” to test the crypto flow without keys."}
            </p>
          </form>

          {/* Trust badges */}
          <div className="grid grid-cols-3 gap-2 text-center">
            {[["⚡", "Instant credit", "after confirmation"], ["🔒", "Secure", "verified server-side"], ["🛡️", "No fees", "deposit with confidence"]].map(([icon, t, s]) => (
              <div key={t} className="card p-3">
                <div className="text-lg">{icon}</div>
                <div className="mt-1 text-xs font-bold">{t}</div>
                <div className="text-[10px] text-ink3">{s}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        /* Step 3: wait for payment */
        <div className="space-y-4">
          <div className="card space-y-4 p-6">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">3 · {method === "MPESA" ? "Confirm on your phone" : "Send payment"}</h3>
              <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-400">
                {pending.status ?? "Awaiting Payment"}
              </span>
            </div>

            {method === "MPESA" ? (
              <div className="rounded-xl border border-[#3ecf6e]/30 bg-[#1f3d2b]/30 p-5 text-center">
                <div className="text-3xl">📱</div>
                <p className="mt-2 font-semibold">Check your phone</p>
                <p className="mt-1 text-sm text-ink2">
                  An M-Pesa PIN prompt for <b className="text-ink">{amountNum.toLocaleString()} KES</b> was sent to{" "}
                  <b className="text-ink">{phone || "your number"}</b>. Enter your PIN to pay.
                </p>
                <p className="mt-2 text-xs text-ink3">Your balance is credited the moment Safaricom confirms — no manual steps.</p>
                <button className="btn btn-primary mt-4 w-full" onClick={checkMpesaStatus} disabled={checking}>
                  {checking ? "Checking…" : "I've paid — check status"}
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-brand/40 bg-brand/5 p-4 text-center">
                <div className="text-xs text-ink2">
                  Send <b className="text-ink">{cryptoAmount ? `${cryptoAmount.toFixed(COIN_META[crypto]?.dp ?? 4)} ${crypto}` : ""}</b> to this address
                </div>
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-card2 p-3">
                  <span className="min-w-0 flex-1 break-all text-left font-mono text-xs text-brand">{pending.paymentAddress}</span>
                  <button
                    type="button"
                    onClick={copyAddress}
                    className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${copied ? "bg-green-600 text-white" : "bg-white/10 text-ink hover:bg-white/20"}`}
                  >
                    {copied ? "✓ Copied" : "Copy"}
                  </button>
                </div>
                {pending.expiresAt && <Countdown expiresAt={pending.expiresAt} />}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-card2 p-3">
                <div className="text-xs text-ink3">Amount</div>
                <div className="mt-0.5 font-bold">{pending.amount.toLocaleString()} {account?.wallet?.currencyCode}</div>
              </div>
              <div className="rounded-lg bg-card2 p-3">
                <div className="text-xs text-ink3">{method === "MPESA" ? "Provider" : "Network"}</div>
                <div className="mt-0.5 font-bold">{method === "MPESA" ? "M-Pesa" : pending.cryptoCurrency ?? "—"}</div>
              </div>
            </div>

            {method === "CRYPTO" && !pending.paymentAddress?.startsWith("vb") && (
              <p className="text-center text-[11px] text-ink3">
                This is a live provider address — we credit your balance automatically via webhook.
              </p>
            )}
            {method === "CRYPTO" && pending.paymentAddress?.startsWith("vb") && (
              <button className="btn btn-accent w-full" onClick={simulateConfirm} disabled={checking}>
                {checking ? "Confirming…" : "Simulate provider confirmation (demo)"}
              </button>
            )}
            <button className="btn btn-ghost w-full" onClick={() => setPending(null)}>Cancel</button>
          </div>

          <div className="card p-5 text-sm text-ink2">
            <h4 className="font-bold text-ink">What happens next</h4>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>{method === "MPESA" ? "Enter your PIN on the M-Pesa prompt." : "Send the exact amount to the address above."}</li>
              <li>We verify the payment with the provider (on-chain / Safaricom callback).</li>
              <li>Your balance is credited automatically — no manual claims.</li>
            </ol>
          </div>
        </div>
      )}
      </>
      )}

      {/* Recent deposits */}
      {account && account.recentDeposits.length > 0 && (
        <div className="card divide-y divide-line">
          <div className="px-4 py-3 font-bold">Recent Deposits</div>
          {account.recentDeposits.map((d) => (
            <div key={d.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div>
                <span className="font-semibold">{d.amount.toLocaleString()} {d.currencyCode}</span>
                <span className="ml-2 text-xs text-ink3">{d.method === "MPESA" ? "M-Pesa" : d.cryptoCurrency ?? d.currencyCode}</span>
              </div>
              <StatusPill status={d.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MethodCard({ active, icon, title, sub, onClick }: { active: boolean; icon: string; title: string; sub: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
        active ? "border-brand bg-brand/10" : "border-line2 hover:border-ink3"
      }`}
    >
      <span className={`flex h-9 w-9 items-center justify-center rounded-full text-base font-black ${active ? "bg-brand text-[#052e16]" : "bg-card2 text-ink2"}`}>
        {icon}
      </span>
      <span>
        <span className={`block text-sm font-bold ${active ? "text-brand" : "text-ink"}`}>{title}</span>
        <span className="block text-[11px] text-ink3">{sub}</span>
      </span>
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${STATUS_PILL[status] ?? "bg-card2 text-ink2"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  const mm = Math.floor(left / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);
  const expired = left <= 0;

  return (
    <div className={`mt-2 text-[11px] font-semibold ${expired ? "text-red-400" : "text-ink2"}`}>
      {expired ? "Payment window expired — create a new deposit." : `⏳ Expires in ${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`}
    </div>
  );
}
