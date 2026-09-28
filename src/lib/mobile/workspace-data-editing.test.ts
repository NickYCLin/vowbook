import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const mocks = vi.hoisted(() => ({
  locked: vi.fn(),
  transaction: vi.fn(),
  guestCreate: vi.fn(),
  taskCreate: vi.fn(),
  taskUpdateMany: vi.fn(),
  taskDeleteMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: mocks.locked }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import {
  mobileCreateGuest,
  mobileCreateTask,
  mobileDeleteTask,
  mobileUpdateTask,
} from "./workspace-data";

const client = {
  guest: { create: mocks.guestCreate },
  weddingTask: {
    create: mocks.taskCreate,
    updateMany: mocks.taskUpdateMany,
    deleteMany: mocks.taskDeleteMany,
  },
};

const guest = {
  name: "  王 小明 ",
  side: "PARTNER_A",
  attendanceStatus: "ATTENDING",
  partySize: 2,
};

describe("手機新增賓客", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locked.mockResolvedValue("PARTNER");
    mocks.guestCreate.mockResolvedValue({ id: "guest_9", version: 0 });
    mocks.transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(client));
  });

  it("在交易內確認權限，未填輩份時存成平輩", async () => {
    await expect(mobileCreateGuest("workspace_1", "user_1", guest))
      .resolves.toEqual({ id: "guest_9", name: "王 小明", version: 0 });
    expect(mocks.locked).toHaveBeenCalledWith("workspace_1", "user_1", "edit", client);
    expect(mocks.guestCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1",
        name: "王 小明",
        category: "GUEST",
        side: "PARTNER_A",
        attendanceStatus: "ATTENDING",
        partySize: 2,
        notes: null,
        seniority: "PEER",
      },
      select: { id: true, version: true },
    });
  });

  it("輸入錯誤回 400，而且不開交易", async () => {
    await expect(mobileCreateGuest("workspace_1", "user_1", { ...guest, partySize: 21 }))
      .rejects.toMatchObject({ status: 400 });
    await expect(mobileCreateGuest("workspace_1", "user_1", { ...guest, name: " " }))
      .rejects.toMatchObject({ status: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("新郎已經存在時講清楚，不回成系統錯誤", async () => {
    mocks.guestCreate.mockRejectedValue({ code: "P2002" });
    await expect(mobileCreateGuest("workspace_1", "user_1", { ...guest, category: "COUPLE", partySize: 1 }))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("新郎") });
  });

  it("沒有編輯權限回 403", async () => {
    mocks.locked.mockRejectedValue(new WorkspaceAccessDeniedError());
    await expect(mobileCreateGuest("workspace_1", "user_1", guest)).rejects.toMatchObject({ status: 403 });
    expect(mocks.guestCreate).not.toHaveBeenCalled();
  });
});

describe("手機新增與修改任務", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locked.mockResolvedValue("OWNER");
    mocks.taskCreate.mockResolvedValue({ id: "task_1", version: 0 });
    mocks.taskUpdateMany.mockResolvedValue({ count: 1 });
    mocks.taskDeleteMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(client));
  });

  it("新任務一律從待辦開始", async () => {
    await mobileCreateTask("workspace_1", "user_1", { title: "訂喜餅", description: "", dueDate: "2026-10-01", side: "PARTNER_B" });
    expect(mocks.taskCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1",
        title: "訂喜餅",
        description: null,
        dueDate: new Date("2026-10-01T00:00:00.000Z"),
        side: "PARTNER_B",
        status: "TODO",
        completedAt: null,
      },
      select: { id: true, version: true },
    });
  });

  it("日期或歸屬不對就擋下", async () => {
    await expect(mobileCreateTask("workspace_1", "user_1", { title: "試菜", dueDate: "2026-02-30", side: "SHARED" }))
      .rejects.toMatchObject({ status: 400 });
    await expect(mobileCreateTask("workspace_1", "user_1", { title: "試菜", side: "BOTH" }))
      .rejects.toMatchObject({ status: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("修改只動這場婚宴裡同版本的那一筆，也不改狀態", async () => {
    await expect(mobileUpdateTask("workspace_1", "user_1", "task_1", {
      title: "試菜", description: "晚上七點", dueDate: null, side: "SHARED", expectedVersion: 4,
    })).resolves.toEqual({ id: "task_1", title: "試菜", version: 5 });
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith({
      where: { id: "task_1", workspaceId: "workspace_1", version: 4 },
      data: { title: "試菜", description: "晚上七點", dueDate: null, side: "SHARED", version: { increment: 1 } },
    });
  });

  it("版本對不上時回 409", async () => {
    mocks.taskUpdateMany.mockResolvedValue({ count: 0 });
    await expect(mobileUpdateTask("workspace_1", "user_1", "task_1", { title: "試菜", side: "SHARED", expectedVersion: 1 }))
      .rejects.toMatchObject({ status: 409 });
    mocks.taskDeleteMany.mockResolvedValue({ count: 0 });
    await expect(mobileDeleteTask("workspace_1", "user_1", "task_1", 1)).rejects.toMatchObject({ status: 409 });
  });

  it("刪除要帶版本，範圍限定這場婚宴", async () => {
    await expect(mobileDeleteTask("workspace_1", "user_1", "task_1", 2)).resolves.toEqual({ id: "task_1", removed: true });
    expect(mocks.taskDeleteMany).toHaveBeenCalledWith({ where: { id: "task_1", workspaceId: "workspace_1", version: 2 } });
    await expect(mobileDeleteTask("workspace_1", "user_1", "task_1", "2")).rejects.toMatchObject({ status: 400 });
  });

  it("不外洩資料庫錯誤", async () => {
    mocks.taskCreate.mockRejectedValue(new Error("private database details"));
    await expect(mobileCreateTask("workspace_1", "user_1", { title: "試菜", side: "SHARED" }))
      .rejects.toMatchObject({ status: 503, message: expect.not.stringContaining("private") });
  });
});
