"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { apiFetch } from "@/lib/client";

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
  /** Transient odds-movement marker set by syncOdds() — drives the
   *  green/red flash on the slip. Cleared automatically after the flash. */
  trend?: "up" | "down" | null;
};

/** Wallet/auth snapshot shared by the slip, the floating bar and the
 *  deposit-redirect flow — ONE account fetch per session (lazy on mount). */
export type SlipAccountState = {
  /** Parsed /api/account payload for an authenticated user (null when guest). */
  account: { balance: number; currencyCode: string; minStake: number; maxStake: number; maxPayout: number } | null;
  /** true = signed in · false = guest · null = auth check still pending. */
  authed: boolean | null;
};

type BetSlipCtx = SlipAccountState & {
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
  /** Feed-driven price refresh: updates slip odds in place and flags the
   *  direction of any change so the slip can flash green (drifted up) or
   *  red (shortened). */
  syncOdds: (prices: Record<string, number>) => void;
};

const Ctx = createContext<BetSlipCtx | null>(null);
const LS_KEY = "vb_slip_v1";

export function BetSlipProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<SlipItem[]>([]);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"SINGLE" | "MULTIPLE">("SINGLE");
  const [stake, setStake] = useState("");
  const [hasOddsChange, setHasOddsChange] = useState(false);
  const [account, setAccount] = useState<SlipAccountState["account"]>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const loaded = useRef(false);
  const prevCountRef = useRef(0);
  /** Committed slip mirror for event handlers — add() reads it to decide
   *  replace-vs-append without stale closures. */
  const itemsRef = useRef<SlipItem[]>([]);
  const { push } = useToast();

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as SlipItem[];
          if (Array.isArray(parsed)) {
            setItems(parsed);
            if (parsed.length >= 2) setMode("MULTIPLE");
            prevCountRef.current = parsed.length;
          }
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

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Wallet/auth snapshot — currency drives EVERY money label on the slip +
  // floating bar (wallet currency, never the display currency) and the
  // deposit redirect branches guest vs logged-in.
  useEffect(() => {
    let alive = true;
    apiFetch<{
      wallet: { balance: number; currencyCode: string } | null;
      limits: { minStake: number; maxStake: number; maxPayout: number };
    }>("/api/account")
      .then((r) => {
        if (!alive) return;
        if (r.ok && r.data.wallet) {
          setAccount({
            balance: Number(r.data.wallet.balance) || 0,
            currencyCode: r.data.wallet.currencyCode,
            minStake: r.data.limits?.minStake ?? 50,
            maxStake: r.data.limits?.maxStake ?? 0,
            maxPayout: r.data.limits?.maxPayout ?? 0,
          });
          setAuthed(true);
        } else if (r.ok) {
          setAuthed(true); // signed in but wallet row missing
        } else {
          setAuthed(r.error?.code === "UNAUTHORIZED" ? false : null);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  // Auto-open the slip when the first selection lands (0 → 1). Desktop shows
  // the rail; mobile opens the sheet once so the user sees where their pick
  // went — later additions don't yank the sheet open again while browsing.
  const hadItemsRef = useRef(false);
  useEffect(() => {
    if (items.length === 0) {
      hadItemsRef.current = false;
      return;
    }
    const firstSelection = !hadItemsRef.current;
    hadItemsRef.current = true;
    if (!firstSelection || open) return;
    const t = setTimeout(() => setOpen(true), 0);
    return () => clearTimeout(t);
  }, [items.length, open]);

  // Default the betslip to Accumulator when a 2nd leg is added (one-way: a
  // manual "Singles" tap afterwards is respected; empty slip resets to
  // Singles). This is what makes multi-pick slips show ALL legs on mobile
  // instead of the first pick only — handled in add/remove/clear, not an effect.
  const add = useCallback((item: SlipItem) => {
    const prev = itemsRef.current;
    const exists = prev.find((p) => p.outcomeId === item.outcomeId);
    if (exists) {
      // Same outcome tapped again (e.g. after an odds refresh) → refresh its
      // price in place, never duplicate.
      setItems((cur) => cur.map((p) => (p.outcomeId === item.outcomeId ? { ...p, odds: item.odds } : p)));
      setHasOddsChange(false);
      return;
    }
    // Same-match rule (no Bet Builder support): a slip can hold at most ONE
    // leg per match. Markets of one game are mutually exclusive (1X2,
    // Over/Under, BTTS, HT result…), so picking any other market/outcome
    // from a game that already has a selection REPLACES the existing leg —
    // never stacks an impossible accumulator (the server would reject it).
    const previous = prev.find((p) => p.gameId === item.gameId);
    const next = [...prev.filter((p) => p.gameId !== item.gameId), item];
    if (next.length >= 2 && prev.length < 2) setMode("MULTIPLE");
    prevCountRef.current = next.length;
    setItems(next);
    setHasOddsChange(false);
    if (previous) {
      push(
        "info",
        `One selection per match — “${previous.outcome}” (${previous.market}) replaced with “${item.outcome}” (${item.market}).`,
      );
    }
  }, [push]);

  const remove = useCallback((outcomeId: string) => {
    const prev = itemsRef.current;
    const next = prev.filter((p) => p.outcomeId !== outcomeId);
    if (next.length === 0) {
      setMode("SINGLE");
      prevCountRef.current = 0;
    } else {
      prevCountRef.current = next.length;
    }
    setItems(next);
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setStake("");
    setHasOddsChange(false);
    setMode("SINGLE");
    prevCountRef.current = 0;
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

  const trendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncOdds = useCallback((prices: Record<string, number>) => {
    const prev = itemsRef.current;
    if (prev.length === 0) return;
    let moved = false;
    const next = prev.map((it) => {
      const price = prices[it.outcomeId];
      if (price == null || !(price > 0)) return it;
      if (Math.abs(price - it.odds) < 0.001) return it.trend ? { ...it, trend: it.trend } : it;
      moved = true;
      return { ...it, odds: price, trend: price > it.odds ? ("up" as const) : ("down" as const) };
    });
    if (!moved) return;
    setItems(next);
    // Flash window: clear the trend markers after the animation has played.
    if (trendTimer.current) clearTimeout(trendTimer.current);
    trendTimer.current = setTimeout(() => {
      setItems((cur) => cur.map((it) => (it.trend ? { ...it, trend: null } : it)));
    }, 2600);
  }, []);

  const value = useMemo(
    () => ({ items, add, remove, clear, open, setOpen, mode, setMode, stake, setStake, totalOdds, potentialWin, hasOddsChange, syncOdds, account, authed }),
    [items, add, remove, clear, open, mode, stake, totalOdds, potentialWin, hasOddsChange, syncOdds, account, authed]
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
