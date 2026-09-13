"use client";

/**
 * "Fixtures for sports you don't offer" — a dry-run-first cleanup.
 *
 * Renders a PREVIEW (count by sport + a sample + how many rows are protected by
 * existing bets) and only then offers a two-step confirm. Deliberately never
 * auto-runs the delete: this removes inventory, and the operator should see the
 * number before it happens.
 *
 * The card hides itself entirely when there is nothing to report, so it doesn't
 * add noise to a healthy install.
 */

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";

type Plan = {
  offeredSports: { slug: string; name: string; games: number }[];
  counts: { slug: string; name: string; games: number }[];
  total: number;
  protectedCount: number;
  sample: { home: string; away: string; sport: string; startAt: string }[];
  refused: { reason: string } | null;
};

export default function UnofferedFixturesCard({ onPurged }: { onPurged?: () => void }) {
  const { push } = useToast();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<Plan>("/api/admin/games/purge-unoffered");
    if (res.ok) setPlan(res.data);
  }, []);

  // Fetch on mount the same way the other admin pages do (a promise callback,
  // not a synchronous setState inside the effect).
  useEffect(() => {
    apiFetch<Plan>("/api/admin/games/purge-unoffered").then((res) => {
      if (res.ok) setPlan(res.data);
    });
  }, []);

  async function purge() {
    setBusy(true);
    const res = await apiFetch<{ deleted: number; message: string }>(
      "/api/admin/games/purge-unoffered",
      { method: "POST", body: { confirm: "PURGE" } },
    );
    setBusy(false);
    setConfirming(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", res.data.message);
    await load();
    onPurged?.();
  }

  if (!plan) return null;

  if (plan.refused) {
    return (
      <div className="card border-warn/40 p-4">
        <h3 className="text-sm font-bold">Unoffered fixtures</h3>
        <p className="mt-1 text-[11px] text-ink3">{plan.refused.reason}</p>
      </div>
    );
  }

  if (plan.total === 0) return null;

  return (
    <div className="card border-warn/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold">Fixtures for sports you don&apos;t offer</h3>
        <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-black tabular-nums text-warn">
          {plan.total}
        </span>
        <span className="ml-auto text-[10.5px] text-ink3">
          offered: {plan.offeredSports.map((o) => `${o.name} (${o.games})`).join(" · ") || "—"}
        </span>
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-ink3">
        Upcoming <b className="text-ink2">API-sourced</b> fixtures whose sport isn&apos;t in your League
        Sync whitelist — leftover from a sync that ran in catalog mode. Their prices will never refresh
        again, so they can only be bet at stale odds. The daily purge job keeps nothing here: it deletes
        fixtures that already <i>started</i>, and these are all in the future.
      </p>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {plan.counts.map((c) => (
          <span
            key={c.slug}
            className="rounded-full border border-line bg-card2 px-2 py-0.5 text-[10.5px] font-bold text-ink2"
          >
            {c.name} <span className="tabular-nums text-ink3">×{c.games}</span>
          </span>
        ))}
      </div>

      {plan.sample.length > 0 && (
        <ul className="mt-2.5 space-y-0.5 font-mono text-[10.5px] text-ink3">
          {plan.sample.map((g, i) => (
            <li key={i}>
              {g.sport}: {g.home} v {g.away} · {g.startAt.slice(0, 16).replace("T", " ")}
            </li>
          ))}
          {plan.total > plan.sample.length && <li>… and {plan.total - plan.sample.length} more</li>}
        </ul>
      )}

      {plan.protectedCount > 0 && (
        <p className="mt-2 rounded-lg border border-line bg-card2/60 px-2.5 py-1.5 text-[11px] text-ink2">
          ⓘ <b>{plan.protectedCount}</b> can&apos;t be removed — a customer has a bet on them. Settle or void
          those first.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={purge}>
              {busy ? "Removing…" : `Yes, remove ${plan.total}`}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <span className="text-[10.5px] text-ink3">
              Deletes the fixtures and their markets. Not reversible.
            </span>
          </>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>
            Remove these {plan.total} fixtures
          </button>
        )}
      </div>
    </div>
  );
}
