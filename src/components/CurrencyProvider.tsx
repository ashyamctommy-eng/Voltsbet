"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";

export type CurrencyInfo = {
  code: string; // ISO code, e.g. "KES"
  symbol: string; // display symbol, e.g. "KSh"
  decimals: number;
};

type CurrencyCtx = CurrencyInfo & {
  ready: boolean;
  /** Format an amount with the platform's default currency code, e.g.
   *  fmt(3.05) → "KES 3.05". */
  fmt: (amount: number, opts?: { maximumFractionDigits?: number }) => string;
};

const FALLBACK: CurrencyInfo = { code: "KES", symbol: "KSh", decimals: 2 };
const Ctx = createContext<CurrencyCtx | null>(null);

/**
 * Platform-wide default operating currency (admin-configured at
 * Admin → Settings → Default Currency). All display surfaces (betslip
 * payouts, stakes, balances) format money through this provider so a single
 * admin change re-symbols the whole frontend.
 */
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<CurrencyInfo>(FALLBACK);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/public/currencies", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { defaultCode?: string; currencies?: { code: string; symbol: string; decimals: number }[] }) => {
        if (!alive) return;
        const code = d.defaultCode;
        const found = d.currencies?.find((c) => c.code === code);
        if (found) {
          setInfo({ code: found.code, symbol: found.symbol, decimals: found.decimals });
        } else if (code) {
          setInfo((prev) => ({ ...prev, code }));
        }
        setReady(true);
      })
      .catch(() => {
        if (alive) setReady(true); // fallback: KES
      });
    return () => {
      alive = false;
    };
  }, []);

  const fmt = useCallback(
    (amount: number, opts?: { maximumFractionDigits?: number }) => {
      const n = Number(amount);
      if (!isFinite(n)) return `${info.code} 0`;
      const digits = opts?.maximumFractionDigits ?? info.decimals;
      return `${info.code} ${n.toLocaleString("en-US", {
        minimumFractionDigits: Math.min(2, digits),
        maximumFractionDigits: digits,
      })}`;
    },
    [info.code, info.decimals],
  );

  const value = useMemo(
    () => ({ ...info, ready, fmt }),
    [info, ready, fmt],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrency(): CurrencyCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
  return ctx;
}
