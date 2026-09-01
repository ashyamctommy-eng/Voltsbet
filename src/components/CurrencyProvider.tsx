"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { formatCurrency as intlFormatCurrency } from "@/lib/currency-format";

export type CurrencyInfo = {
  code: string; // ISO code, e.g. "KES"
  symbol: string; // display symbol, e.g. "KSh"
  decimals: number;
};

export type CurrencyEntry = CurrencyInfo & { rate: number };

type ResolutionSource = "force-default" | "user-preference" | "ip" | "fallback-usd";

type CurrencyCtx = CurrencyInfo & {
  ready: boolean;
  /** How the active currency was resolved this session. */
  source: ResolutionSource | null;
  /** All active currencies with live rates (from /api/public/currencies). */
  currencies: Record<string, CurrencyEntry>;
  /** Platform-wide default operating currency code. */
  defaultCode: string;
  /** Intl formatter bound to the active currency (see lib/currency-format). */
  formatCurrency: (amount: number, currencyCode?: string) => string;
  /** Format an amount with the platform's default currency code, e.g.
   *  fmt(3.05) → "KES 3.05" (Intl). */
  fmt: (amount: number, opts?: { maximumFractionDigits?: number }) => string;
  /**
   * Convert `amount` (denominated in currency `from`) to currency `to` using
   * live DB rates. Returns the amount unchanged when rates are unknown
   * (e.g. IP-detected codes not in the currency table).
   */
  convertAmount: (amount: number, from: string, to: string) => number;
  /** Override the active currency app-wide (persists to localStorage). */
  setDefaultCurrency: (code: string) => void;
};

const FALLBACK: CurrencyInfo = { code: "KES", symbol: "KSh", decimals: 2 };
const STORAGE_KEY = "vb.currency";
const Ctx = createContext<CurrencyCtx | null>(null);

/**
 * Platform-wide operating currency.
 *
 * Resolution priority (server endpoint /api/public/currency-resolution):
 *   1. admin forceDefaultCurrency  → settings.currencyDefault
 *   2. signed-in user preference   → displayCurrencyCode
 *   3. IP auto-detect              → ipapi.co (RON, SRD, USD…), fallback USD
 *
 * A manual admin pick (localStorage `vb.currency`) only overrides the
 * IP/fallback branches — it never beats force-default or a user preference.
 */
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<CurrencyInfo>(FALLBACK);
  const [currencies, setCurrencies] = useState<Record<string, CurrencyEntry>>({});
  const [defaultCode, setDefaultCode] = useState<string>("KES");
  const [source, setSource] = useState<ResolutionSource | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/public/currencies", { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      ),
      fetch("/api/public/currency-resolution", { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      ),
    ])
      .then(([d, res]) => {
        if (!alive) return;
        const list = (d as { currencies?: CurrencyEntry[] }).currencies ?? [];
        const map = Object.fromEntries(list.map((c) => [c.code, c]));
        setCurrencies(map);
        const serverDefault = (d as { defaultCode?: string }).defaultCode ?? (list[0]?.code ?? "KES");
        setDefaultCode(serverDefault);

        // Resolve the active currency from the server's verdict.
        let code = (res as { code?: string }).code ?? serverDefault;
        const resSource = (res as { source?: ResolutionSource }).source ?? "fallback-usd";
        setSource(resSource);
        // A manual admin pick overrides only the non-authoritative branches
        // (IP auto-detect / USD fallback) — never force-default or user pref.
        if (resSource === "ip" || resSource === "fallback-usd") {
          try {
            const stored = window.localStorage.getItem(STORAGE_KEY);
            if (stored && /^[A-Z]{3}$/.test(stored)) code = stored;
          } catch { /* ignore */ }
        }
        const found = map[code];
        setInfo(found
          ? { code: found.code, symbol: found.symbol, decimals: found.decimals }
          : { code, symbol: code, decimals: 2 });
        setReady(true);
      })
      .catch(() => {
        if (alive) setReady(true); // fallback: KES
      });
    return () => {
      alive = false;
    };
  }, []);

  const convertAmount = useCallback(
    (amount: number, from: string, to: string) => {
      const n = Number(amount);
      if (!isFinite(n) || from === to) return n;
      const f = currencies[from];
      const t = currencies[to];
      if (!f || !t || f.rate <= 0 || t.rate <= 0) return n; // unknown rates → unchanged
      return (n * f.rate) / t.rate;
    },
    [currencies],
  );

  const formatCurrency = useCallback(
    (amount: number, currencyCode?: string) => intlFormatCurrency(amount, currencyCode ?? info.code),
    [info.code],
  );

  const fmt = useCallback(
    (amount: number, opts?: { maximumFractionDigits?: number }) => {
      const n = Number(amount);
      if (!isFinite(n)) return `${info.code} 0`;
      try {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: info.code,
          minimumFractionDigits: Math.min(2, opts?.maximumFractionDigits ?? info.decimals),
          maximumFractionDigits: opts?.maximumFractionDigits ?? info.decimals,
        }).format(n);
      } catch {
        return `${info.code} ${n.toFixed(2)}`;
      }
    },
    [info.code, info.decimals],
  );

  const setDefaultCurrency = useCallback((code: string) => {
    setCurrencies((prev) => {
      const entry = prev[code];
      if (entry) setInfo({ code: entry.code, symbol: entry.symbol, decimals: entry.decimals });
      else setInfo({ code, symbol: code, decimals: 2 });
      return prev;
    });
    setDefaultCode(code);
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
    } catch { /* ignore */ }
  }, []);

  const value = useMemo(
    () => ({ ...info, ready, source, currencies, defaultCode, formatCurrency, fmt, convertAmount, setDefaultCurrency }),
    [info, ready, source, currencies, defaultCode, formatCurrency, fmt, convertAmount, setDefaultCurrency],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrency(): CurrencyCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
  return ctx;
}
