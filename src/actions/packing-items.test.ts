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
  movePackingItemAction,
  setPackingItemPackedAction,
  updatePackingItemAction,
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
        category: "PERSONAL",
        note: null,
        packed: false,
      },
    });
    expect(
      requireLockedWorkspaceAccess.mock.invocationCallOrder[0],
    ).toBeLessThan(create.mock.invocationCallOrder[0]);
    expect(revalidatePath).toHaveBeenCalledWith(packingPath);
  });

  it("creates a wedding supply with a trimmed note", async () => {
    const formData = new FormData();
    formData.set("title", "位上禮 堅果");
    formData.set("side", "SHARED");
    formData.set("category", "WEDDING_SUPPLY");
    formData.set("note", "  120 份   兩箱 ");

    await expect(
      createPackingItemAction("workspace_1", idleState, formData),
    ).resolves.toEqual({ status: "success", message: "已加入宴客用品。" });
    expect(create).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1",
        title: "位上禮 堅果",
        side: "SHARED",
        category: "WEDDING_SUPPLY",
        note: "120 份 兩箱",
        packed: false,
      },
    });
  });

  it("rejects an unknown category without writing", async () => {
    const formData = new FormData();
    formData.set("title", "喜糖");
    formData.set("side", "SHARED");
    formData.set("category", "SECRET");
    await expect(
      createPackingItemAction("workspace_1", idleState, formData),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
    expect(transaction).not.toHaveBeenCalled();
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

  it("edits title and side within the workspace and version, ignoring forged fields", async () => {
    const formData = versionFormData("2");
    formData.set("title", "  睡衣 （前開式） ");
    formData.set("side", "PARTNER_B");
    formData.set("workspaceId", "workspace_attacker");
    formData.set("packed", "true");
    formData.set("category", "WEDDING_SUPPLY");

    await expect(
      updatePackingItemAction("workspace_1", "packing_1", idleState, formData),
    ).resolves.toEqual({ status: "success", message: "已更新物品。" });

    expect(requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
      transactionClient,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "packing_1", workspaceId: "workspace_1", version: 2 },
      data: {
        title: "睡衣 （前開式）",
        side: "PARTNER_B",
        note: null,
        version: { increment: 1 },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(packingPath);
  });

  it("rejects an empty edited title and reports STALE on version mismatch", async () => {
    const empty = versionFormData("1");
    empty.set("title", "  ");
    empty.set("side", "SHARED");
    await expect(
      updatePackingItemAction("workspace_1", "packing_1", idleState, empty),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
    expect(updateMany).not.toHaveBeenCalled();

    updateMany.mockResolvedValueOnce({ count: 0 });
    const stale = versionFormData("1");
    stale.set("title", "牙刷");
    stale.set("side", "SHARED");
    await expect(
      updatePackingItemAction("workspace_1", "packing_1", idleState, stale),
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

  it("moves an item to another side and category within the workspace and version", async () => {
    const formData = versionFormData("4");
    formData.set("side", "SHARED");
    formData.set("category", "WEDDING_SUPPLY");
    formData.set("workspaceId", "workspace_attacker");
    formData.set("title", "forged");

    await expect(
      movePackingItemAction("workspace_1", "packing_1", idleState, formData),
    ).resolves.toEqual({ status: "success", message: "已移到宴客用品。" });
    expect(requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
      transactionClient,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "packing_1", workspaceId: "workspace_1", version: 4 },
      data: {
        side: "SHARED",
        category: "WEDDING_SUPPLY",
        version: { increment: 1 },
      },
    });
  });

  it("requires an explicit category when moving and reports STALE on mismatch", async () => {
    const missing = versionFormData("1");
    missing.set("side", "PARTNER_B");
    await expect(
      movePackingItemAction("workspace_1", "packing_1", idleState, missing),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
    expect(transaction).not.toHaveBeenCalled();

    updateMany.mockResolvedValueOnce({ count: 0 });
    const stale = versionFormData("1");
    stale.set("side", "PARTNER_B");
    stale.set("category", "PERSONAL");
    await expect(
      movePackingItemAction("workspace_1", "packing_1", idleState, stale),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
  });
});
