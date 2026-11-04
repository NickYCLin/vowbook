import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const mocks = vi.hoisted(() => ({
  current: vi.fn(), access: vi.fn(), transaction: vi.fn(),
  findUnique: vi.fn(), count: vi.fn(), create: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ requireCurrentUser: mocks.current }));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: mocks.access }));
vi.mock("@/lib/serializable-transaction", () => ({ runSerializableTransaction: mocks.transaction }));
import { submitProductFeedbackAction } from "./product-feedback";

const requestId = "00000000-0000-4000-8000-000000000001";
const client = { productFeedback: { findUnique: mocks.findUnique, count: mocks.count, create: mocks.create } };
function submit() {
  const form = new FormData();
  for (const [key, value] of Object.entries({ requestId, section: "budget", category: "habit", message: "希望可以記住我常用的分類篩選。", authorId: "forged" })) form.set(key, value);
  return submitProductFeedbackAction("synthetic-workspace", { status: "idle" }, form);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.current.mockResolvedValue({ id: "authenticated-user" });
  mocks.transaction.mockImplementation((operation) => operation(client));
  mocks.findUnique.mockResolvedValue(null);
  mocks.count.mockResolvedValue(0);
  mocks.create.mockResolvedValue({ id: requestId });
});
describe("保存意見回饋", () => {
  it("鎖定檢查成員權限，身分取自登入狀態，唯讀成員也可回饋", async () => {
    expect(await submit()).toEqual({ status: "success", reference: requestId });
    expect(mocks.access).toHaveBeenCalledWith("synthetic-workspace", "authenticated-user", "read", client);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ authorId: "authenticated-user", workspaceId: "synthetic-workspace" }) }));
  });
  it("非成員不可寫入", async () => {
    mocks.access.mockRejectedValue(new WorkspaceAccessDeniedError());
    expect((await submit()).status).toBe("error");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it("重送相同編號不重複保存", async () => {
    mocks.findUnique.mockResolvedValue({ id: requestId, authorId: "authenticated-user", workspaceId: "synthetic-workspace" });
    expect((await submit()).status).toBe("success");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("不可查出其他成員的回饋編號", async () => {
    mocks.findUnique.mockResolvedValue({ id: requestId, authorId: "other", workspaceId: "synthetic-workspace" });
    expect((await submit()).status).toBe("error");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("限制每小時十則", async () => {
    mocks.count.mockResolvedValue(10);
    expect((await submit()).status).toBe("error");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("保存失敗不回報成功或洩露資料庫錯誤", async () => {
    mocks.create.mockRejectedValue(new Error("internal database detail"));
    const result = await submit();
    expect(result.status).toBe("error");
    expect(result.message).not.toContain("internal");
  });
});
