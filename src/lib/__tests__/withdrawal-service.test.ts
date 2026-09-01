import { describe, it, expect, vi, beforeEach } from "vitest";
import { approveWithdrawal, rejectWithdrawal } from "@/lib/withdrawal-service";
import { generateWithdrawalRef, isWithdrawalRef } from "@/lib/ref-code";

/**
 * Withdrawal admin-engine tests: atomic approval (no manual receipt needed),
 * exactly-once refunds on rejection, and the PLP-WDR reference generator.
 */

const {
  prismaMock,
  withdrawalFindUnique,
  withdrawalUpdateMany,
  notificationCreate,
  creditWallet,
  auditLog,
} = vi.hoisted(() => {
  const withdrawalFindUnique = vi.fn();
  const withdrawalUpdateMany = vi.fn();
  const notificationCreate = vi.fn();
  const creditWallet = vi.fn(async () => ({ prev: 100, next: 0 }));
  const auditLog = vi.fn(async () => undefined);

  const prismaMock: {
    withdrawal: { findUnique: typeof withdrawalFindUnique; updateMany: typeof withdrawalUpdateMany; update: ReturnType<typeof vi.fn> };
    notification: { create: typeof notificationCreate };
    $transaction: ReturnType<typeof vi.fn>;
  } = {
    withdrawal: { findUnique: withdrawalFindUnique, updateMany: withdrawalUpdateMany, update: vi.fn() },
    notification: { create: notificationCreate },
    $transaction: vi.fn(),
  };
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));

  return { prismaMock, withdrawalFindUnique, withdrawalUpdateMany, notificationCreate, creditWallet, auditLog };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/wallet", () => ({ creditWallet }));
vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, message: string, code = "ERROR") {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return { ApiError, auditLog };
});

type Withdrawal = {
  id: string;
  trackingId: string | null;
  userId: string;
  amount: string;
  currencyCode: string;
  method: string;
  status: string;
  metadata: string | null;
};

function makeWithdrawal(overrides: Partial<Withdrawal> = {}): Withdrawal {
  return {
    id: "wd_1",
    trackingId: "PLP-WDR-9X2K7L8P",
    userId: "u_1",
    amount: "5000",
    currencyCode: "KES",
    method: "MPESA",
    status: "PENDING",
    metadata: JSON.stringify({ reserved: true, reservedAt: "2026-09-01T00:00:00Z" }),
    ...overrides,
  };
}

const ACTOR = { id: "admin_1", username: "boss" };

beforeEach(() => {
  vi.clearAllMocks();
  withdrawalUpdateMany.mockResolvedValue({ count: 1 });
  notificationCreate.mockResolvedValue({ id: "n_1" });
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
});

describe("generateWithdrawalRef", () => {
  it("produces PLP-WDR-XXXXXXXX format", () => {
    for (let i = 0; i < 50; i++) {
      const ref = generateWithdrawalRef();
      expect(isWithdrawalRef(ref)).toBe(true);
    }
  });

  it("is collision-free over a large sample (crypto-random 8 chars)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const ref = generateWithdrawalRef();
      expect(seen.has(ref)).toBe(false);
      seen.add(ref);
    }
  });
});

describe("approveWithdrawal — atomic single-click approval", () => {
  it("completes PENDING → COMPLETED via a status-guarded claim, no receipt required", async () => {
    withdrawalFindUnique.mockResolvedValue(makeWithdrawal());

    const result = await approveWithdrawal(ACTOR, "wd_1");

    expect(result.status).toBe("COMPLETED");
    expect(withdrawalUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "wd_1", status: { in: expect.arrayContaining(["PENDING"]) } },
        data: expect.objectContaining({ status: "COMPLETED", processedAt: expect.any(Date) }),
      }),
    );
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ admin: ACTOR, entity: "WITHDRAWAL", entityId: "wd_1" }),
    );
  });

  it("refuses to touch a final-state withdrawal (LOCKED)", async () => {
    withdrawalFindUnique.mockResolvedValue(makeWithdrawal({ status: "REJECTED" }));

    await expect(approveWithdrawal(ACTOR, "wd_1")).rejects.toMatchObject({ code: "LOCKED", status: 409 });
    expect(withdrawalUpdateMany).not.toHaveBeenCalled();
  });

  it("loses the race → RACE conflict, no notification", async () => {
    withdrawalFindUnique.mockResolvedValue(makeWithdrawal());
    withdrawalUpdateMany.mockResolvedValue({ count: 0 });

    await expect(approveWithdrawal(ACTOR, "wd_1")).rejects.toMatchObject({ code: "RACE", status: 409 });
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});

describe("rejectWithdrawal — exactly-once refund", () => {
  it("rejects and refunds the reserved funds once (atomic claim + credit in one tx)", async () => {
    withdrawalFindUnique.mockResolvedValue(makeWithdrawal());

    const result = await rejectWithdrawal(ACTOR, "wd_1", "REJECTED");

    expect(result.status).toBe("REJECTED");
    expect(result.refunded).toBe(true);
    expect(withdrawalUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "wd_1", status: { in: expect.arrayContaining(["PENDING"]) } },
        data: expect.objectContaining({ status: "REJECTED" }),
      }),
    );
    expect(creditWallet).toHaveBeenCalledTimes(1);
    expect(creditWallet).toHaveBeenCalledWith(
      prismaMock,
      "u_1",
      5000,
      expect.objectContaining({ type: "WITHDRAWAL_REFUND", reference: "PLP-WDR-9X2K7L8P" }),
    );
  });

  it("never refunds twice (refunded flag guard)", async () => {
    withdrawalFindUnique.mockResolvedValue(
      makeWithdrawal({ metadata: JSON.stringify({ reserved: true, refunded: true }) }),
    );

    const result = await rejectWithdrawal(ACTOR, "wd_1", "REJECTED");

    expect(result.refunded).toBe(false);
    expect(creditWallet).not.toHaveBeenCalled();
  });

  it("a second rejection is LOCKED (final state) — no double refund possible", async () => {
    withdrawalFindUnique.mockResolvedValue(makeWithdrawal({ status: "REJECTED" }));

    await expect(rejectWithdrawal(ACTOR, "wd_1", "REJECTED")).rejects.toMatchObject({ code: "LOCKED", status: 409 });
    expect(creditWallet).not.toHaveBeenCalled();
  });

  it("supports CANCELLED with the same refund semantics", async () => {
    withdrawalFindUnique.mockResolvedValue(makeWithdrawal());

    const result = await rejectWithdrawal(ACTOR, "wd_1", "CANCELLED");

    expect(result.status).toBe("CANCELLED");
    expect(result.refunded).toBe(true);
    expect(creditWallet).toHaveBeenCalledTimes(1);
  });
});
