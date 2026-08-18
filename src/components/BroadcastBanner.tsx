"use client";

import { useEffect, useState } from "react";
import { IconX, IconBell } from "@/components/icons";

type Broadcast = {
  id: string;
  title: string;
  message: string;
  targetType: string;
  createdAt: string;
};

const LS_KEY = "vb-dismissed-broadcasts";
const POLL_MS = 60_000;

function loadDismissed(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/**
 * Dismissible site-wide announcement banner. Polls /api/broadcasts every 60s
 * ("real-time enough" without a websocket); dismissals persist per-browser.
 */
export default function BroadcastBanner() {
  const [items, setItems] = useState<Broadcast[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(() => loadDismissed());

  useEffect(() => {
    let alive = true;
    const tick = () => {
      fetch("/api/broadcasts", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { data?: { broadcasts?: Broadcast[] } } | null) => {
          if (alive && data) setItems(data.data?.broadcasts ?? []);
        })
        .catch(() => {
          /* offline — keep whatever we have */
        });
    };
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* private mode — ignore */
    }
  };

  const visible = items.filter((b) => !dismissed.includes(b.id)).slice(0, 3);
  if (visible.length === 0) return null;

  return (
    <div className="relative z-[70] space-y-1.5 px-3 pt-1.5">
      {visible.map((b) => (
        <div
          key={b.id}
          className="mx-auto flex max-w-[1200px] items-start gap-3 rounded-xl border border-brand/25 bg-brand/10 px-4 py-2.5"
        >
          <IconBell className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">{b.title}</p>
            <p className="text-xs leading-relaxed text-ink2">{b.message}</p>
          </div>
          <button
            onClick={() => dismiss(b.id)}
            aria-label="Dismiss announcement"
            className="shrink-0 rounded-lg p-1 text-ink3 transition-colors hover:bg-white/10 hover:text-ink"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
