"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { formatDateTime } from "@/lib/odds";

type Log = {
  id: string; adminName: string | null; action: string; entity: string;
  entityId: string | null; userId: string | null; ip: string | null;
  prevValue: string | null; newValue: string | null; createdAt: string;
};

export default function AdminAudit() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [entity, setEntity] = useState("");

  useEffect(() => {
    apiFetch<{ logs: Log[] }>(`/api/admin/audit${entity ? `?entity=${entity}` : ""}`).then((r) => r.ok && setLogs(r.data.logs));
  }, [entity]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Audit Logs</h2>
        <select className="input w-44" value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">All entities</option>
          {["GAME", "MARKET", "OUTCOME", "USER", "DEPOSIT", "WITHDRAWAL", "SPORT", "CURRENCY", "LANGUAGE", "PROMOTION", "TESTIMONIAL", "BANNER", "SETTINGS", "NOTIFICATION", "SYSTEM"].map((e) => (
            <option key={e}>{e}</option>
          ))}
        </select>
      </div>

      <div className="card divide-y divide-line">
        {logs.length === 0 && <div className="p-8 text-center text-sm text-ink3">No audit entries.</div>}
        {logs.map((l) => (
          <div key={l.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">{l.action}</span>
              <span className="font-semibold">{l.entity}{l.entityId ? ` #${l.entityId.slice(0, 8)}` : ""}</span>
              <span className="text-xs text-ink3">by {l.adminName ?? "system"}</span>
              <span className="ml-auto text-xs text-ink3">{formatDateTime(new Date(l.createdAt))}</span>
            </div>
            {(l.prevValue || l.newValue) && (
              <pre className="mt-2 overflow-x-auto rounded-lg bg-[#0a1120] p-2 text-[11px] text-ink2">
                {l.prevValue ? `prev: ${l.prevValue}\n` : ""}{l.newValue ? `new:  ${l.newValue}` : ""}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
