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
  packingItem: { create, updateMany, deleteMany },
};

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/workspace-mutation-access", () => ({
  requireLockedWorkspaceAccess,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: transaction },
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  createPackingItemAction,
  deletePackingItemAction,
  setPackingItemPackedAction,
} from "./packing-items";

const idleState = { status: "idle" as const };
const packingPath = "/workspaces/workspace_1/tasks/packing";

function versionFormData(expectedVersion = "0") {
  const formData = new FormData();
  formData.set("expectedVersion", expectedVersion);
  return formData;
}

describe("packing item server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({ role: "OWNER" });
    requireLockedWorkspaceAccess.mockResolvedValue("OWNER");
    create.mockResolvedValue({ id: "packing_1" });
    updateMany.mockResolvedValue({ count: 1 });
    deleteMany.mockResolvedValue({ count: 1 });
    transaction.mockImplementation(async (operation) =>
      operation(transactionClient),
    );
  });

  it("creates an item only after edit authorization and ignores forged fields", async () => {
    const formData = new FormData();
    formData.set("title", "  隱形眼鏡   藥水 ");
    formData.set("side", "PARTNER_A");
    formData.set("workspaceId", "workspace_attacker");
    formData.set("packed", "true");
    formData.set("role", "OWNER");

    await expect(
      createPackingItemAction("workspace_1", idleState, formData),
    ).resolves.toEqual({ status: "success", message: "已加入打包清單。" });

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
    expect(create).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1",
        title: "隱形眼鏡 藥水",
        side: "PARTNER_A",
        packed: false,
      },
    });
    expect(
      requireLockedWorkspaceAccess.mock.invocationCallOrder[0],
    ).toBeLessThan(create.mock.invocationCallOrder[0]);
    expect(revalidatePath).toHaveBeenCalledWith(packingPath);
  });

  it("rejects an empty title without writing", async () => {
    const formData = new FormData();
    formData.set("title", "   ");
    formData.set("side", "SHARED");

    await expect(
      createPackingItemAction("workspace_1", idleState, formData),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("returns FORBIDDEN for read-only members before any write", async () => {
    requireWorkspaceAccess.mockRejectedValue(
      new WorkspaceAccessDeniedError(),
    );
    await expect(
      setPackingItemPackedAction(
        "workspace_1",
        "packing_1",
        true,
        idleState,
        versionFormData(),
      ),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("checks an item with an optimistic version guard scoped to the workspace", async () => {
    await expect(
      setPackingItemPackedAction(
        "workspace_1",
        "packing_1",
        true,
        idleState,
        versionFormData("3"),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "packing_1", workspaceId: "workspace_1", version: 3 },
      data: { packed: true, version: { increment: 1 } },
    });
  });

  it("reports STALE when the version no longer matches", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(
      setPackingItemPackedAction(
        "workspace_1",
        "packing_1",
        false,
        idleState,
        versionFormData("1"),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
  });

  it("deletes only within the workspace and version", async () => {
    await expect(
      deletePackingItemAction(
        "workspace_1",
        "packing_1",
        idleState,
        versionFormData("2"),
      ),
    ).resolves.toEqual({ status: "success", message: "已從打包清單移除。" });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: "packing_1", workspaceId: "workspace_1", version: 2 },
    });
  });
});
