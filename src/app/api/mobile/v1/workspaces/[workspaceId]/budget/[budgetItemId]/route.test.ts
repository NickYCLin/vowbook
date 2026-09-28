import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  booking: vi.fn(),
  preparation: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/budget-items", async (original) => ({
  ...(await original<typeof import("@/lib/mobile/budget-items")>()),
  mobileSetBudgetBookingStatus: mocks.booking,
  mobileSetBudgetPreparationStatus: mocks.preparation,
  mobileUpdateBudgetItem: mocks.update,
  mobileDeleteBudgetItem: mocks.remove,
}));

import { DELETE, PATCH } from "./route";
import { MobileRequestError } from "@/lib/mobile/protocol";

const context = {
  params: Promise.resolve({ workspaceId: "workspace_1", budgetItemId: "item_1" }),
};
const send = (method: string, value: unknown) =>
  new Request("https://example.test", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
const payBody = { bookingStatus: "PAID", expectedVersion: 4 };

describe("手機花費 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
    mocks.booking.mockResolvedValue({ id: "item_1", bookingStatus: "PAID", version: 5 });
    mocks.preparation.mockResolvedValue({ id: "item_1", version: 5 });
    mocks.update.mockResolvedValue({ id: "item_1", version: 5 });
    mocks.remove.mockResolvedValue({ removed: true });
  });

  it("認證失敗時不寫入任何資料", async () => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "重新登入"));
    expect((await PATCH(send("PATCH", payBody), context)).status).toBe(401);
    expect(mocks.booking).not.toHaveBeenCalled();
  });

  it("舊版 App 的標記已付款照樣可用，身分只取自路徑與登入者", async () => {
    expect((await PATCH(send("PATCH", payBody), context)).status).toBe(200);
    expect(mocks.booking).toHaveBeenCalledWith("workspace_1", "server-user", "item_1", "PAID", 4);
  });

  it("一次只改一種，不收金額、付款時間或身分欄位", async () => {
    for (const body of [
      { ...payBody, actualAmount: 1 },
      { ...payBody, paidAt: "x" },
      { ...payBody, preparationStatus: "NOT_PLANNED" },
      { preparationStatus: "NOT_PLANNED", expectedVersion: 1, name: "x" },
      { name: "新秘", expectedVersion: 1, workspaceId: "x" },
      { name: "新秘", expectedVersion: 1, parentId: "x" },
      { expectedVersion: 1 },
      [],
    ]) {
      expect((await PATCH(send("PATCH", body), context)).status).toBe(400);
    }
    expect(mocks.booking).not.toHaveBeenCalled();
    expect(mocks.preparation).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("準備方式與內容各走各的", async () => {
    await PATCH(send("PATCH", { preparationStatus: "NOT_PLANNED", expectedVersion: 1 }), context);
    expect(mocks.preparation).toHaveBeenCalledWith("workspace_1", "server-user", "item_1", "NOT_PLANNED", 1);
    const body = { name: "新秘", depositAmount: 1000, expectedVersion: 1 };
    await PATCH(send("PATCH", body), context);
    expect(mocks.update).toHaveBeenCalledWith("workspace_1", "server-user", "item_1", body);
  });

  it("刪除只收版本", async () => {
    expect((await DELETE(send("DELETE", { expectedVersion: 2 }), context)).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith("workspace_1", "server-user", "item_1", 2);
    expect((await DELETE(send("DELETE", { expectedVersion: 2, force: true }), context)).status).toBe(400);
  });

  it("不外洩內部錯誤細節", async () => {
    mocks.booking.mockRejectedValue(new Error("private database details"));
    const response = await PATCH(send("PATCH", payBody), context);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database details");
  });
});
