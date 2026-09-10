/**
 * Broadcast lifecycle storage (deactivate / expiry / target lists) — kept in
 * the Setting `broadcast.meta` so no schema migration is required.
 */
import { prisma } from "./prisma";
import type { BroadcastMeta, BroadcastMetaEntry } from "./broadcast-visibility";

export const BROADCAST_META_KEY = "broadcast.meta";

export async function getBroadcastMeta(): Promise<BroadcastMeta> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: BROADCAST_META_KEY } });
    if (!row?.value) return {};
    const parsed: unknown = JSON.parse(row.value);
    return parsed && typeof parsed === "object" ? (parsed as BroadcastMeta) : {};
  } catch {
    return {};
  }
}

async function saveBroadcastMeta(meta: BroadcastMeta): Promise<void> {
  const value = JSON.stringify(meta);
  await prisma.setting.upsert({
    where: { key: BROADCAST_META_KEY },
    update: { value },
    create: { key: BROADCAST_META_KEY, value },
  });
}

/** Merge one broadcast's lifecycle entry. */
export async function setBroadcastMeta(id: string, patch: BroadcastMetaEntry): Promise<void> {
  const meta = await getBroadcastMeta();
  meta[id] = { ...(meta[id] ?? {}), ...patch };
  await saveBroadcastMeta(meta);
}

export async function removeBroadcastMeta(id: string): Promise<void> {
  const meta = await getBroadcastMeta();
  if (id in meta) {
    delete meta[id];
    await saveBroadcastMeta(meta);
  }
}

/** Default banner lifetime in hours (0 = never expires). */
export async function broadcastTtlHours(): Promise<number> {
  const n = Number(process.env.BROADCAST_TTL_HOURS);
  if (Number.isFinite(n) && n >= 0) return Math.round(n);
  const { getSettings } = await import("./settings");
  return (await getSettings()).broadcastTtlHours;
}
