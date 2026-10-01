import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const {
  requireCurrentUser,
  requireWorkspaceAccess,
  requireLockedWorkspaceAccess,
  findFirst,
  updateMany,
  paymentCreate,
  paymentDeleteMany,
  paymentUpdateMany,
  paymentAggregate,
  transaction,
  revalidatePath,
} = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  requireLockedWorkspaceAccess: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  paymentCreate: vi.fn(),
  paymentDeleteMany: vi.fn(),
  paymentUpdateMany: vi.fn(),
  paymentAggregate: vi.fn(),
  transaction: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/workspace-mutation-access", () => ({
  requireLockedWorkspaceAccess,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    budgetItem: { findFirst, updateMany },
    budgetPayment: {
      create: paymentCreate,
      deleteMany: paymentDeleteMany,
      updateMany: paymentUpdateMany,
      aggregate: paymentAggregate,
    },
    $transaction: transaction,
  },
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  addBudgetPaymentAction,
  deleteBudgetPaymentAction,
  updateBudgetPaymentAction,
} from "./budget-items";

const idle = { status: "idle" as const };
const venue = {
  bookingStatus: "BOOKED_BALANCE_DUE",
  plannedAmount: 400000,
  depositAmount: 80000,
  balanceAmount: 300000,
  additionalAmount: 20000,
};

function paymentForm(fields: Record<string, string>) {
  const formData = new FormData();
  formData.set("expectedVersion", "4");
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUser.mockResolvedValue({ id: "session_user" });
  requireWorkspaceAccess.mockResolvedValue({ role: "PARTNER" });
  requireLockedWorkspaceAccess.mockResolvedValue({ role: "PARTNER" });
  transaction.mockImplementation((operation) =>
    operation({
      budgetItem: { findFirst, updateMany },
      budgetPayment: {
        create: paymentCreate,
        deleteMany: paymentDeleteMany,
        updateMany: paymentUpdateMany,
        aggregate: paymentAggregate,
      },
    }),
  );
  findFirst.mockResolvedValue(venue);
  updateMany.mockResolvedValue({ count: 1 });
  paymentCreate.mockResolvedValue({ id: "payment_1" });
  paymentDeleteMany.mockResolvedValue({ count: 1 });
  paymentUpdateMany.mockResolvedValue({ count: 1 });
  paymentAggregate.mockResolvedValue({ _sum: { amount: 100000 } });
});

describe("addBudgetPaymentAction", () => {
  it("在同一個鎖定交易裡記錄分批付款，實付變成訂金加已付", async () => {
    const result = await addBudgetPaymentAction(
      "workspace_1",
      "item_1",
      idle,
      paymentForm({
        amount: "50000",
        paidOn: "2026-10-05",
        method: "BANK_TRANSFER",
        notes: "第二筆",
      }),
    );

    expect(result).toEqual({ status: "success", message: "已記錄這筆付款。" });
    expect(requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
      expect.anything(),
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "item_1",
          workspaceId: "workspace_1",
          version: 4,
          kind: "EXPENSE",
          preparationStatus: "NEEDS_ACTION",
          bookingStatus: "BOOKED_BALANCE_DUE",
        },
      }),
    );
    expect(paymentCreate).toHaveBeenCalledWith({
      data: {
        amount: 50000,
        paidOn: new Date("2026-10-05T00:00:00.000Z"),
        method: "BANK_TRANSFER",
        notes: "第二筆",
        workspaceId: "workspace_1",
        budgetItemId: "item_1",
        createdByUserId: "session_user",
      },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "item_1", workspaceId: "workspace_1", version: 4 },
      data: { actualAmount: 230000, version: { increment: 1 } },
    });
  });

  it("尾款含加購都付清時自動轉成已付款", async () => {
    await addBudgetPaymentAction(
      "workspace_1",
      "item_1",
      idle,
      paymentForm({ amount: "220000", paidOn: "2026-10-05" }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "item_1", workspaceId: "workspace_1", version: 4 },
      data: expect.objectContaining({
        bookingStatus: "PAID",
        paid: true,
        actualAmount: 400000,
      }),
    });
  });

  it("不是尾款待付或版本過期時不寫入，回報需重新整理", async () => {
    findFirst.mockResolvedValue(null);
    const result = await addBudgetPaymentAction(
      "workspace_1",
      "item_1",
      idle,
      paymentForm({ amount: "1000", paidOn: "2026-10-05" }),
    );
    expect(result.code).toBe("STALE");
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("輸入無效時不開交易", async () => {
    const result = await addBudgetPaymentAction(
      "workspace_1",
      "item_1",
      idle,
      paymentForm({ amount: "0", paidOn: "2026-10-05" }),
    );
    expect(result).toMatchObject({
      status: "error",
      code: "VALIDATION",
      message: "付款金額請輸入大於 0 的整數。",
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("沒有編輯權限時拒絕", async () => {
    requireWorkspaceAccess.mockRejectedValue(
      new WorkspaceAccessDeniedError(),
    );
    const result = await addBudgetPaymentAction(
      "workspace_1",
      "item_1",
      idle,
      paymentForm({ amount: "1000", paidOn: "2026-10-05" }),
    );
    expect(result.code).toBe("FORBIDDEN");
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("deleteBudgetPaymentAction", () => {
  it("只刪同一個 workspace 與項目底下的付款，並重算實付", async () => {
    paymentAggregate.mockResolvedValue({ _sum: { amount: null } });
    const result = await deleteBudgetPaymentAction(
      "workspace_1",
      "item_1",
      "payment_1",
      idle,
      paymentForm({}),
    );
    expect(result.status).toBe("success");
    expect(paymentDeleteMany).toHaveBeenCalledWith({
      where: { id: "payment_1", workspaceId: "workspace_1", budgetItemId: "item_1" },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "item_1", workspaceId: "workspace_1", version: 4 },
      data: { actualAmount: 80000, version: { increment: 1 } },
    });
  });

  it("已付款的項目刪掉付款後不夠了，就退回尾款待付", async () => {
    findFirst.mockResolvedValue({ ...venue, bookingStatus: "PAID" });
    await deleteBudgetPaymentAction(
      "workspace_1",
      "item_1",
      "payment_1",
      idle,
      paymentForm({}),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "item_1", workspaceId: "workspace_1", version: 4 },
      data: {
        bookingStatus: "BOOKED_BALANCE_DUE",
        paid: false,
        paidAt: null,
        actualAmount: 180000,
        version: { increment: 1 },
      },
    });
  });

  it("找不到付款時不改項目", async () => {
    paymentDeleteMany.mockResolvedValue({ count: 0 });
    const result = await deleteBudgetPaymentAction(
      "workspace_1",
      "item_1",
      "payment_x",
      idle,
      paymentForm({}),
    );
    expect(result.code).toBe("STALE");
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("updateBudgetPaymentAction", () => {
  it("只改同一個 workspace 與項目底下的付款，並重算實付", async () => {
    paymentAggregate.mockResolvedValue({ _sum: { amount: 120000 } });
    const result = await updateBudgetPaymentAction(
      "workspace_1",
      "item_1",
      "payment_1",
      idle,
      paymentForm({
        amount: "120,000",
        paidOn: "2026-10-03",
        method: "",
        notes: "  改成匯款一筆  ",
      }),
    );
    expect(result).toEqual({ status: "success", message: "已更新這筆付款紀錄。" });
    expect(requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
      expect.anything(),
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "item_1",
          workspaceId: "workspace_1",
          version: 4,
          kind: "EXPENSE",
        },
      }),
    );
    expect(paymentUpdateMany).toHaveBeenCalledWith({
      where: { id: "payment_1", workspaceId: "workspace_1", budgetItemId: "item_1" },
      data: {
        amount: 120000,
        paidOn: new Date("2026-10-03T00:00:00.000Z"),
        method: null,
        notes: "改成匯款一筆",
      },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "item_1", workspaceId: "workspace_1", version: 4 },
      data: { actualAmount: 200000, version: { increment: 1 } },
    });
  });

  it("改完金額剛好付清就轉成已付款", async () => {
    paymentAggregate.mockResolvedValue({ _sum: { amount: 320000 } });
    await updateBudgetPaymentAction(
      "workspace_1",
      "item_1",
      "payment_1",
      idle,
      paymentForm({ amount: "320000", paidOn: "2026-10-03" }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bookingStatus: "PAID", paid: true }),
      }),
    );
  });

  it("已付款的項目把金額改少了，就退回尾款待付", async () => {
    findFirst.mockResolvedValue({ ...venue, bookingStatus: "PAID" });
    paymentAggregate.mockResolvedValue({ _sum: { amount: 100000 } });
    await updateBudgetPaymentAction(
      "workspace_1",
      "item_1",
      "payment_1",
      idle,
      paymentForm({ amount: "100000", paidOn: "2026-10-03" }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "item_1", workspaceId: "workspace_1", version: 4 },
      data: {
        bookingStatus: "BOOKED_BALANCE_DUE",
        paid: false,
        paidAt: null,
        actualAmount: 180000,
        version: { increment: 1 },
      },
    });
  });

  it("找不到付款或版本過期時不改項目", async () => {
    paymentUpdateMany.mockResolvedValue({ count: 0 });
    const result = await updateBudgetPaymentAction(
      "workspace_1",
      "item_1",
      "payment_x",
      idle,
      paymentForm({ amount: "1000", paidOn: "2026-10-03" }),
    );
    expect(result.code).toBe("STALE");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("輸入無效或沒有編輯權限時不開交易", async () => {
    const invalid = await updateBudgetPaymentAction(
      "workspace_1",
      "item_1",
      "payment_1",
      idle,
      paymentForm({ amount: "0", paidOn: "2026-10-03" }),
    );
    expect(invalid.status).toBe("error");
    requireWorkspaceAccess.mockRejectedValue(
      new WorkspaceAccessDeniedError(),
    );
    const denied = await updateBudgetPaymentAction(
      "workspace_1",
      "item_1",
      "payment_1",
      idle,
      paymentForm({ amount: "1000", paidOn: "2026-10-03" }),
    );
    expect(denied.status).toBe("error");
    expect(transaction).not.toHaveBeenCalled();
  });
});
