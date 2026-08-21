import { beforeEach, describe, expect, it, vi } from "vitest";
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
  weddingStaffAssignment: { create, updateMany, deleteMany },
};

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/workspace-mutation-access", () => ({
  requireLockedWorkspaceAccess,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    weddingStaffAssignment: { create, updateMany, deleteMany },
    $transaction: transaction,
  },
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  createWeddingStaffAction,
  deleteWeddingStaffAction,
  updateWeddingStaffAction,
} from "./wedding-staff";

const idleState = { status: "idle" as const };

function staffForm(expectedVersion?: string) {
  const form = new FormData();
  form.set("roleName", "  婚禮主持  ");
  form.set("personName", "  林小美  ");
  form.set("contactPhone", "  0912 345 678  ");
  form.set("notes", "  第一段\n  第二段  ");
  if (expectedVersion !== undefined) {
    form.set("expectedVersion", expectedVersion);
  }
  return form;
}

describe("wedding staff actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "PLANNER",
      workspace: { id: "workspace_1" },
    });
    requireLockedWorkspaceAccess.mockResolvedValue("PLANNER");
    create.mockResolvedValue({ id: "staff_1" });
    updateMany.mockResolvedValue({ count: 1 });
    deleteMany.mockResolvedValue({ count: 1 });
    transaction.mockImplementation(async (operation) =>
      operation(transactionClient),
    );
  });

  it("authorizes, ignores forged ownership, and creates scoped staff", async () => {
    const form = staffForm();
    form.set("workspaceId", "workspace_attacker");
    form.set("userId", "attacker");
    form.set("version", "99");
    await expect(
      createWeddingStaffAction("workspace_1", idleState, form),
    ).resolves.toMatchObject({ status: "success" });
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
        roleName: "婚禮主持",
        personName: "林小美",
        contactPhone: "0912 345 678",
        notes: "第一段\n  第二段",
      },
    });
    expect(
      requireLockedWorkspaceAccess.mock.invocationCallOrder[0],
    ).toBeLessThan(create.mock.invocationCallOrder[0]);
  });

  it("denies VIEWER before validation and writes", async () => {
    requireWorkspaceAccess.mockRejectedValue(new WorkspaceAccessDeniedError());
    await expect(
      createWeddingStaffAction("workspace_1", idleState, new FormData()),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(create).not.toHaveBeenCalled();
  });

  it("denies a staff mutation revoked after the early guard without writing", async () => {
    requireLockedWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );

    await expect(
      createWeddingStaffAction("workspace_1", idleState, staffForm()),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(requireWorkspaceAccess).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("updates and deletes with id + workspaceId + version CAS", async () => {
    await expect(
      updateWeddingStaffAction(
        "workspace_1",
        "staff_1",
        idleState,
        staffForm("4"),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "staff_1", workspaceId: "workspace_1", version: 4 },
      data: {
        roleName: "婚禮主持",
        personName: "林小美",
        contactPhone: "0912 345 678",
        notes: "第一段\n  第二段",
        version: { increment: 1 },
      },
    });

    const deleteForm = new FormData();
    deleteForm.set("expectedVersion", "5");
    await deleteWeddingStaffAction(
      "workspace_1",
      "staff_1",
      idleState,
      deleteForm,
    );
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: "staff_1", workspaceId: "workspace_1", version: 5 },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/workspaces/workspace_1/staff");
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/timeline",
    );
  });

  it("returns STALE when the scoped CAS misses", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(
      updateWeddingStaffAction(
        "workspace_1",
        "foreign_staff",
        idleState,
        staffForm("2"),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not revalidate a stale delete into a fresh CAS token", async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    const form = new FormData();
    form.set("expectedVersion", "5");

    await expect(
      deleteWeddingStaffAction(
        "workspace_1",
        "staff_1",
        idleState,
        form,
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
