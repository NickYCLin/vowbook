import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  revalidatePath,
  requireSystemAdmin,
  runSerializableTransaction,
  updateSystemUserAccessStatus,
  deleteSystemUser,
} = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  requireSystemAdmin: vi.fn(),
  runSerializableTransaction: vi.fn(),
  updateSystemUserAccessStatus: vi.fn(),
  deleteSystemUser: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/serializable-transaction", () => ({
  runSerializableTransaction,
}));
vi.mock("@/lib/system-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/system-admin")>();
  return {
    ...actual,
    requireSystemAdmin,
    updateSystemUserAccessStatus,
    deleteSystemUser,
  };
});

import {
  deleteSystemUserAction,
  updateSystemUserAccessAction,
} from "./admin-users";
import {
  SystemAdminAccessDeniedError,
  SystemAdminDeleteConfirmationError,
  SystemAdminProtectedUserError,
  SystemAdminStaleWriteError,
} from "@/lib/system-admin";

const admin = { id: "user_admin" };

function formData(values: Record<string, string> = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSystemAdmin.mockResolvedValue(admin);
  runSerializableTransaction.mockImplementation(async (operation) =>
    operation({ user: {} }),
  );
  updateSystemUserAccessStatus.mockResolvedValue(undefined);
  deleteSystemUser.mockResolvedValue(undefined);
});

describe("updateSystemUserAccessAction", () => {
  it("authorizes the system admin before parsing target input", async () => {
    requireSystemAdmin.mockRejectedValueOnce(
      new SystemAdminAccessDeniedError(),
    );

    await expect(
      updateSystemUserAccessAction({ status: "idle" }, formData()),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(updateSystemUserAccessStatus).not.toHaveBeenCalled();
  });

  it("rejects invalid target, version, and state values", async () => {
    const result = await updateSystemUserAccessAction(
      { status: "idle" },
      formData({
        targetUserId: "../bad",
        expectedVersion: "-1",
        accessStatus: "DELETE",
      }),
    );

    expect(result).toMatchObject({ status: "error", code: "VALIDATION" });
    expect(updateSystemUserAccessStatus).not.toHaveBeenCalled();
  });

  it("updates inside a serializable transaction and revalidates the admin list", async () => {
    const result = await updateSystemUserAccessAction(
      { status: "idle" },
      formData({
        targetUserId: "user_2",
        expectedVersion: "3",
        accessStatus: "SUSPENDED",
      }),
    );

    expect(result).toEqual({
      status: "success",
      message: "已停權這位使用者。",
    });
    expect(updateSystemUserAccessStatus).toHaveBeenCalledWith(
      admin,
      "user_2",
      3,
      "SUSPENDED",
      { user: {} },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/users");
  });

  it.each([
    [new SystemAdminProtectedUserError(), "PROTECTED"],
    [new SystemAdminStaleWriteError(), "STALE"],
  ])("returns safe policy errors", async (error, code) => {
    updateSystemUserAccessStatus.mockRejectedValueOnce(error);

    await expect(
      updateSystemUserAccessAction(
        { status: "idle" },
        formData({
          targetUserId: "user_2",
          expectedVersion: "3",
          accessStatus: "REMOVED",
        }),
      ),
    ).resolves.toMatchObject({ status: "error", code });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteSystemUserAction", () => {
  const validDeletion = {
    targetUserId: "user_2",
    expectedVersion: "3",
    confirmationEmail: "guest@example.com",
  };

  it("先確認系統管理權限，才看要刪誰", async () => {
    requireSystemAdmin.mockRejectedValueOnce(new SystemAdminAccessDeniedError());

    await expect(
      deleteSystemUserAction({ status: "idle" }, formData(validDeletion)),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(deleteSystemUser).not.toHaveBeenCalled();
  });

  it("沒有輸入確認 Email 就不執行", async () => {
    const result = await deleteSystemUserAction(
      { status: "idle" },
      formData({ targetUserId: "user_2", expectedVersion: "3", confirmationEmail: "  " }),
    );

    expect(result).toMatchObject({ status: "error", code: "VALIDATION" });
    expect(deleteSystemUser).not.toHaveBeenCalled();
  });

  it("在同一個 Serializable 交易裡刪除，並重新整理名單", async () => {
    const result = await deleteSystemUserAction(
      { status: "idle" },
      formData(validDeletion),
    );

    expect(result).toEqual({
      status: "success",
      message: "已刪除這個帳號與相關資料。",
    });
    expect(deleteSystemUser).toHaveBeenCalledWith(
      admin,
      "user_2",
      3,
      "guest@example.com",
      { user: {} },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/users");
  });

  it.each([
    [new SystemAdminDeleteConfirmationError(), "CONFIRMATION"],
    [new SystemAdminProtectedUserError(), "PROTECTED"],
    [new SystemAdminStaleWriteError(), "STALE"],
  ])("把政策錯誤原樣回報，不重新整理名單", async (error, code) => {
    deleteSystemUser.mockRejectedValueOnce(error);

    await expect(
      deleteSystemUserAction({ status: "idle" }, formData(validDeletion)),
    ).resolves.toMatchObject({ status: "error", code });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("不外洩資料庫錯誤細節", async () => {
    deleteSystemUser.mockRejectedValueOnce(new Error("private database details"));

    const result = await deleteSystemUserAction(
      { status: "idle" },
      formData(validDeletion),
    );

    expect(result).toMatchObject({ status: "error", code: "UNAVAILABLE" });
    expect(JSON.stringify(result)).not.toContain("private database details");
  });
});
