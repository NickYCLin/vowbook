import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), add: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/budget-items", async (original) => ({
  ...(await original<typeof import("@/lib/mobile/budget-items")>()),
  mobileAddBudgetPayment: mocks.add,
  mobileDeleteBudgetPayment: mocks.remove,
}));

import { POST } from "./route";
import { DELETE } from "./[paymentId]/route";
import { MobileRequestError } from "@/lib/mobile/protocol";

const send = (method: string, value: unknown) =>
  new Request("https://example.test", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
const itemContext = {
  params: Promise.resolve({ workspaceId: "workspace_1", budgetItemId: "item_1" }),
};
const paymentContext = {
  params: Promise.resolve({ workspaceId: "workspace_1", budgetItemId: "item_1", paymentId: "pay_1" }),
};

describe("手機尾款分批付款 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
    mocks.add.mockResolvedValue({ id: "item_1", version: 5 });
    mocks.remove.mockResolvedValue({ id: "item_1", version: 6 });
  });

  it("認證失敗時不寫入", async () => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "重新登入"));
    expect((await POST(send("POST", { amount: 1 }), itemContext)).status).toBe(401);
    expect((await DELETE(send("DELETE", { expectedVersion: 1 }), paymentContext)).status).toBe(401);
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("身分與項目只取自路徑和登入者", async () => {
    const body = { amount: 50000, paidOn: "2026-10-01", expectedVersion: 4 };
    const response = await POST(send("POST", body), itemContext);
    expect(response.status).toBe(201);
    expect(mocks.add).toHaveBeenCalledWith("workspace_1", "server-user", "item_1", body);
    expect((await DELETE(send("DELETE", { expectedVersion: 5 }), paymentContext)).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith("workspace_1", "server-user", "item_1", "pay_1", 5);
  });

  it("刪除只收版本欄位", async () => {
    expect((await DELETE(send("DELETE", { expectedVersion: 5, amount: 1 }), paymentContext)).status).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
