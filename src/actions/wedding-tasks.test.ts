import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const {
  requireCurrentUser,
  requireWorkspaceAccess,
  requireLockedWorkspaceAccess,
  create,
  updateMany,
  deleteMany,
  transaction,
  revalidatePath,
} = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  requireLockedWorkspaceAccess: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  transaction: vi.fn(),
  revalidatePath: vi.fn(),
}));

const transactionClient = {
  weddingTask: { create, updateMany, deleteMany },
};

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/workspace-mutation-access", () => ({
  requireLockedWorkspaceAccess,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    weddingTask: { create, updateMany, deleteMany },
    $transaction: transaction,
  },
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  changeWeddingTaskStatusAction,
  createWeddingTaskAction,
  deleteWeddingTaskAction,
  updateWeddingTaskAction,
} from "./wedding-tasks";

const idleState = { status: "idle" as const };
const tasksPath = "/workspaces/workspace_1/tasks";

function validTaskFormData(expectedVersion = "0") {
  const formData = new FormData();
  formData.set("title", "  確認   婚宴流程  ");
  formData.set("description", "  與主持人確認  ");
  formData.set("dueDate", "2028-02-29");
  formData.set("expectedVersion", expectedVersion);
  return formData;
}

function versionFormData(expectedVersion = "0") {
  const formData = new FormData();
  formData.set("expectedVersion", expectedVersion);
  return formData;
}

describe("wedding task server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-03-01T08:09:10.000Z"));
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "PLANNER",
      workspace: { id: "workspace_1" },
    });
    requireLockedWorkspaceAccess.mockResolvedValue("PLANNER");
    create.mockResolvedValue({ id: "task_1" });
    updateMany.mockResolvedValue({ count: 1 });
    deleteMany.mockResolvedValue({ count: 1 });
    transaction.mockImplementation(async (operation) =>
      operation(transactionClient),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates TODO only after edit authorization and ignores forged fields", async () => {
    const formData = validTaskFormData();
    formData.set("workspaceId", "workspace_attacker");
    formData.set("userId", "attacker");
    formData.set("role", "OWNER");
    formData.set("status", "DONE");
    formData.set("completedAt", "2020-01-01T00:00:00.000Z");
    formData.set("createdAt", "2020-01-01T00:00:00.000Z");
    formData.set("updatedAt", "2020-01-01T00:00:00.000Z");

    await expect(
      createWeddingTaskAction("workspace_1", idleState, formData),
    ).resolves.toEqual({ status: "success", message: "已新增婚宴任務。" });

    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
    );
    expect(requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
      transactionClient,
    );
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1",
        title: "確認 婚宴流程",
        description: "與主持人確認",
        dueDate: new Date("2028-02-29T00:00:00.000Z"),
        status: "TODO",
        completedAt: null,
      },
    });
    expect(requireCurrentUser.mock.invocationCallOrder[0]).toBeLessThan(
      requireWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(requireWorkspaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      requireLockedWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(
      requireLockedWorkspaceAccess.mock.invocationCallOrder[0],
    ).toBeLessThan(create.mock.invocationCallOrder[0]);
    expect(revalidatePath).toHaveBeenCalledWith(tasksPath);
  });

  it.each(["OWNER", "PARTNER", "PLANNER"])(
    "allows the %s editor role returned by the membership guard",
    async (role) => {
      requireWorkspaceAccess.mockResolvedValueOnce({ role, workspace: {} });

      await expect(
        createWeddingTaskAction("workspace_1", idleState, validTaskFormData()),
      ).resolves.toMatchObject({ status: "success" });
      expect(create).toHaveBeenCalledOnce();
    },
  );

  it("denies VIEWER or outsider mutations before validation and task writes", async () => {
    requireWorkspaceAccess.mockRejectedValue(new WorkspaceAccessDeniedError());

    const calls = [
      createWeddingTaskAction("workspace_1", idleState, new FormData()),
      updateWeddingTaskAction(
        "workspace_1",
        "task_1",
        idleState,
        new FormData(),
      ),
      changeWeddingTaskStatusAction(
        "workspace_1",
        "task_1",
        "HACKED",
        idleState,
        new FormData(),
      ),
      deleteWeddingTaskAction(
        "workspace_1",
        "task_1",
        idleState,
        new FormData(),
      ),
    ];

    for (const call of calls) {
      await expect(call).resolves.toEqual({
        status: "error",
        code: "FORBIDDEN",
        message: "無權存取此婚宴工作區。",
      });
    }
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("denies a task mutation revoked after the early guard without writing", async () => {
    requireLockedWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );

    await expect(
      createWeddingTaskAction("workspace_1", idleState, validTaskFormData()),
    ).resolves.toEqual({
      status: "error",
      code: "FORBIDDEN",
      message: "無權存取此婚宴工作區。",
    });
    expect(requireWorkspaceAccess).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not swallow a current-user redirect", async () => {
    const redirectError = new Error("NEXT_REDIRECT");
    requireCurrentUser.mockRejectedValueOnce(redirectError);

    await expect(
      createWeddingTaskAction("workspace_1", idleState, new FormData()),
    ).rejects.toBe(redirectError);
    expect(requireWorkspaceAccess).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("validates details and expectedVersion only after authorization", async () => {
    const invalidDate = validTaskFormData();
    invalidDate.set("dueDate", "2027-02-29");

    await expect(
      createWeddingTaskAction("workspace_1", idleState, invalidDate),
    ).resolves.toEqual({
      status: "error",
      code: "VALIDATION",
      message: "請輸入有效的到期日。",
    });
    await expect(
      updateWeddingTaskAction(
        "workspace_1",
        "task_1",
        idleState,
        validTaskFormData("9007199254740992"),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "VALIDATION",
      message: "版本資訊無效，請重新整理後再試。",
    });
    expect(requireWorkspaceAccess).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(["", "-1", "1.5", "1e2", "NaN"])(
    "rejects an invalid expectedVersion: %s",
    async (expectedVersion) => {
      await expect(
        deleteWeddingTaskAction(
          "workspace_1",
          "task_1",
          idleState,
          versionFormData(expectedVersion),
        ),
      ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
      expect(deleteMany).not.toHaveBeenCalled();
    },
  );

  it("updates details with id + workspace + version CAS and never overwrites status", async () => {
    await expect(
      updateWeddingTaskAction(
        "workspace_1",
        "task_1",
        idleState,
        validTaskFormData("7"),
      ),
    ).resolves.toEqual({ status: "success", message: "已更新任務內容。" });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "task_1", workspaceId: "workspace_1", version: 7 },
      data: {
        title: "確認 婚宴流程",
        description: "與主持人確認",
        dueDate: new Date("2028-02-29T00:00:00.000Z"),
        version: { increment: 1 },
      },
    });
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty("status");
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty("completedAt");
    expect(revalidatePath).toHaveBeenCalledWith(tasksPath);
  });

  it("sets DONE and completedAt in one CAS update", async () => {
    await expect(
      changeWeddingTaskStatusAction(
        "workspace_1",
        "task_1",
        "DONE",
        idleState,
        versionFormData("4"),
      ),
    ).resolves.toEqual({ status: "success", message: "已更新任務狀態。" });

    expect(updateMany).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "task_1",
        workspaceId: "workspace_1",
        version: 4,
        status: { not: "DONE" },
      },
      data: {
        status: "DONE",
        completedAt: new Date("2027-03-01T08:09:10.000Z"),
        version: { increment: 1 },
      },
    });
  });

  it("handles DONE to DONE with a second CAS update that preserves completedAt", async () => {
    updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await expect(
      changeWeddingTaskStatusAction(
        "workspace_1",
        "task_1",
        "DONE",
        idleState,
        versionFormData("4"),
      ),
    ).resolves.toEqual({ status: "success", message: "已更新任務狀態。" });

    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: "task_1",
        workspaceId: "workspace_1",
        version: 4,
        status: "DONE",
      },
      data: { version: { increment: 1 } },
    });
    expect(updateMany.mock.calls[1][0].data).not.toHaveProperty("completedAt");
    expect(revalidatePath).toHaveBeenCalledWith(tasksPath);
  });

  it.each(["TODO", "IN_PROGRESS"])(
    "sets %s and clears completedAt in one CAS update",
    async (targetStatus) => {
      await expect(
        changeWeddingTaskStatusAction(
          "workspace_1",
          "task_1",
          targetStatus,
          idleState,
          versionFormData("2"),
        ),
      ).resolves.toMatchObject({ status: "success" });

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: "task_1", workspaceId: "workspace_1", version: 2 },
        data: {
          status: targetStatus,
          completedAt: null,
          version: { increment: 1 },
        },
      });
    },
  );

  it("returns STALE only after both DONE CAS updates miss and revalidates", async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(
      changeWeddingTaskStatusAction(
        "workspace_1",
        "task_1",
        "DONE",
        idleState,
        versionFormData("8"),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "STALE",
      message: "資料已更新或不存在，請重新整理後再試。",
    });
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith(tasksPath);
  });

  it("rejects an invalid bound status only after authorization and before writes", async () => {
    await expect(
      changeWeddingTaskStatusAction(
        "workspace_1",
        "task_1",
        "ARCHIVED",
        idleState,
        versionFormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "VALIDATION",
      message: "請選擇有效的任務狀態。",
    });
    expect(requireWorkspaceAccess).toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("deletes with id + workspace + version CAS", async () => {
    await expect(
      deleteWeddingTaskAction(
        "workspace_1",
        "task_1",
        idleState,
        versionFormData("9"),
      ),
    ).resolves.toEqual({ status: "success", message: "已刪除婚宴任務。" });

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: "task_1", workspaceId: "workspace_1", version: 9 },
    });
    expect(revalidatePath).toHaveBeenCalledWith(tasksPath);
  });

  it("returns STALE for a cross-workspace, missing, or already changed record and revalidates", async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(
      updateWeddingTaskAction(
        "workspace_1",
        "task_from_workspace_2",
        idleState,
        validTaskFormData("3"),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "STALE",
      message: "資料已更新或不存在，請重新整理後再試。",
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "task_from_workspace_2",
          workspaceId: "workspace_1",
          version: 3,
        },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(tasksPath);
  });

  it("allows at most one mutation with the same expectedVersion", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    deleteMany.mockResolvedValueOnce({ count: 0 });

    const updated = await updateWeddingTaskAction(
      "workspace_1",
      "task_1",
      idleState,
      validTaskFormData("6"),
    );
    const deleted = await deleteWeddingTaskAction(
      "workspace_1",
      "task_1",
      idleState,
      versionFormData("6"),
    );

    expect(updated.status).toBe("success");
    expect(deleted).toMatchObject({ status: "error", code: "STALE" });
    expect(updateMany.mock.calls[0][0].where.version).toBe(6);
    expect(deleteMany.mock.calls[0][0].where.version).toBe(6);
  });

  it("does not revalidate authorization, validation, or write failures", async () => {
    create.mockRejectedValueOnce(new Error("database secret"));

    await expect(
      createWeddingTaskAction("workspace_1", idleState, validTaskFormData()),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法新增婚宴任務，請稍後再試。",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sanitizes P2025 and unknown write failures", async () => {
    updateMany.mockRejectedValueOnce({ code: "P2025", meta: "secret" });
    deleteMany.mockRejectedValueOnce(new Error("postgres://secret"));

    await expect(
      updateWeddingTaskAction(
        "workspace_1",
        "task_1",
        idleState,
        validTaskFormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法更新任務內容，請稍後再試。",
    });
    await expect(
      deleteWeddingTaskAction(
        "workspace_1",
        "task_1",
        idleState,
        versionFormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法刪除婚宴任務，請稍後再試。",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sanitizes authorization lookup errors before validation or writes", async () => {
    requireWorkspaceAccess.mockRejectedValue(
      new Error("membership database secret"),
    );

    await expect(
      createWeddingTaskAction("workspace_1", idleState, new FormData()),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法確認工作區權限，請稍後再試。",
    });
    expect(create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps a committed write successful when revalidation throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    revalidatePath.mockImplementationOnce(() => {
      throw new Error("secret cache failure");
    });

    await expect(
      createWeddingTaskAction("workspace_1", idleState, validTaskFormData()),
    ).resolves.toEqual({
      status: "success",
      message: "已新增婚宴任務；畫面未自動更新，請重新整理。",
    });
    expect(create).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("婚宴任務頁面重新驗證失敗。");
    expect(log).not.toHaveBeenCalledWith(expect.anything(), expect.anything());
  });
});
