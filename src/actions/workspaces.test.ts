import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect, revalidatePath, requireCurrentUser, transaction } = vi.hoisted(() => {
  return {
    requireCurrentUser: vi.fn(),
    transaction: vi.fn(),
    revalidatePath: vi.fn(),
    redirect: vi.fn((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    }),
  };
});

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: transaction },
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  createWorkspaceAction,
  deleteWorkspaceAction,
  updateWorkspaceAction,
} from "./workspaces";

const originalUpdatedAt = "2026-07-29T01:02:03.456Z";

function workspaceFormData() {
  const formData = new FormData();
  formData.set("name", "  更新後的   婚宴  ");
  formData.set("weddingDate", "2028-02-29");
  formData.set("timezone", "Asia/Taipei");
  formData.set("expectedUpdatedAt", originalUpdatedAt);
  return formData;
}

function deleteFormData(confirmation = "  目前的   婚宴  ") {
  const formData = new FormData();
  formData.set("confirmationName", confirmation);
  formData.set("expectedUpdatedAt", originalUpdatedAt);
  return formData;
}

describe("createWorkspaceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
  });

  it("creates the workspace and OWNER membership atomically for the session user", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/VowBook");
    const create = vi.fn().mockResolvedValue({ id: "workspace_1" });
    transaction.mockImplementation(async (callback) =>
      callback({ weddingWorkspace: { create } }),
    );
    const formData = new FormData();
    formData.set("name", "  我們的   婚宴  ");
    formData.set("weddingDate", "2027-03-20");
    formData.set("timezone", "Asia/Taipei");
    formData.set("userId", "attacker_supplied_user");

    await expect(
      createWorkspaceAction({ status: "idle" }, formData),
    ).rejects.toThrow("REDIRECT:/dashboard");

    expect(create).toHaveBeenCalledWith({
      data: {
        name: "我們的 婚宴",
        weddingDate: new Date("2027-03-20T00:00:00.000Z"),
        timezone: "Asia/Taipei",
        createdById: "session_user",
        memberships: {
          create: { userId: "session_user", role: "OWNER" },
        },
        budgetItems: {
          create: expect.any(Array),
        },
      },
    });
    const taxonomyNodes = create.mock.calls[0][0].data.budgetItems.create;
    const taxonomyNodeByKey = Object.fromEntries(
      taxonomyNodes.map((node: { systemTaxonomyKey: string }) => [
        node.systemTaxonomyKey,
        node,
      ]),
    );

    expect(taxonomyNodes).toHaveLength(28);
    expect(
      new Set(taxonomyNodes.map((node: { id: string }) => node.id)).size,
    ).toBe(28);
    expect(taxonomyNodeByKey.STAGE_PREPARATION_1_2_MONTHS).toEqual(
      expect.objectContaining({
        parentId: null,
        name: "籌備第1-2月",
        kind: "GROUP",
        category: null,
        sourceOrder: 1,
      }),
    );
    expect(taxonomyNodeByKey.ITEM_WEDDING_VENUE).toEqual(
      expect.objectContaining({
        parentId: taxonomyNodeByKey.STAGE_PREPARATION_1_2_MONTHS.id,
        name: "婚宴場地",
        kind: "GROUP",
        category: null,
        sourceOrder: 2,
      }),
    );
    expect(taxonomyNodeByKey.INTERNAL_UNCLASSIFIED_ITEM).toEqual(
      expect.objectContaining({
        parentId: taxonomyNodeByKey.INTERNAL_UNCLASSIFIED_STAGE.id,
        name: "未分類既有項目",
        kind: "GROUP",
      }),
    );
    expect(
      taxonomyNodes.every(
        (node: Record<string, unknown>) => !("systemCategory" in node),
      ),
    ).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("returns a readable validation error without touching the database", async () => {
    const formData = new FormData();
    formData.set("name", "A");

    await expect(
      createWorkspaceAction({ status: "idle" }, formData),
    ).resolves.toEqual({
      status: "error",
      message: "婚宴名稱需為 2 到 80 個字元。",
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("does not leak database errors", async () => {
    transaction.mockRejectedValue(new Error("postgres connection secret"));
    const formData = new FormData();
    formData.set("name", "我們的婚宴");
    formData.set("timezone", "Asia/Taipei");

    await expect(
      createWorkspaceAction({ status: "idle" }, formData),
    ).resolves.toEqual({
      status: "error",
      message: "目前無法建立婚宴工作區，請稍後再試。",
    });
  });
});

describe("updateWorkspaceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
  });

  it("reauthorizes and locks the OWNER membership in the transaction before a normalized CAS update", async () => {
    const calls: string[] = [];
    const lockMembership = vi.fn(
      async (
        _query: TemplateStringsArray,
        _workspaceId: string,
        _userId: string,
      ) => {
        void _query;
        void _workspaceId;
        void _userId;
        calls.push("authorize-lock");
        return [{ role: "OWNER" }];
      },
    );
    const updateMany = vi.fn(async () => {
      calls.push("update");
      return { count: 1 };
    });
    transaction.mockImplementation(async (callback) =>
      callback({
        $queryRaw: lockMembership,
        weddingWorkspace: { updateMany },
      }),
    );

    await expect(
      updateWorkspaceAction(
        "workspace_target",
        { status: "idle" },
        workspaceFormData(),
      ),
    ).resolves.toEqual({
      status: "success",
      message: "已更新婚宴工作區。",
    });

    expect(calls).toEqual(["authorize-lock", "update"]);
    expect(lockMembership).toHaveBeenCalledTimes(1);
    const [query, workspaceId, userId] = lockMembership.mock.calls[0];
    expect(Array.from(query).join("?")).toContain('FROM "memberships"');
    expect(Array.from(query).join("?")).toContain("FOR UPDATE");
    expect(workspaceId).toBe("workspace_target");
    expect(userId).toBe("session_user");
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "workspace_target",
        updatedAt: new Date(originalUpdatedAt),
      },
      data: {
        name: "更新後的 婚宴",
        weddingDate: new Date("2028-02-29T00:00:00.000Z"),
        timezone: "Asia/Taipei",
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_target/guests",
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_target/members",
    );
  });

  it("does not read or write a target for a non-owner", async () => {
    const lockMembership = vi.fn().mockResolvedValue([{ role: "PARTNER" }]);
    const updateMany = vi.fn();
    transaction.mockImplementation(async (callback) =>
      callback({
        $queryRaw: lockMembership,
        weddingWorkspace: { updateMany },
      }),
    );

    await expect(
      updateWorkspaceAction(
        "workspace_foreign",
        { status: "idle" },
        workspaceFormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "STALE",
      message: "婚宴工作區已被更新或不存在，請重新整理後再試。",
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns the same generic result for a cross-tenant target and a stale CAS", async () => {
    const updateMany = vi.fn();
    transaction.mockImplementation(async (callback) =>
      callback({
        $queryRaw: vi.fn().mockResolvedValue([]),
        weddingWorkspace: { updateMany },
      }),
    );

    await expect(
      updateWorkspaceAction(
        "workspace_foreign",
        { status: "idle" },
        workspaceFormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "STALE",
      message: "婚宴工作區已被更新或不存在，請重新整理後再試。",
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("treats a missing or stale update CAS as a safe conflict", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    transaction.mockImplementation(async (callback) =>
      callback({
        $queryRaw: vi.fn().mockResolvedValue([{ role: "OWNER" }]),
        weddingWorkspace: { updateMany },
      }),
    );

    await expect(
      updateWorkspaceAction(
        "workspace_target",
        { status: "idle" },
        workspaceFormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "STALE",
      message: "婚宴工作區已被更新或不存在，請重新整理後再試。",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteWorkspaceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
  });

  function mockDeleteTransaction({
    membership = { role: "OWNER" },
    workspace = { name: "目前的 婚宴" },
    deleted = 1,
    remaining = 1,
  }: {
    membership?: { role: string } | null;
    workspace?: { name: string } | null;
    deleted?: number;
    remaining?: number;
  } = {}) {
    const calls: string[] = [];
    const lockMembership = vi.fn(
      async (
        _query: TemplateStringsArray,
        _workspaceId: string,
        _userId: string,
      ) => {
        void _query;
        void _workspaceId;
        void _userId;
        calls.push("authorize-lock");
        return membership ? [membership] : [];
      },
    );
    const findWorkspace = vi.fn(async () => {
      calls.push("target-read");
      return workspace;
    });
    const deleteMany = vi.fn(async () => {
      calls.push("delete");
      return { count: deleted };
    });
    const count = vi.fn(async () => {
      calls.push("remaining-count");
      return remaining;
    });
    transaction.mockImplementation(async (callback) =>
      callback({
        $queryRaw: lockMembership,
        membership: { count },
        weddingWorkspace: { findFirst: findWorkspace, deleteMany },
      }),
    );
    return { calls, lockMembership, findWorkspace, deleteMany, count };
  }

  it("requires the exact normalized current name and CAS before deleting", async () => {
    const mocks = mockDeleteTransaction();

    await expect(
      deleteWorkspaceAction(
        "workspace_target",
        { status: "idle" },
        deleteFormData(),
      ),
    ).rejects.toThrow("REDIRECT:/dashboard?workspaceDeleted=1");

    expect(mocks.calls).toEqual([
      "authorize-lock",
      "target-read",
      "delete",
      "remaining-count",
    ]);
    const [query, workspaceId, userId] = mocks.lockMembership.mock.calls[0];
    expect(Array.from(query).join("?")).toContain('FROM "memberships"');
    expect(Array.from(query).join("?")).toContain("FOR UPDATE");
    expect(workspaceId).toBe("workspace_target");
    expect(userId).toBe("session_user");
    expect(mocks.findWorkspace).toHaveBeenCalledWith({
      where: {
        id: "workspace_target",
        updatedAt: new Date(originalUpdatedAt),
      },
      select: { name: true },
    });
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "workspace_target",
        updatedAt: new Date(originalUpdatedAt),
      },
    });
    expect(mocks.count).toHaveBeenCalledWith({
      where: { userId: "session_user" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(redirect).toHaveBeenCalledWith("/dashboard?workspaceDeleted=1");
  });

  it("rejects a confirmation that does not equal the current normalized name", async () => {
    const mocks = mockDeleteTransaction();

    await expect(
      deleteWorkspaceAction(
        "workspace_target",
        { status: "idle" },
        deleteFormData("另一場婚宴"),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "CONFIRMATION",
      message: "婚宴名稱不相符，工作區未刪除。",
    });
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it("returns the same stale result for a missing target or a lost delete race", async () => {
    const missing = mockDeleteTransaction({ workspace: null });
    await expect(
      deleteWorkspaceAction(
        "workspace_target",
        { status: "idle" },
        deleteFormData(),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(missing.deleteMany).not.toHaveBeenCalled();

    const raced = mockDeleteTransaction({ deleted: 0 });
    await expect(
      deleteWorkspaceAction(
        "workspace_target",
        { status: "idle" },
        deleteFormData(),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(raced.count).not.toHaveBeenCalled();
  });

  it("returns a generic stale result without reading a cross-tenant target", async () => {
    const mocks = mockDeleteTransaction({ membership: null });

    await expect(
      deleteWorkspaceAction(
        "workspace_foreign",
        { status: "idle" },
        deleteFormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "STALE",
      message: "婚宴工作區已被更新或不存在，請重新整理後再試。",
    });
    expect(mocks.findWorkspace).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("redirects safely to onboarding after deleting the user's last workspace", async () => {
    mockDeleteTransaction({ remaining: 0 });

    await expect(
      deleteWorkspaceAction(
        "workspace_target",
        { status: "idle" },
        deleteFormData(),
      ),
    ).rejects.toThrow("REDIRECT:/onboarding");
    expect(redirect).toHaveBeenCalledWith("/onboarding");
  });
});
