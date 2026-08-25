"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";

export type CurrencyInfo = {
  code: string; // ISO code, e.g. "KES"
  symbol: string; // display symbol, e.g. "KSh"
  decimals: number;
};

export type CurrencyEntry = CurrencyInfo & { rate: number };

type CurrencyCtx = CurrencyInfo & {
  ready: boolean;
  /** All active currencies with live rates (from /api/public/currencies). */
  currencies: Record<string, CurrencyEntry>;
  /** Platform-wide default operating currency code. */
  defaultCode: string;
  /** Format an amount with the platform's default currency code, e.g.
   *  fmt(3.05) → "KES 3.05". */
  fmt: (amount: number, opts?: { maximumFractionDigits?: number }) => string;
  /**
   * Unified formatter: converts `amount` (denominated in currency `from`)
   * to currency `to` using live rates, then formats with `to`'s symbol.
   * All monetary figures that must share one symbol should go through this.
   */
  fmtCurrency: (amount: number, from: string, to: string) => string;
  /** Override the active currency app-wide (persists to localStorage). */
  setDefaultCurrency: (code: string) => void;
};

const FALLBACK: CurrencyInfo = { code: "KES", symbol: "KSh", decimals: 2 };
const STORAGE_KEY = "vb.currency";
const Ctx = createContext<CurrencyCtx | null>(null);

/**
 * Platform-wide operating currency. Hydrates from a localStorage override
 * (admin picks a new default → applied instantly app-wide and survives page
 * refreshes), otherwise from the admin-configured server default
 * (Admin → Settings → Default Currency).
 */
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<CurrencyInfo>(FALLBACK);
  const [currencies, setCurrencies] = useState<Record<string, CurrencyEntry>>({});
  const [defaultCode, setDefaultCode] = useState<string>("KES");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/public/currencies", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { defaultCode?: string; currencies?: CurrencyEntry[] }) => {
        if (!alive) return;
        const list = d.currencies ?? [];
        const map = Object.fromEntries(list.map((c) => [c.code, c]));
        setCurrencies(map);
        const serverDefault = d.defaultCode ?? (list[0]?.code ?? "KES");
        setDefaultCode(serverDefault);
        // localStorage override wins (admin instant-switch persistence).
        let code: string | null = null;
        try {
          code = window.localStorage.getItem(STORAGE_KEY);
        } catch { /* ignore */ }
        const chosen = code && map[code] ? code : serverDefault;
        const found = map[chosen] ?? map[serverDefault];
        if (found) {
          setInfo({ code: found.code, symbol: found.symbol, decimals: found.decimals });
        } else if (chosen) {
          setInfo((prev) => ({ ...prev, code: chosen }));
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

  const fmtCurrency = useCallback(
    (amount: number, from: string, to: string) => {
      const n = Number(amount);
      if (!isFinite(n)) return `${to} 0`;
      const f = currencies[from];
      const t = currencies[to];
      // Convert via base-unit rates when both known and different.
      let value = n;
      if (f && t && from !== to && f.rate > 0 && t.rate > 0) {
        value = (n * f.rate) / t.rate;
      }
      const symbol = t?.symbol ?? to;
      const decimals = t?.decimals ?? 2;
      return `${symbol} ${value.toLocaleString("en-US", {
        minimumFractionDigits: Math.min(2, decimals),
        maximumFractionDigits: decimals,
      })}`;
    },
    [currencies],
  );

  const setDefaultCurrency = useCallback((code: string) => {
    setCurrencies((prev) => {
      const entry = prev[code];
      if (entry) setInfo({ code: entry.code, symbol: entry.symbol, decimals: entry.decimals });
      return prev;
    });
    setDefaultCode(code);
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
    } catch { /* ignore */ }
  }, []);

  const value = useMemo(
    () => ({ ...info, ready, currencies, defaultCode, fmt, fmtCurrency, setDefaultCurrency }),
    [info, ready, currencies, defaultCode, fmt, fmtCurrency, setDefaultCurrency],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrency(): CurrencyCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
  return ctx;
}
