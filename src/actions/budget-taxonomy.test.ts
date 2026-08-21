import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const {
  requireCurrentUser,
  requireWorkspaceAccess,
  requireLockedWorkspaceAccess,
  create,
  findFirst,
  queryRaw,
  transaction,
  revalidatePath,
} = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  requireLockedWorkspaceAccess: vi.fn(),
  create: vi.fn(),
  findFirst: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/workspace-mutation-access", () => ({
  requireLockedWorkspaceAccess,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: transaction,
  },
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  createBudgetItemAction,
  createChildBudgetItemAction,
} from "./budget-items";

const idleState = { status: "idle" as const };

function expenseForm(taxonomyItemKey = "ITEM_WEDDING_VENUE") {
  const formData = new FormData();
  formData.set("name", "合成婚宴場地");
  formData.set("taxonomyItemKey", taxonomyItemKey);
  formData.set("category", "forged-internal-category");
  formData.set("plannedAmount", "120000");
  formData.set("actualAmount", "");
  formData.set("dueDate", "");
  formData.set("notes", "");
  return formData;
}

describe("budget taxonomy actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "PLANNER",
      workspace: { id: "workspace_1" },
    });
    requireLockedWorkspaceAccess.mockResolvedValue({
      role: "PLANNER",
      workspace: { id: "workspace_1" },
    });
    transaction.mockImplementation(async (operation) =>
      operation({
        budgetItem: {
          create,
          findFirst,
          updateMany: vi.fn(),
          deleteMany: vi.fn(),
        },
        $queryRaw: queryRaw,
        $executeRaw: vi.fn(),
      }),
    );
    findFirst.mockResolvedValue({ id: "fixed_ITEM_WEDDING_VENUE" });
    queryRaw.mockResolvedValue([
      { taxonomyKey: "ITEM_WEDDING_VENUE" },
      { taxonomyKey: "STAGE_PREPARATION_1_2_MONTHS" },
    ]);
    create.mockResolvedValue({ id: "child_1" });
  });

  it("places a top-level expense under its server-owned fixed item group", async () => {
    await expect(
      createBudgetItemAction("workspace_1", idleState, expenseForm()),
    ).resolves.toMatchObject({ status: "success" });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_1",
        parentId: "fixed_ITEM_WEDDING_VENUE",
        kind: "EXPENSE",
        category: "VENUE_CATERING",
        systemTaxonomyKey: null,
      }),
    });
  });

  it("authorizes, validates a same-workspace bound parent, then creates an EXPENSE child", async () => {
    const formData = expenseForm("ITEM_WEDDING_PHOTOGRAPHY");
    formData.set("parentId", "forged_parent");
    formData.set("workspaceId", "forged_workspace");

    await expect(
      createChildBudgetItemAction(
        "workspace_1",
        "parent_1",
        idleState,
        formData,
      ),
    ).resolves.toEqual({
      status: "success",
      message: "已在指定項目下新增花費。",
    });

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_1",
        parentId: "parent_1",
        kind: "EXPENSE",
        category: "VENUE_CATERING",
        systemTaxonomyKey: null,
      }),
    });
    expect(requireCurrentUser.mock.invocationCallOrder[0]).toBeLessThan(
      requireWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(requireWorkspaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      requireLockedWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(requireLockedWorkspaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      queryRaw.mock.invocationCallOrder[0],
    );
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      create.mock.invocationCallOrder[0],
    );
  });

  it.each(["missing", "cross-workspace"])(
    "returns the same non-disclosing parent error for %s parents",
    async () => {
      queryRaw.mockResolvedValueOnce([]);
      await expect(
        createChildBudgetItemAction(
          "workspace_1",
          "untrusted_parent",
          idleState,
          expenseForm(),
        ),
      ).resolves.toEqual({
        status: "error",
        code: "UNAVAILABLE",
        message: "指定的上層項目不存在或無法使用。",
      });
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("denies before form parsing or parent lookup", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );
    await expect(
      createChildBudgetItemAction(
        "workspace_1",
        "parent_1",
        idleState,
        expenseForm("forged"),
      ),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
