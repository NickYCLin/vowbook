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
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: mocks.locked }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import {
  mobileCreateBudgetItem,
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
});
