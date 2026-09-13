import { describe, expect, it, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";

/**
 * Path A password change. The rules worth pinning are the ones that cost money
 * or lock people out: proof of the CURRENT password, no silent no-op when the
 * new password equals the old, and the session revocation that is the actual
 * security benefit.
 *
 * Fixture hashes use bcrypt cost 4 (fast); the code under test still hashes the
 * NEW password at cost 12, exactly as production does.
 */
const OLD = "oldpassword1";
const RAW_TOKEN = "raw-session-token";

const findUnique = vi.fn();
const update = vi.fn();
const deleteMany = vi.fn();
let cookieValue: string | undefined = RAW_TOKEN;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => findUnique(...a), update: (...a: unknown[]) => update(...a) },
    session: { deleteMany: (...a: unknown[]) => deleteMany(...a) },
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue === undefined ? undefined : { value: cookieValue }) }),
}));

const { changePassword } = await import("@/lib/auth");

beforeEach(() => {
  cookieValue = RAW_TOKEN;
  findUnique.mockReset();
  update.mockReset().mockResolvedValue({});
  deleteMany.mockReset().mockResolvedValue({ count: 2 });
});

describe("changePassword", () => {
  it("rejects a wrong current password without touching anything", async () => {
    findUnique.mockResolvedValue({ passwordHash: await bcrypt.hash(OLD, 4) });
    const res = await changePassword({ userId: "u1", currentPassword: "wrong-one1", newPassword: "brandnew1" });
    expect(res).toEqual({ ok: false, reason: "BAD_CURRENT" });
    expect(update).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled(); // no revocation on a failed attempt
  });

  it("refuses to 'change' to the same password", async () => {
    findUnique.mockResolvedValue({ passwordHash: await bcrypt.hash(OLD, 4) });
    const res = await changePassword({ userId: "u1", currentPassword: OLD, newPassword: OLD });
    expect(res).toEqual({ ok: false, reason: "UNCHANGED" });
    expect(update).not.toHaveBeenCalled();
  });

  it("reports NOT_FOUND for a missing account", async () => {
    findUnique.mockResolvedValue(null);
    expect(await changePassword({ userId: "u1", currentPassword: OLD, newPassword: "brandnew1" }))
      .toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("stores a NEW hash and keeps the caller signed in", async () => {
    findUnique.mockResolvedValue({ passwordHash: await bcrypt.hash(OLD, 4) });
    const res = await changePassword({ userId: "u1", currentPassword: OLD, newPassword: "brandnew1" });
    expect(res).toEqual({ ok: true, revoked: 2 });

    const stored = update.mock.calls[0][0].data.passwordHash;
    expect(stored).not.toBe(await bcrypt.hash(OLD, 4));
    // the new password verifies against what was written, and the old one does not
    expect(await bcrypt.compare("brandnew1", stored)).toBe(true);
    expect(await bcrypt.compare(OLD, stored)).toBe(false);

    // every session EXCEPT the current one, matched hashed and raw
    const where = deleteMany.mock.calls[0][0].where;
    expect(where.userId).toBe("u1");
    expect(where.token.notIn).toHaveLength(2);
    expect(where.token.notIn).toContain(RAW_TOKEN);
  });

  it("revokes EVERY session when there is no cookie (never nothing)", async () => {
    cookieValue = undefined;
    findUnique.mockResolvedValue({ passwordHash: await bcrypt.hash(OLD, 4) });
    deleteMany.mockResolvedValue({ count: 5 });
    const res = await changePassword({ userId: "u1", currentPassword: OLD, newPassword: "brandnew1" });
    expect(res).toEqual({ ok: true, revoked: 5 });
    expect(deleteMany.mock.calls[0][0].where.token).toBeUndefined();
  });
});
