import { describe, it, expect, vi, beforeEach } from "vitest";
import { confirmDeposit, updateDepositStatus } from "@/lib/deposits";

/**
 * Deposit idempotency tests.
 *
 * `confirmDeposit` is the single credit path for every provider (NOWPayments
 * IPN, M-Pesa callback, demo webhook, admin override). Money safety depends
 * on three invariants:
 *
 *   1. A COMPLETED deposit is never credited twice (idempotent replay).
 *   2. When two confirmations race, exactly one credits — the loser either
 *      gets a clean "already completed" or a ALREADY_COMPLETED conflict.
 *   3. Non-credit status updates (UNDERPAID, CONFIRMING, FAILED, EXPIRED…)
 *      can never overwrite a COMPLETED deposit — the guard is
 *      `WHERE status != 'COMPLETED'`.
 */

type Deposit = {
  id: string;
  status: string;
  amount: string;
  provider: string | null;
  cryptoCurrency: string | null;
  currencyCode: string;
  metadata: string | null;
  txHash: string | null;
  userId: string;
  user: { id: string; wallet: { balance: string } };
};

function makeDeposit(overrides: Partial<Deposit> = {}): Deposit {
  return {
    id: "dep_1",
    status: "CONFIRMED",
    amount: "100",
    provider: "NOWPAYMENTS",
    cryptoCurrency: "USDT",
    currencyCode: "KES",
    metadata: JSON.stringify({ providerRef: "np_123" }),
    txHash: null,
    userId: "u_1",
    user: { id: "u_1", wallet: { balance: "500" } },
    ...overrides,
  };
}

// vi.mock factories are hoisted above imports, so all mock handles must live
// inside vi.hoisted() to be initialized before the mocked modules load.
const {
  creditWallet,
  awardReferralBonusIfFirstDeposit,
  depositFindUnique,
  depositUpdateMany,
  userUpdateMany,
  notificationCreate,
  prismaMock,
} = vi.hoisted(() => {
  const creditWallet = vi.fn(async () => ({ prev: 0, next: 100 }));
  const awardReferralBonusIfFirstDeposit = vi.fn(async () => null);
  const depositFindUnique = vi.fn();
  const depositUpdateMany = vi.fn();
  const userUpdateMany = vi.fn();
  const notificationCreate = vi.fn();

  const prismaMock: {
    deposit: { findUnique: typeof depositFindUnique; updateMany: typeof depositUpdateMany };
    user: { updateMany: typeof userUpdateMany };
    notification: { create: typeof notificationCreate };
    $transaction: ReturnType<typeof vi.fn>;
  } = {
    deposit: { findUnique: depositFindUnique, updateMany: depositUpdateMany },
    user: { updateMany: userUpdateMany },
    notification: { create: notificationCreate },
    $transaction: vi.fn(),
  };
  // The interactive-transaction runner passes itself through as the tx client.
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));

  return {
    creditWallet,
    awardReferralBonusIfFirstDeposit,
    depositFindUnique,
    depositUpdateMany,
    userUpdateMany,
    notificationCreate,
    prismaMock,
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/wallet", () => ({ creditWallet }));
vi.mock("@/lib/referral", () => ({ awardReferralBonusIfFirstDeposit }));
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
  return { ApiError };
});

beforeEach(() => {
  vi.clearAllMocks();
  depositUpdateMany.mockResolvedValue({ count: 1 });
  userUpdateMany.mockResolvedValue({ count: 1 });
  notificationCreate.mockResolvedValue({ id: "n_1" });
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
});

describe("confirmDeposit — idempotency", () => {
  it("replays safely on an already-COMPLETED deposit: no credit, no write", async () => {
    depositFindUnique.mockResolvedValue(makeDeposit({ status: "COMPLETED" }));

    const result = await confirmDeposit("dep_1", { txHash: "0xabc", providerRef: "np_123" });

    expect(result.alreadyCompleted).toBe(true);
    expect(depositUpdateMany).not.toHaveBeenCalled();
    expect(creditWallet).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("credits exactly once when a deposit completes", async () => {
    depositFindUnique.mockResolvedValue(makeDeposit({ status: "CONFIRMED" }));

    const result = await confirmDeposit("dep_1", { txHash: "0xabc", providerRef: "np_123" });

    expect(result.alreadyCompleted).toBe(false);
    expect(depositUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "dep_1", status: { in: expect.arrayContaining(["CONFIRMED"]) } },
        data: expect.objectContaining({ status: "COMPLETED", txHash: "0xabc" }),
      })
    );
    expect(creditWallet).toHaveBeenCalledTimes(1);
    expect(creditWallet).toHaveBeenCalledWith(
      prismaMock,
      "u_1",
      100,
      expect.objectContaining({ type: "DEPOSIT", reference: "dep_1" })
    );
  });

  it("loser of a concurrent race gets ALREADY_COMPLETED and never credits", async () => {
    // First read: creditable. Claim: lost (count 0). Fresh read: COMPLETED.
    depositFindUnique
      .mockResolvedValueOnce(makeDeposit({ status: "CONFIRMED" }))
      .mockResolvedValueOnce({ status: "COMPLETED" });
    depositUpdateMany.mockResolvedValue({ count: 0 });

    await expect(confirmDeposit("dep_1", { providerRef: "np_123" })).rejects.toMatchObject({
      code: "ALREADY_COMPLETED",
      status: 409,
    });
    expect(creditWallet).not.toHaveBeenCalled();
    expect(awardReferralBonusIfFirstDeposit).not.toHaveBeenCalled();
  });

  it("refuses to credit from a non-creditable status without admin override", async () => {
    depositFindUnique.mockResolvedValue(makeDeposit({ status: "EXPIRED" }));

    await expect(confirmDeposit("dep_1", { providerRef: "np_123" })).rejects.toMatchObject({
      code: "BAD_STATUS",
      status: 409,
    });
    expect(creditWallet).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("admin override may complete any non-COMPLETED deposit, still guarded against COMPLETED", async () => {
    depositFindUnique.mockResolvedValue(makeDeposit({ status: "FAILED" }));

    const result = await confirmDeposit("dep_1", { providerRef: "adm_1" }, true);

    expect(result.alreadyCompleted).toBe(false);
    expect(depositUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "dep_1", status: { not: "COMPLETED" } },
      })
    );
    expect(creditWallet).toHaveBeenCalledTimes(1);
  });

  it("stores depositAddress on metadata when provided (NOWPayments pay_address)", async () => {
    depositFindUnique.mockResolvedValue(makeDeposit({ status: "CONFIRMED" }));

    await confirmDeposit("dep_1", { depositAddress: "TXYZ123", txHash: "0xhash", providerRef: "np_9" });

    const [call] = depositUpdateMany.mock.calls;
    const data = call[0].data;
    expect(JSON.parse(data.metadata)).toMatchObject({
      providerRef: "np_9",
      depositAddress: "TXYZ123",
    });
  });
});

describe("updateDepositStatus — guard: WHERE status != 'COMPLETED'", () => {
  it("skips without writing when the deposit is already COMPLETED", async () => {
    depositFindUnique.mockResolvedValue(makeDeposit({ status: "COMPLETED" }));

    const result = await updateDepositStatus("dep_1", "FAILED");

    expect(result.skipped).toBe(true);
    expect(depositUpdateMany).not.toHaveBeenCalled();
  });

  it("applies non-credit transitions through a guarded updateMany", async () => {
    depositFindUnique.mockResolvedValue(makeDeposit({ status: "CONFIRMING" }));

    const result = await updateDepositStatus("dep_1", "UNDERPAID");

    expect(result.skipped).toBe(false);
    expect(depositUpdateMany).toHaveBeenCalledWith({
      where: { id: "dep_1", status: { not: "COMPLETED" } },
      data: { status: "UNDERPAID" },
    });
  });

  it("reports skipped when the guard rejects the claim (already moved)", async () => {
    depositFindUnique.mockResolvedValue(makeDeposit({ status: "AWAITING_PAYMENT" }));
    depositUpdateMany.mockResolvedValue({ count: 0 });

    const result = await updateDepositStatus("dep_1", "FAILED");

    expect(result.skipped).toBe(true);
  });
});
