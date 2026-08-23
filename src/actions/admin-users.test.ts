import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  revalidatePath,
  requireSystemAdmin,
  runSerializableTransaction,
  updateSystemUserAccessStatus,
} = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  requireSystemAdmin: vi.fn(),
  runSerializableTransaction: vi.fn(),
  updateSystemUserAccessStatus: vi.fn(),
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
  };
});

import { updateSystemUserAccessAction } from "./admin-users";
import {
  SystemAdminAccessDeniedError,
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
