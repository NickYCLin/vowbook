import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const { requireCurrentUser, requireWorkspaceAccess, findMany, transaction } =
  vi.hoisted(() => ({
    requireCurrentUser: vi.fn(),
    requireWorkspaceAccess: vi.fn(),
    findMany: vi.fn(),
    transaction: vi.fn(),
  }));

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: transaction },
}));

import {
  getWeddingTaskList,
  WeddingTaskDataError,
} from "./wedding-task-list";

const select = {
  id: true,
  title: true,
  description: true,
  dueDate: true,
  status: true,
  completedAt: true,
  version: true,
};

const deterministicOrder = [
  { dueDate: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
  { id: "asc" },
];

describe("getWeddingTaskList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "VIEWER",
      workspace: {
        id: "workspace_1",
        name: "我們的婚宴",
        weddingDate: new Date("2027-05-20T00:00:00.000Z"),
      },
    });
    findMany.mockResolvedValue([]);
    transaction.mockImplementation(
      async (callback: (client: unknown) => Promise<unknown>) =>
        callback({ weddingTask: { findMany } }),
    );
  });

  it("allows VIEWER reads only after membership and runs two deterministic RepeatableRead queries", async () => {
    await expect(getWeddingTaskList("workspace_1")).resolves.toEqual({
      role: "VIEWER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
      tasks: [],
    });

    expect(requireCurrentUser).toHaveBeenCalledWith();
    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "read",
    );
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
    });
    expect(findMany).toHaveBeenNthCalledWith(1, {
      where: {
        workspaceId: "workspace_1",
        status: { in: ["TODO", "IN_PROGRESS"] },
      },
      orderBy: deterministicOrder,
      select,
    });
    expect(findMany).toHaveBeenNthCalledWith(2, {
      where: { workspaceId: "workspace_1", status: "DONE" },
      orderBy: deterministicOrder,
      select,
    });
    expect(requireCurrentUser.mock.invocationCallOrder[0]).toBeLessThan(
      requireWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(requireWorkspaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.mock.invocationCallOrder[0],
    );
  });

  it("keeps mixed active date order, appends DONE, and returns a serializable view model", async () => {
    findMany
      .mockResolvedValueOnce([
        {
          id: "active_same_date_a",
          title: "確認流程",
          description: null,
          dueDate: new Date("2027-04-01T00:00:00.000Z"),
          status: "IN_PROGRESS",
          completedAt: null,
          version: 3,
        },
        {
          id: "active_null_date",
          title: "確認攝影",
          description: "等待回覆",
          dueDate: null,
          status: "TODO",
          completedAt: null,
          version: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "done_1",
          title: "預訂場地",
          description: "已付訂金",
          dueDate: null,
          status: "DONE",
          completedAt: new Date("2027-03-01T08:09:10.000Z"),
          version: 5,
        },
      ]);

    const data = await getWeddingTaskList("workspace_1");

    expect(data.tasks).toEqual([
      {
        id: "active_same_date_a",
        title: "確認流程",
        description: null,
        dueDate: "2027-04-01",
        status: "IN_PROGRESS",
        completedAt: null,
        version: 3,
      },
      {
        id: "active_null_date",
        title: "確認攝影",
        description: "等待回覆",
        dueDate: null,
        status: "TODO",
        completedAt: null,
        version: 0,
      },
      {
        id: "done_1",
        title: "預訂場地",
        description: "已付訂金",
        dueDate: null,
        status: "DONE",
        completedAt: "2027-03-01T08:09:10.000Z",
        version: 5,
      },
    ]);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it("preserves outsider denial and never touches task data", async () => {
    requireWorkspaceAccess.mockRejectedValue(new WorkspaceAccessDeniedError());

    await expect(
      getWeddingTaskList("workspace_secret"),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    expect(transaction).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("does not swallow the current-user redirect or inspect membership afterward", async () => {
    const redirectError = new Error("NEXT_REDIRECT");
    requireCurrentUser.mockRejectedValue(redirectError);

    await expect(getWeddingTaskList("workspace_1")).rejects.toBe(redirectError);
    expect(requireWorkspaceAccess).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("sanitizes membership and task read failures", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new Error("membership database secret"),
    );
    await expect(getWeddingTaskList("workspace_1")).rejects.toEqual(
      new WeddingTaskDataError("目前無法載入婚宴任務，請稍後再試。"),
    );
    expect(transaction).not.toHaveBeenCalled();

    requireWorkspaceAccess.mockResolvedValueOnce({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
    });
    transaction.mockRejectedValueOnce(new Error("postgres://secret"));
    await expect(getWeddingTaskList("workspace_1")).rejects.toEqual(
      new WeddingTaskDataError("目前無法載入婚宴任務，請稍後再試。"),
    );
  });
});
