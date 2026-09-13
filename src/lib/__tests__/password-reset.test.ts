import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Reset-over-Telegram rules that matter: never act on a suspended account,
 * never touch anything when the code is wrong, and revoke EVERY session on
 * success (a reset is the "I think I'm compromised" path).
 */
const findFirst = vi.fn();
const userUpdate = vi.fn();
const sessionDelete = vi.fn();
const notificationCreate = vi.fn();
const issueOtp = vi.fn();
const verifyOtp = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: (...a: unknown[]) => findFirst(...a), update: (...a: unknown[]) => userUpdate(...a) },
    session: { deleteMany: (...a: unknown[]) => sessionDelete(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
  },
}));
vi.mock("@/lib/telegram", () => ({
  issueTelegramOtp: (...a: unknown[]) => issueOtp(...a),
  verifyTelegramOtp: (...a: unknown[]) => verifyOtp(...a),
}));
vi.mock("@/lib/auth", () => ({ hashPassword: async (p: string) => `hashed:${p}` }));

const { requestReset, completeReset } = await import("@/lib/password-reset");

const ACTIVE_LINKED = { id: "u1", telegramChatId: "12345", status: "ACTIVE" };

beforeEach(() => {
  findFirst.mockReset();
  userUpdate.mockReset().mockResolvedValue({});
  sessionDelete.mockReset().mockResolvedValue({ count: 3 });
  notificationCreate.mockReset().mockResolvedValue({});
  issueOtp.mockReset().mockResolvedValue({ sent: true, expiresAt: new Date() });
  verifyOtp.mockReset();
});

describe("requestReset", () => {
  it("sends a code to a linked, active account", async () => {
    findFirst.mockResolvedValue(ACTIVE_LINKED);
    expect(await requestReset("jane@example.com")).toEqual({ sent: true });
    expect(issueOtp).toHaveBeenCalledWith("u1", "PASSWORD_RESET");
  });

  it("reports no-account without sending anything", async () => {
    findFirst.mockResolvedValue(null);
    expect(await requestReset("nobody@example.com")).toEqual({ sent: false, reason: "NO_ACCOUNT" });
    expect(issueOtp).not.toHaveBeenCalled();
  });

  it("will not serve an account without Telegram linked", async () => {
    findFirst.mockResolvedValue({ ...ACTIVE_LINKED, telegramChatId: null });
    expect(await requestReset("jane@example.com")).toEqual({ sent: false, reason: "NO_TELEGRAM" });
    expect(issueOtp).not.toHaveBeenCalled();
  });

  it("will not serve a suspended account", async () => {
    findFirst.mockResolvedValue({ ...ACTIVE_LINKED, status: "SUSPENDED" });
    expect(await requestReset("jane@example.com")).toEqual({ sent: false, reason: "BLOCKED" });
    expect(issueOtp).not.toHaveBeenCalled();
  });
});

describe("completeReset", () => {
  it("changes nothing when the code is wrong", async () => {
    findFirst.mockResolvedValue(ACTIVE_LINKED);
    verifyOtp.mockResolvedValue(false);
    expect(await completeReset("jane@example.com", "000000", "brandnew1")).toEqual({ ok: false, reason: "BAD_CODE" });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(sessionDelete).not.toHaveBeenCalled();
  });

  it("sets the new hash and revokes EVERY session on success", async () => {
    findFirst.mockResolvedValue(ACTIVE_LINKED);
    verifyOtp.mockResolvedValue(true);
    expect(await completeReset("jane@example.com", "123456", "brandnew1")).toEqual({ ok: true });
    expect(userUpdate.mock.calls[0][0].data.passwordHash).toBe("hashed:brandnew1");
    // unlike a password CHANGE, a reset signs out the initiating device too
    expect(sessionDelete.mock.calls[0][0].where).toEqual({ userId: "u1" });
    expect(notificationCreate).toHaveBeenCalled();
  });

  it("refuses a suspended account even with a valid code", async () => {
    findFirst.mockResolvedValue({ ...ACTIVE_LINKED, status: "SUSPENDED" });
    expect(await completeReset("jane@example.com", "123456", "brandnew1")).toEqual({ ok: false, reason: "BLOCKED" });
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
