import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const mocks = vi.hoisted(() => ({
  locked: vi.fn(),
  access: vi.fn(),
  transaction: vi.fn(),
  updateMany: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: mocks.locked }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess: mocks.access }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import {
  mobileUpdateWorkspaceSettings,
  mobileWorkspaceSettings,
  settingsBody,
} from "./workspace-settings";

const client = { weddingWorkspace: { updateMany: mocks.updateMany, findFirst: mocks.findFirst } };
const updatedAt = "2026-09-28T10:00:00.000Z";

describe("手機婚宴設定", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locked.mockResolvedValue("OWNER");
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findFirst.mockResolvedValue({ updatedAt: new Date("2026-09-28T10:05:00.000Z") });
    mocks.transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(client));
    mocks.access.mockResolvedValue({
      role: "OWNER",
      workspace: {
        name: "宥承與詩涵的婚宴",
        weddingDate: new Date("2026-11-08T00:00:00.000Z"),
        timezone: "Asia/Taipei",
        updatedAt: new Date(updatedAt),
      },
    });
  });

  it("讀出基本資料，日期給純日期、版本給 ISO", async () => {
    await expect(mobileWorkspaceSettings("workspace_1", "user_1")).resolves.toEqual({
      role: "OWNER", canEdit: true, name: "宥承與詩涵的婚宴",
      weddingDate: "2026-11-08", timezone: "Asia/Taipei", expectedUpdatedAt: updatedAt,
    });
  });

  it("協作者看得到但不能改", async () => {
    mocks.access.mockResolvedValue({
      role: "PLANNER",
      workspace: { name: "某場婚宴", weddingDate: null, timezone: "Asia/Taipei", updatedAt: new Date(updatedAt) },
    });
    await expect(mobileWorkspaceSettings("workspace_1", "user_1"))
      .resolves.toMatchObject({ canEdit: false, weddingDate: null });
  });

  it("改名與改日期要是擁有者，並且比對版本", async () => {
    await expect(mobileUpdateWorkspaceSettings("workspace_1", "user_1", {
      name: "  宥承與詩涵  的婚宴 ", weddingDate: "2026-11-08", expectedUpdatedAt: updatedAt,
    })).resolves.toEqual({
      name: "宥承與詩涵 的婚宴", weddingDate: "2026-11-08",
      expectedUpdatedAt: "2026-09-28T10:05:00.000Z",
    });
    expect(mocks.locked).toHaveBeenCalledWith("workspace_1", "user_1", "manageMembers", client);
    expect(mocks.updateMany.mock.calls[0][0].where).toEqual({ id: "workspace_1", updatedAt: new Date(updatedAt) });
  });

  it("日期可以清空，名稱太短或版本無效則擋下", async () => {
    await expect(mobileUpdateWorkspaceSettings("workspace_1", "user_1", {
      name: "小婚宴", weddingDate: null, expectedUpdatedAt: updatedAt,
    })).resolves.toMatchObject({ weddingDate: null });
    await expect(mobileUpdateWorkspaceSettings("workspace_1", "user_1", {
      name: "短", weddingDate: null, expectedUpdatedAt: updatedAt,
    })).rejects.toMatchObject({ status: 400 });
    await expect(mobileUpdateWorkspaceSettings("workspace_1", "user_1", {
      name: "小婚宴", weddingDate: "2026-13-40", expectedUpdatedAt: updatedAt,
    })).rejects.toMatchObject({ status: 400 });
    await expect(mobileUpdateWorkspaceSettings("workspace_1", "user_1", {
      name: "小婚宴", weddingDate: null, expectedUpdatedAt: "剛剛",
    })).rejects.toMatchObject({ status: 400 });
  });

  it("版本對不上回 409，不是擁有者回 403", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(mobileUpdateWorkspaceSettings("workspace_1", "user_1", {
      name: "小婚宴", weddingDate: null, expectedUpdatedAt: updatedAt,
    })).rejects.toMatchObject({ status: 409 });
    mocks.locked.mockRejectedValue(new WorkspaceAccessDeniedError());
    await expect(mobileUpdateWorkspaceSettings("workspace_1", "user_1", {
      name: "小婚宴", weddingDate: null, expectedUpdatedAt: updatedAt,
    })).rejects.toMatchObject({ status: 403 });
  });

  it("只收名稱、日期與版本三個欄位", () => {
    expect(() => settingsBody({ name: "小婚宴", timezone: "UTC" })).toThrowError();
    expect(settingsBody({ name: "小婚宴", weddingDate: null, expectedUpdatedAt: updatedAt })).toMatchObject({ name: "小婚宴" });
  });
});
