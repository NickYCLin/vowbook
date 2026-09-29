import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  owner: vi.fn(),
  findFirst: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: mocks.owner }));

import { mobileDeleteWorkspace } from "./workspace-settings";

const client = {
  weddingWorkspace: { findFirst: mocks.findFirst, deleteMany: mocks.deleteMany },
};
const stamp = "2026-09-29T06:00:00.000Z";
const input = { confirmationName: "林家婚宴", expectedUpdatedAt: stamp };

describe("手機刪除整場婚宴", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.owner.mockResolvedValue("OWNER");
    mocks.findFirst.mockResolvedValue({ name: "林家婚宴" });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(client));
  });

  it("名稱對得上才真的刪", async () => {
    await expect(mobileDeleteWorkspace("workspace_1", "user_1", input)).resolves.toEqual({ deleted: true });
    expect(mocks.owner).toHaveBeenCalledWith("workspace_1", "user_1", "manageMembers", client);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { id: "workspace_1", updatedAt: new Date(stamp) },
    });
  });

  it("名稱打錯就不刪", async () => {
    await expect(mobileDeleteWorkspace("workspace_1", "user_1", { ...input, confirmationName: "別場婚宴" }))
      .rejects.toMatchObject({ status: 400, code: "CONFIRMATION" });
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("名稱前後多打空白不影響比對，中間的空白照樣收斂成一個", async () => {
    mocks.findFirst.mockResolvedValue({ name: "林家 婚宴" });
    await expect(mobileDeleteWorkspace("workspace_1", "user_1", { ...input, confirmationName: "  林家  婚宴 " }))
      .resolves.toEqual({ deleted: true });
  });

  it("這場婚宴在別處被改過就擋下來", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(mobileDeleteWorkspace("workspace_1", "user_1", input))
      .rejects.toMatchObject({ status: 409, code: "STALE" });
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("刪的瞬間被搶先一步也回衝突", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    await expect(mobileDeleteWorkspace("workspace_1", "user_1", input))
      .rejects.toMatchObject({ status: 409, code: "STALE" });
  });

  it("不是擁有者就不給刪", async () => {
    const { WorkspaceAccessDeniedError } = await import("@/domain/workspace");
    mocks.owner.mockRejectedValue(new WorkspaceAccessDeniedError());
    await expect(mobileDeleteWorkspace("workspace_1", "user_1", input))
      .rejects.toMatchObject({ status: 403 });
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});
