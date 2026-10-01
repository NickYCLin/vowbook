import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const mocks = vi.hoisted(() => ({
  locked: vi.fn(),
  transaction: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  executeRaw: vi.fn(),
  paymentCreate: vi.fn(),
  paymentDeleteMany: vi.fn(),
  paymentAggregate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: mocks.locked }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import {
  mobileAddBudgetPayment,
  mobileCreateBudgetItem,
  mobileDeleteBudgetPayment,
  mobileDeleteBudgetItem,
  mobileSetBudgetBookingStatus,
  mobileSetBudgetPreparationStatus,
  mobileUpdateBudgetItem,
} from "./budget-items";

const client = {
  $executeRaw: mocks.executeRaw,
  budgetItem: {
    findFirst: mocks.findFirst,
    create: mocks.create,
    updateMany: mocks.updateMany,
    deleteMany: mocks.deleteMany,
  },
  budgetPayment: {
    create: mocks.paymentCreate,
    deleteMany: mocks.paymentDeleteMany,
    aggregate: mocks.paymentAggregate,
  },
};
const form = {
  name: " 新秘 ",
  depositAmount: 5000,
  balanceAmount: "15000",
  additionalAmount: null,
  dueDate: "2026-11-01",
  notes: "",
  confirmedVendor: "小安",
  vendorContact: "",
  balancePaymentMethod: "RED_ENVELOPE",
};

describe("手機改花費", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locked.mockResolvedValue("PARTNER");
    mocks.findFirst.mockResolvedValue({ id: "group_1" });
    mocks.create.mockResolvedValue({ id: "item_1", version: 0 });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.executeRaw.mockResolvedValue(1);
    mocks.paymentCreate.mockResolvedValue({});
    mocks.paymentDeleteMany.mockResolvedValue({ count: 1 });
    mocks.paymentAggregate.mockResolvedValue({ _sum: { amount: null } });
    mocks.transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(client));
  });

  it("新增掛在系統分類下，金額由訂金尾款加總，付款方式併成現金", async () => {
    await expect(mobileCreateBudgetItem("workspace_1", "user_1", { ...form, taxonomyItemKey: "ITEM_BRIDAL_STYLIST" }))
      .resolves.toEqual({ id: "item_1", name: "新秘", version: 0 });
    expect(mocks.locked).toHaveBeenCalledWith("workspace_1", "user_1", "edit", client);
    expect(mocks.findFirst.mock.calls[0][0].where).toMatchObject({
      workspaceId: "workspace_1",
      kind: "GROUP",
      systemTaxonomyKey: "ITEM_BRIDAL_STYLIST",
    });
    const data = mocks.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      workspaceId: "workspace_1",
      parentId: "group_1",
      kind: "EXPENSE",
      category: "ATTIRE_STYLING",
      plannedAmount: 20000,
      depositAmount: 5000,
      balanceAmount: 15000,
      additionalAmount: null,
      bookingStatus: "PLANNING",
      paid: false,
      balancePaymentMethod: "CASH",
    });
  });

  it("婚宴沒有這個分類就不能新增", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(mobileCreateBudgetItem("workspace_1", "user_1", { ...form, taxonomyItemKey: "ITEM_ENGAGEMENT_GROOM" }))
      .rejects.toMatchObject({ status: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("輸入錯誤不開交易", async () => {
    for (const bad of [
      { ...form, taxonomyItemKey: "NOPE" },
      { ...form, taxonomyItemKey: "ITEM_BRIDAL_STYLIST", name: " " },
      { ...form, taxonomyItemKey: "ITEM_BRIDAL_STYLIST", depositAmount: -1 },
      { ...form, taxonomyItemKey: "ITEM_BRIDAL_STYLIST", dueDate: "2026-02-30" },
    ]) {
      await expect(mobileCreateBudgetItem("workspace_1", "user_1", bad)).rejects.toMatchObject({ status: 400 });
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("修改保留網站才有的欄位，實付金額跟著付款狀態", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "item_1",
      bookingStatus: "BOOKED_BALANCE_DUE",
      category: "ATTIRE_STYLING",
      estimatedRange: "2-3 萬",
      candidateVendors: "A、B",
      primaryContact: "PARTNER_B",
    });
    await expect(mobileUpdateBudgetItem("workspace_1", "user_1", "item_1", { ...form, expectedVersion: 3 }))
      .resolves.toEqual({ id: "item_1", name: "新秘", version: 4 });
    const args = mocks.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: "item_1", workspaceId: "workspace_1", version: 3, kind: "EXPENSE" });
    expect(args.data).toMatchObject({
      category: "ATTIRE_STYLING",
      estimatedRange: "2-3 萬",
      candidateVendors: "A、B",
      primaryContact: "PARTNER_B",
      actualAmount: 5000,
    });
    mocks.paymentAggregate.mockResolvedValue({ _sum: { amount: 30000 } });
    await mobileUpdateBudgetItem("workspace_1", "user_1", "item_1", { ...form, expectedVersion: 3 });
    expect(mocks.updateMany.mock.calls[1][0].data.actualAmount).toBe(35000);
    expect(args.data).not.toHaveProperty("parentId");
    expect(args.data).not.toHaveProperty("bookingStatus");
  });

  it("版本不對回 409", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(mobileUpdateBudgetItem("workspace_1", "user_1", "item_1", { ...form, expectedVersion: 3 }))
      .rejects.toMatchObject({ status: 409 });
    mocks.executeRaw.mockResolvedValue(0);
    await expect(mobileSetBudgetBookingStatus("workspace_1", "user_1", "item_1", "PAID", 3))
      .rejects.toMatchObject({ status: 409 });
  });

  it("付款狀態只收三種值，空值不會被當成規劃中", async () => {
    await expect(mobileSetBudgetBookingStatus("workspace_1", "user_1", "item_1", "BOOKED_BALANCE_DUE", 1))
      .resolves.toEqual({ id: "item_1", bookingStatus: "BOOKED_BALANCE_DUE", version: 2 });
    for (const bad of ["", null, "paid", 1]) {
      await expect(mobileSetBudgetBookingStatus("workspace_1", "user_1", "item_1", bad, 1))
        .rejects.toMatchObject({ status: 400 });
    }
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
  });

  it("準備方式只改這一欄", async () => {
    await expect(mobileSetBudgetPreparationStatus("workspace_1", "user_1", "item_1", "NOT_PLANNED", 1))
      .resolves.toEqual({ id: "item_1", preparationStatus: "NOT_PLANNED", version: 2 });
    expect(mocks.updateMany.mock.calls[0][0].data).toEqual({ preparationStatus: "NOT_PLANNED", version: { increment: 1 } });
    await expect(mobileSetBudgetPreparationStatus("workspace_1", "user_1", "item_1", "MAYBE", 1))
      .rejects.toMatchObject({ status: 400 });
  });

  it("刪除不碰系統分類，有細項時說清楚", async () => {
    await expect(mobileDeleteBudgetItem("workspace_1", "user_1", "item_1", 2)).resolves.toEqual({ removed: true });
    expect(mocks.deleteMany.mock.calls[0][0].where).toEqual({
      id: "item_1", workspaceId: "workspace_1", version: 2, kind: "EXPENSE", systemTaxonomyKey: null,
    });
    mocks.deleteMany.mockRejectedValue({ code: "P2003" });
    await expect(mobileDeleteBudgetItem("workspace_1", "user_1", "item_1", 2))
      .rejects.toMatchObject({ status: 409, code: "IN_USE" });
  });

  it("沒有編輯權限回 403", async () => {
    mocks.locked.mockRejectedValue(new WorkspaceAccessDeniedError());
    await expect(mobileDeleteBudgetItem("workspace_1", "user_1", "item_1", 2)).rejects.toMatchObject({ status: 403 });
  });

  it("付款狀態改回尾款待付時，實付會算進已分批付款", async () => {
    await mobileSetBudgetBookingStatus("workspace_1", "user_1", "item_1", "BOOKED_BALANCE_DUE", 1);
    const sql = mocks.executeRaw.mock.calls[0][0];
    expect(sql.sql).toContain("budget_payments");
  });
});

describe("手機記尾款分批付款", () => {
  const venue = {
    bookingStatus: "BOOKED_BALANCE_DUE",
    plannedAmount: 400000,
    depositAmount: 80000,
    balanceAmount: 300000,
    additionalAmount: 20000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locked.mockResolvedValue("PARTNER");
    mocks.findFirst.mockResolvedValue(venue);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.paymentCreate.mockResolvedValue({});
    mocks.paymentDeleteMany.mockResolvedValue({ count: 1 });
    mocks.paymentAggregate.mockResolvedValue({ _sum: { amount: 100000 } });
    mocks.transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(client));
  });

  it("記錄人取自登入者，只能記在尾款待付的項目", async () => {
    await expect(mobileAddBudgetPayment("workspace_1", "user_1", "item_1", {
      amount: 50000, paidOn: "2026-10-01", method: "BANK_TRANSFER", notes: " 先匯一半 ", expectedVersion: 4,
    })).resolves.toEqual({ id: "item_1", version: 5 });
    expect(mocks.locked).toHaveBeenCalledWith("workspace_1", "user_1", "edit", client);
    expect(mocks.findFirst.mock.calls[0][0].where).toMatchObject({
      id: "item_1", workspaceId: "workspace_1", version: 4, bookingStatus: "BOOKED_BALANCE_DUE",
    });
    expect(mocks.paymentCreate.mock.calls[0][0].data).toMatchObject({
      amount: 50000, method: "BANK_TRANSFER", notes: "先匯一半",
      workspaceId: "workspace_1", budgetItemId: "item_1", createdByUserId: "user_1",
    });
    expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({ actualAmount: 230000 });
  });

  it("尾款加加購付清就自動轉成已付款", async () => {
    mocks.paymentAggregate.mockResolvedValue({ _sum: { amount: 200000 } });
    await mobileAddBudgetPayment("workspace_1", "user_1", "item_1", {
      amount: 120000, paidOn: "2026-10-05", expectedVersion: 4,
    });
    expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({ bookingStatus: "PAID", paid: true, actualAmount: 400000 });
  });

  it("不收身分欄位，金額與日期不對就不開交易", async () => {
    for (const body of [
      { amount: 1, paidOn: "2026-10-01", expectedVersion: 1, createdByUserId: "x" },
      { amount: 0, paidOn: "2026-10-01", expectedVersion: 1 },
      { amount: -5, paidOn: "2026-10-01", expectedVersion: 1 },
      { amount: 1.5, paidOn: "2026-10-01", expectedVersion: 1 },
      { amount: 1, paidOn: "2026-02-30", expectedVersion: 1 },
      { amount: 1, paidOn: "2026-10-01", method: "CRYPTO", expectedVersion: 1 },
    ]) {
      await expect(mobileAddBudgetPayment("workspace_1", "user_1", "item_1", body)).rejects.toMatchObject({ status: 400 });
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("版本過期或項目已付清回 409", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(mobileAddBudgetPayment("workspace_1", "user_1", "item_1", {
      amount: 1, paidOn: "2026-10-01", expectedVersion: 4,
    })).rejects.toMatchObject({ status: 409 });
    expect(mocks.paymentCreate).not.toHaveBeenCalled();
  });

  it("刪掉付款後又不夠就退回尾款待付，付款不屬於這個項目回 409", async () => {
    mocks.findFirst.mockResolvedValue({ ...venue, bookingStatus: "PAID" });
    await expect(mobileDeleteBudgetPayment("workspace_1", "user_1", "item_1", "pay_1", 6))
      .resolves.toEqual({ id: "item_1", version: 7 });
    expect(mocks.paymentDeleteMany.mock.calls[0][0].where).toEqual({ id: "pay_1", workspaceId: "workspace_1", budgetItemId: "item_1" });
    expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({ bookingStatus: "BOOKED_BALANCE_DUE", paid: false, actualAmount: 180000 });
    mocks.paymentDeleteMany.mockResolvedValue({ count: 0 });
    await expect(mobileDeleteBudgetPayment("workspace_1", "user_1", "item_1", "pay_x", 6))
      .rejects.toMatchObject({ status: 409 });
  });

  it("沒有編輯權限回 403", async () => {
    mocks.locked.mockRejectedValue(new WorkspaceAccessDeniedError());
    await expect(mobileDeleteBudgetPayment("workspace_1", "user_1", "item_1", "pay_1", 6)).rejects.toMatchObject({ status: 403 });
    expect(mocks.paymentDeleteMany).not.toHaveBeenCalled();
  });
});
