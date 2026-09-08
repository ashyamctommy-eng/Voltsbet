"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client";
import { IconFootball } from "@/components/icons";

/**
 * Floating admin alert — real manual fixtures stuck LIVE (no externalId,
 * started hours ago) that the sweep cannot auto-resolve (they carry bet
 * history or admin markets). Nudges the admin to finish them via Admin →
 * Games instead of leaving them frozen on the Live tab.
 *
 * Shown only to staff with the games resource (guard on the endpoint).
 */
export default function ManualLiveAlertFab() {
  const [stuck, setStuck] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await apiFetch<{ stuckManual: number }>("/api/admin/live-alerts");
      if (!alive) return;
      setStuck(r.ok ? r.data.stuckManual : null);
    };
    void load();
    const t = setInterval(load, 2 * 60_000); // gentle poll while the panel is open
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!stuck || stuck <= 0) return null;

  return (
    <Link
      href="/admin/games"
      className="fixed bottom-5 right-5 z-[60] flex max-w-[calc(100vw-2.5rem)] items-center gap-2.5 rounded-full border border-amber-500/40 bg-amber-500/15 py-2 pl-3 pr-4 text-xs font-bold text-amber-600 shadow-2xl backdrop-blur transition-colors hover:bg-amber-500/25 dark:text-amber-300"
    >
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-amber-500 text-white">
        <IconFootball className="h-3.5 w-3.5" />
      </span>
      <span className="truncate">
        {stuck} manual live game{stuck > 1 ? "s" : ""} need{stuck === 1 ? "s" : ""} finishing
      </span>
      <span className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide">
        Finish
      </span>
    </Link>
  );
}
