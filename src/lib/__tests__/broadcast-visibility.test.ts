import { describe, it, expect } from "vitest";
import {
  audienceLabel,
  broadcastAudience,
  broadcastExpiresAt,
  broadcastStatus,
  isBroadcastLive,
  type BroadcastRow,
} from "../broadcast-visibility";

const NOW = new Date("2026-09-10T12:00:00Z");
const row = (over: Partial<BroadcastRow> = {}): BroadcastRow => ({
  id: "b1",
  targetType: "ALL",
  userId: null,
  createdAt: "2026-09-10T09:00:00Z",
  ...over,
});

const opts = (over: Partial<{ ttlHours: number; viewer: { id: string } | null; now: Date }> = {}) => ({
  ttlHours: 72,
  viewer: null,
  now: NOW,
  ...over,
});

/**
 * The banner API and the admin history must agree on what is live. These rules
 * also explain the original complaint: broadcasts used to never expire and had
 * no off switch, so a "test" announcement stayed up forever.
 */
describe("broadcast audience", () => {
  it("maps legacy and new target types", () => {
    expect(broadcastAudience("ALL")).toBe("ALL");
    expect(broadcastAudience("ACTIVE")).toBe("ACTIVE");
    expect(broadcastAudience("USER")).toBe("USER_IDS");
    expect(broadcastAudience("USER_IDS")).toBe("USER_IDS");
    expect(broadcastAudience("")).toBe("ALL");
  });

  it("scopes targeted broadcasts to the listed users only", () => {
    const b = row({ targetType: "USER_IDS" });
    const meta = { b1: { userIds: ["u1", "u2"] } };
    expect(isBroadcastLive(b, meta, opts({ viewer: { id: "u1" } }))).toBe(true);
    expect(isBroadcastLive(b, meta, opts({ viewer: { id: "u3" } }))).toBe(false);
    expect(isBroadcastLive(b, meta, opts({ viewer: null }))).toBe(false);
  });

  it("keeps signed-in-only broadcasts off the login page", () => {
    const b = row({ targetType: "ACTIVE" });
    expect(isBroadcastLive(b, {}, opts({ viewer: null }))).toBe(false);
    expect(isBroadcastLive(b, {}, opts({ viewer: { id: "u1" } }))).toBe(true);
  });

  it("shows global broadcasts to everyone", () => {
    expect(isBroadcastLive(row(), {}, opts())).toBe(true);
    expect(isBroadcastLive(row(), {}, opts({ viewer: { id: "u1" } }))).toBe(true);
  });
});

describe("broadcast lifecycle", () => {
  it("hides a deactivated broadcast without losing the record", () => {
    const b = row();
    expect(isBroadcastLive(b, { b1: { active: false } }, opts())).toBe(false);
    expect(broadcastStatus(b, { b1: { active: false } }, 72, NOW)).toBe("deactivated");
  });

  it("applies the default TTL (72h) so test announcements age out", () => {
    const b = row({ createdAt: "2026-09-07T09:00:00Z" }); // 75h before NOW
    expect(broadcastExpiresAt(b, {}, 72)?.toISOString()).toBe("2026-09-10T09:00:00.000Z");
    expect(isBroadcastLive(b, {}, opts())).toBe(false);
    expect(broadcastStatus(b, {}, 72, NOW)).toBe("expired");
  });

  it("never expires when the TTL is 0", () => {
    const b = row({ createdAt: "2025-01-01T00:00:00Z" });
    expect(broadcastExpiresAt(b, {}, 0)).toBe(null);
    expect(isBroadcastLive(b, {}, opts({ ttlHours: 0 }))).toBe(true);
  });

  it("lets an explicit expiry override the TTL", () => {
    const b = row();
    const later = { b1: { expiresAt: "2026-09-10T13:00:00Z" } };
    const earlier = { b1: { expiresAt: "2026-09-10T11:00:00Z" } };
    expect(isBroadcastLive(b, later, opts())).toBe(true); // still inside
    expect(isBroadcastLive(b, earlier, opts())).toBe(false); // already past
  });

  it("labels the audience for the history table", () => {
    expect(audienceLabel(row(), {})).toBe("All visitors");
    expect(audienceLabel(row({ targetType: "ACTIVE" }), {})).toBe("Signed-in users");
    expect(audienceLabel(row({ targetType: "USER_IDS" }), { b1: { userIds: ["u1"] } })).toBe("1 user");
    expect(audienceLabel(row({ targetType: "USER_IDS" }), { b1: { userIds: ["u1", "u2"] } })).toBe("2 users");
    expect(audienceLabel(row({ targetType: "USER", userId: "u9" }), {})).toBe("1 user");
  });
});
