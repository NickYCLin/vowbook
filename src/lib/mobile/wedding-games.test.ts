import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const mocks = vi.hoisted(() => ({
  locked: vi.fn(),
  transaction: vi.fn(),
  findMany: vi.fn(),
  createMany: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: mocks.locked }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import {
  mobileAddGameParticipants,
  mobileDeleteGameParticipant,
  mobileUpdateGameParticipant,
} from "./wedding-games";

const client = {
  weddingGameParticipant: {
    findMany: mocks.findMany,
    createMany: mocks.createMany,
    updateMany: mocks.updateMany,
    deleteMany: mocks.deleteMany,
  },
};

describe("手機遊戲名單寫入", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locked.mockResolvedValue("PARTNER");
    mocks.findMany.mockResolvedValue([{ sortOrder: 2 }]);
    mocks.createMany.mockResolvedValue({ count: 2 });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(client));
  });

  it("在交易內確認編輯權限後，接在名單最後面", async () => {
    await expect(
      mobileAddGameParticipants("workspace_1", "user_1", "BROCCOLI", "阿明\n阿華、阿明"),
    ).resolves.toEqual({ added: 2 });
    expect(mocks.locked).toHaveBeenCalledWith("workspace_1", "user_1", "edit", client);
    expect(mocks.createMany).toHaveBeenCalledWith({
      data: [
        { workspaceId: "workspace_1", game: "BROCCOLI", name: "阿明", note: null, sortOrder: 3 },
        { workspaceId: "workspace_1", game: "BROCCOLI", name: "阿華", note: null, sortOrder: 4 },
      ],
    });
  });

  it("輸入錯誤回 400，且不開交易", async () => {
    await expect(mobileAddGameParticipants("workspace_1", "user_1", "CAKE", "阿明")).rejects.toMatchObject({ status: 400 });
    await expect(mobileAddGameParticipants("workspace_1", "user_1", "BOUQUET", " 、 ")).rejects.toMatchObject({ status: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("超過人數上限回 400", async () => {
    mocks.findMany.mockResolvedValue(Array.from({ length: 40 }, (_, index) => ({ sortOrder: index })));
    await expect(mobileAddGameParticipants("workspace_1", "user_1", "BOUQUET", "小美")).rejects.toMatchObject({ status: 400 });
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it("沒有編輯權限回 403", async () => {
    mocks.locked.mockRejectedValue(new WorkspaceAccessDeniedError());
    await expect(mobileAddGameParticipants("workspace_1", "user_1", "BOUQUET", "小美")).rejects.toMatchObject({ status: 403 });
  });

  it("修改只動同一工作區的指定版本，版本不符回 409", async () => {
    await expect(
      mobileUpdateGameParticipant("workspace_1", "user_1", "p_1", { name: " 小美 ", note: "", expectedVersion: 2 }),
    ).resolves.toEqual({ id: "p_1", name: "小美", note: null, version: 3 });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "p_1", workspaceId: "workspace_1", version: 2 },
      data: { name: "小美", note: null, version: { increment: 1 } },
    });
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      mobileUpdateGameParticipant("workspace_1", "user_1", "p_1", { name: "小美", note: null, expectedVersion: 2 }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("移除同樣檢查版本，並隱藏內部錯誤", async () => {
    await expect(mobileDeleteGameParticipant("workspace_1", "user_1", "p_1", 0)).resolves.toEqual({ removed: true });
    await expect(mobileDeleteGameParticipant("workspace_1", "user_1", "p_1", -1)).rejects.toMatchObject({ status: 400 });
    mocks.deleteMany.mockRejectedValue(new Error("private database details"));
    const error = await mobileDeleteGameParticipant("workspace_1", "user_1", "p_1", 0).catch((value: unknown) => value);
    expect(error).toMatchObject({ status: 503 });
    expect(String((error as Error).message)).not.toContain("private");
  });
});
