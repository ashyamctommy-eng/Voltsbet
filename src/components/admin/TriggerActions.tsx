"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";

const TASKS: { key: string; label: string; hint: string }[] = [
  { key: "live", label: "Live scores", hint: "Score/status sweep (2-min schedule)" },
  { key: "odds", label: "Sync odds", hint: "Pre-match odds + fixtures (12h schedule)" },
  { key: "settle", label: "Settle", hint: "Settle finished games (10-min schedule)" },
  { key: "purge", label: "Purge", hint: "Delete expired rows (daily schedule)" },
  { key: "calendar", label: "Calendar", hint: "Refresh 7-day fixtures (daily schedule)" },
];

/** One-click manual runs of the Trigger.dev background tasks.
 *  Requires TRIGGER_SECRET_KEY on the server; shows a clear error otherwise. */
export default function TriggerActions() {
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, label: string) {
    setBusy(key);
    const res = await apiFetch<{ runId: string; message: string }>("/api/admin/trigger-sync", {
      method: "POST",
      body: { task: key },
    });
    setBusy(null);
    if (!res.ok) return push("error", res.error.message);
    push("success", `${label}: ${res.data.message} (run ${res.data.runId.slice(0, 8)}…)`);
  }

  return (
    <div className="card p-4">
      <div className="text-xs font-black uppercase tracking-wider text-brand">Trigger.dev — run now</div>
      <p className="mt-1 text-[11px] text-ink3">
        Manual executions of the background tasks (they keep their schedules independently). Needs{" "}
        <code>TRIGGER_SECRET_KEY</code> on the server.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {TASKS.map((t) => (
          <button
            key={t.key}
            type="button"
            title={t.hint}
            disabled={busy !== null}
            onClick={() => run(t.key, t.label)}
            className="btn btn-ghost btn-sm"
          >
            {busy === t.key ? "Triggering…" : t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
