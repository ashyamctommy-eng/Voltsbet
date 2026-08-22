"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";

export type SlipItem = {
  outcomeId: string;
  gameId: string;
  sport: string;
  competition: string;
  home: string;
  away: string;
  startAt: string;
  market: string;
  marketKey: string;
  outcome: string;
  label: string;
  odds: number;
  gameStatus: string;
  live?: boolean;
};

type BetSlipCtx = {
  items: SlipItem[];
  add: (item: SlipItem) => void;
  remove: (outcomeId: string) => void;
  clear: () => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  mode: "SINGLE" | "MULTIPLE";
  setMode: (m: "SINGLE" | "MULTIPLE") => void;
  stake: string;
  setStake: (s: string) => void;
  totalOdds: number;
  potentialWin: number;
  hasOddsChange: boolean;
};

const Ctx = createContext<BetSlipCtx | null>(null);
const LS_KEY = "vb_slip_v1";

export function BetSlipProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<SlipItem[]>([]);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"SINGLE" | "MULTIPLE">("SINGLE");
  const [stake, setStake] = useState("");
  const [hasOddsChange, setHasOddsChange] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as SlipItem[];
          if (Array.isArray(parsed)) setItems(parsed);
        }
      } catch {}
      loaded.current = true;
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (loaded.current) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(items)); } catch {}
    }
  }, [items]);

  // Auto-open the desktop rail when the first selection lands; on mobile the
  // floating mini-bar appears instead (the sheet only opens on explicit tap).
  useEffect(() => {
    if (items.length === 0 || open) return;
    if (typeof window === "undefined" || window.innerWidth < 1280) return;
    const t = setTimeout(() => setOpen(true), 0);
    return () => clearTimeout(t);
  }, [items.length, open]);

  const add = useCallback((item: SlipItem) => {
    setItems((prev) => {
      const exists = prev.find((p) => p.outcomeId === item.outcomeId);
      if (exists) {
        return prev.map((p) => (p.outcomeId === item.outcomeId ? { ...p, odds: item.odds } : p));
      }
      // One selection per market: outcomes of the same game + market are
      // mutually exclusive (1/X/2, Over/Under, BTTS Yes/No…), so picking a
      // new leg REPLACES the previous pick from that market instead of
      // stacking nonsensical combos (e.g. betting 1 AND X AND 2).
      const sameMarket = prev.some(
        (p) => p.gameId === item.gameId && p.marketKey === item.marketKey,
      );
      if (sameMarket) {
        return [...prev.filter((p) => !(p.gameId === item.gameId && p.marketKey === item.marketKey)), item];
      }
      return [...prev, item];
    });
    setHasOddsChange(false);
  }, []);

  const remove = useCallback((outcomeId: string) => {
    setItems((prev) => prev.filter((p) => p.outcomeId !== outcomeId));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setStake("");
    setHasOddsChange(false);
  }, []);

  const totalOdds = useMemo(() => {
    if (!items.length) return 0;
    if (mode === "SINGLE") return items[0]?.odds ?? 0;
    return Math.round(items.reduce((acc, it) => acc * it.odds, 1) * 100) / 100;
  }, [items, mode]);

  const potentialWin = useMemo(() => {
    const s = parseFloat(stake);
    if (!s || !isFinite(s) || s <= 0 || totalOdds <= 0) return 0;
    return Math.round(s * totalOdds * 100) / 100;
  }, [stake, totalOdds]);

  const value = useMemo(
    () => ({ items, add, remove, clear, open, setOpen, mode, setMode, stake, setStake, totalOdds, potentialWin, hasOddsChange }),
    [items, add, remove, clear, open, mode, stake, totalOdds, potentialWin, hasOddsChange]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBetSlip() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBetSlip must be used within BetSlipProvider");
  return ctx;
}

// ── Toasts ────────────────────────────────────────────────────
type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
const ToastCtx = createContext<{ push: (kind: Toast["kind"], text: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(1);

  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = idRef.current++;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-20 left-1/2 z-[100] flex w-[92vw] max-w-sm -translate-x-1/2 flex-col gap-2 xl:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-item pointer-events-auto rounded-xl border px-4 py-3 text-sm font-medium shadow-xl backdrop-blur ${
              t.kind === "success"
                ? "border-green-500/40 bg-[#0c2317]/95 text-green-300"
                : t.kind === "error"
                  ? "border-red-500/40 bg-[#2a0e12]/95 text-red-300"
                  : "border-blue-500/40 bg-[#0d1b33]/95 text-blue-200"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
