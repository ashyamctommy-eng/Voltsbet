/**
 * Tiny JSON-in-`Setting` store for the stats feed (no schema migration).
 *
 * Everything the feed needs to remember lives here:
 *   stats.list.<date>        cached /fixtures?date= payload (TTL — it carries live scores)
 *   stats.map.<gameId>       gameId → API-Football fixture id (write once, then reuse)
 *   stats.stats.<fixtureId>  finished-match statistics (immutable — cached forever)
 *   stats.lastPass / .lastPassAt  last settlement-pass summary + throttle marker
 */
import { prisma } from "@/lib/prisma";

export async function readSetting(key: string): Promise<string | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function writeSetting(key: string, value: string): Promise<void> {
  try {
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  } catch {
    /* never break a settlement path over telemetry */
  }
}

export async function readMany(keys: string[]): Promise<Map<string, string>> {
  if (!keys.length) return new Map();
  try {
    const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
    return new Map(rows.map((r) => [r.key, r.value]));
  } catch {
    return new Map();
  }
}

/** Stored JSON is wrapped as { v, at } so callers can reason about age. */
export async function readJson<T>(key: string): Promise<{ value: T | null; at: number | null }> {
  const raw = await readSetting(key);
  if (!raw) return { value: null, at: null };
  try {
    const parsed = JSON.parse(raw) as { v?: T; at?: number };
    return { value: (parsed.v ?? null) as T | null, at: parsed.at ?? null };
  } catch {
    return { value: null, at: null };
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  await writeSetting(key, JSON.stringify({ v: value, at: Date.now() }));
}

export function isStale(at: number | null, ttlSeconds: number): boolean {
  if (!at) return true;
  return Date.now() - at > ttlSeconds * 1000;
}

export const keys = {
  list: (date: string) => `stats.list.${date}`,
  map: (gameId: string) => `stats.map.${gameId}`,
  stats: (fixtureId: number | string) => `stats.stats.${fixtureId}`,
} as const;
