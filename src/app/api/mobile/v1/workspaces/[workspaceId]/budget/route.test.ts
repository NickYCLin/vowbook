import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), budget: vi.fn(), create: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/workspace-data", () => ({ mobileBudget: mocks.budget }));
vi.mock("@/lib/mobile/budget-items", async (original) => ({
  ...(await original<typeof import("@/lib/mobile/budget-items")>()),
  mobileCreateBudgetItem: mocks.create,
}));

import { GET, POST } from "./route";
import { MobileRequestError } from "@/lib/mobile/protocol";

const context = { params: Promise.resolve({ workspaceId: "workspace_1" }) };

describe("手機花費 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
  });

  it("認證失敗時不讀取花費", async () => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "重新登入"));
    expect((await GET(new Request("https://example.test"), context)).status).toBe(401);
    expect(mocks.budget).not.toHaveBeenCalled();
  });

  it("身分只取自已驗證的工作階段，且不快取", async () => {
    mocks.budget.mockResolvedValue({ summary: {} });
    const response = await GET(new Request("https://example.test?userId=other"), context);
    expect(mocks.budget).toHaveBeenCalledWith("workspace_1", "server-user");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("不外洩內部錯誤細節", async () => {
    mocks.budget.mockRejectedValue(new Error("private database details"));
    const response = await GET(new Request("https://example.test"), context);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database details");
  });

  it("新增只收分類與表單欄位", async () => {
    mocks.create.mockResolvedValue({ id: "item_1" });
    const post = (value: unknown) => new Request("https://example.test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    const body = { taxonomyItemKey: "ITEM_BRIDAL_STYLIST", name: "新秘", plannedAmount: 20000 };
    expect((await POST(post(body), context)).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith("workspace_1", "server-user", body);
    for (const field of ["bookingStatus", "paid", "parentId", "workspaceId", "userId"]) {
      expect((await POST(post({ ...body, [field]: "x" }), context)).status).toBe(400);
    }
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
