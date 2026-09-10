/**
 * Broadcast visibility — pure rules shared by the public banner API, the admin
 * history and the tests.
 *
 * Broadcasts live in the `Broadcast` table (title/message/audience). Lifecycle
 * data that the table has no columns for — deactivation, explicit expiry and
 * multi-user target lists — is kept in the Setting `broadcast.meta` keyed by
 * broadcast id, so no migration is needed:
 *
 *   { "<id>": { active?: false, expiresAt?: "2026-09-12T10:00:00Z", userIds?: ["cu_…"] } }
 */

export type BroadcastAudience = "ALL" | "ACTIVE" | "USER" | "USER_IDS";

export type BroadcastMetaEntry = {
  /** false = hidden from the banner without destroying the history entry. */
  active?: boolean;
  /** ISO timestamp; overrides the default TTL when set. */
  expiresAt?: string | null;
  /** Target list for audience "USER_IDS". */
  userIds?: string[];
};

export type BroadcastMeta = Record<string, BroadcastMetaEntry>;

export type BroadcastRow = {
  id: string;
  targetType: string;
  userId?: string | null;
  createdAt: Date | string;
};

/** Legacy rows use "USER"; the compose form now writes "USER_IDS". */
export function broadcastAudience(targetType: string): BroadcastAudience {
  const t = (targetType ?? "").toUpperCase();
  if (t === "ACTIVE") return "ACTIVE";
  if (t === "USER" || t === "USER_IDS") return "USER_IDS";
  return "ALL";
}

/** Effective expiry for a broadcast: explicit meta → default TTL → never. */
export function broadcastExpiresAt(
  b: BroadcastRow,
  meta: BroadcastMeta,
  ttlHours: number,
): Date | null {
  const explicit = meta[b.id]?.expiresAt;
  if (explicit) {
    const d = new Date(explicit);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (ttlHours > 0) {
    const created = new Date(b.createdAt);
    if (!Number.isNaN(created.getTime())) return new Date(created.getTime() + ttlHours * 3600_000);
  }
  return null;
}

export type BroadcastViewer = { id: string } | null | undefined;

/** Should this broadcast be shown to this viewer right now? */
export function isBroadcastLive(
  b: BroadcastRow,
  meta: BroadcastMeta,
  opts: { ttlHours: number; viewer?: BroadcastViewer; now?: Date },
): boolean {
  const entry = meta[b.id] ?? {};
  if (entry.active === false) return false;
  const now = opts.now ?? new Date();
  const expires = broadcastExpiresAt(b, meta, opts.ttlHours);
  if (expires && expires.getTime() <= now.getTime()) return false;

  switch (broadcastAudience(b.targetType)) {
    case "ALL":
      return true;
    case "ACTIVE":
      // "Active users" for a banner = signed-in visitors.
      return !!opts.viewer?.id;
    case "USER_IDS": {
      const viewer = opts.viewer?.id;
      if (!viewer) return false;
      const ids = entry.userIds ?? (b.userId ? [b.userId] : []);
      return ids.includes(viewer);
    }
    default:
      return false;
  }
}

export type BroadcastStatus = "live" | "expired" | "deactivated";

/** Admin-facing status for the history table. */
export function broadcastStatus(
  b: BroadcastRow,
  meta: BroadcastMeta,
  ttlHours: number,
  now: Date = new Date(),
): BroadcastStatus {
  if (meta[b.id]?.active === false) return "deactivated";
  const expires = broadcastExpiresAt(b, meta, ttlHours);
  if (expires && expires.getTime() <= now.getTime()) return "expired";
  return "live";
}

/** Human label for the audience chip. */
export function audienceLabel(b: BroadcastRow, meta: BroadcastMeta): string {
  switch (broadcastAudience(b.targetType)) {
    case "ALL":
      return "All visitors";
    case "ACTIVE":
      return "Signed-in users";
    case "USER_IDS": {
      const n = (meta[b.id]?.userIds ?? (b.userId ? [b.userId] : [])).length;
      return n === 1 ? "1 user" : `${n} users`;
    }
    default:
      return "All visitors";
  }
}
