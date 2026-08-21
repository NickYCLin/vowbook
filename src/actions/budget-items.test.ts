import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const {
  requireCurrentUser,
  requireWorkspaceAccess,
  requireLockedWorkspaceAccess,
  create,
  createMany,
  findFirst,
  findMany,
  workspaceFindFirst,
  updateMany,
  deleteMany,
  executeRaw,
  queryRaw,
  transaction,
  revalidatePath,
} = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  requireLockedWorkspaceAccess: vi.fn(),
  create: vi.fn(),
  createMany: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  workspaceFindFirst: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  executeRaw: vi.fn(),
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
    budgetItem: {
      create,
      createMany,
      findFirst,
      findMany,
      updateMany,
      deleteMany,
    },
    weddingWorkspace: { findFirst: workspaceFindFirst },
    $executeRaw: executeRaw,
    $transaction: transaction,
  },
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  addBudgetEngagementSuggestionsAction,
  addBudgetPreparationSuggestionsAction,
  changeBudgetItemBookingStatusAction,
  createChildBudgetItemAction,
  createBudgetGroupAction,
  createBudgetItemAction,
  deleteBudgetGroupSubtreeAction,
  deleteBudgetItemAction,
  dissolveBudgetGroupAction,
  moveBudgetItemAction,
  resetBudgetDataAction,
  updateBudgetGroupAction,
  updateBudgetItemAction,
} from "./budget-items";
import {
  summarizeBudgetResetSnapshot,
  summarizeBudgetSubtreeSnapshot,
} from "@/lib/budget-reset-snapshot";

const idleState = { status: "idle" as const };
const budgetPath = "/workspaces/workspace_1/budget";

function validBudgetFormData(expectedVersion = "0") {
  const formData = new FormData();
  formData.set("name", "  婚宴   場地  ");
  formData.set("taxonomyItemKey", "ITEM_WEDDING_VENUE");
  formData.set("category", "VENUE_CATERING");
  formData.set("plannedAmount", "120000");
  formData.set("actualAmount", "118000");
  formData.set("dueDate", "2028-02-29");
  formData.set("notes", "  含訂金  ");
  formData.set("expectedVersion", expectedVersion);
  return formData;
}

function engagementSuggestionFormData(...keys: string[]) {
  const formData = new FormData();
  keys.forEach((key) => formData.append("suggestionKey", key));
  return formData;
}

function versionFormData(expectedVersion = "0") {
  const formData = new FormData();
  formData.set("expectedVersion", expectedVersion);
  return formData;
}

function directChildSetHash(ids: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify(ids.toSorted()))
    .digest("hex");
}

function dissolveFormData(expectedVersion: string, directChildIds: string[]) {
  const formData = versionFormData(expectedVersion);
  formData.set(
    "expectedDirectChildSetHash",
    directChildSetHash(directChildIds),
  );
  return formData;
}

function subtreeDeleteFormData({
  confirmationName = "  婚紗   方案  ",
  expectedVersion = "4",
  token,
}: {
  confirmationName?: string;
  expectedVersion?: string;
  token: string;
}) {
  const formData = versionFormData(expectedVersion);
  formData.set("expectedSubtreeSnapshotToken", token);
  formData.set("confirmationName", confirmationName);
  return formData;
}

function groupFormData(name = "  婚紗   方案  ", expectedVersion?: string) {
  const formData = new FormData();
  formData.set("name", name);
  formData.set("taxonomyItemKey", "ITEM_WEDDING_VENUE");
  formData.set("category", "VENUE_CATERING");
  if (expectedVersion !== undefined) {
    formData.set("expectedVersion", expectedVersion);
  }
  return formData;
}

function statusFormData(
  bookingStatus: "PLANNING" | "BOOKED_BALANCE_DUE" | "PAID" | string,
  expectedVersion = "0",
) {
  const formData = versionFormData(expectedVersion);
  formData.set("bookingStatus", bookingStatus);
  return formData;
}

function resetBudgetFormData({
  confirmationName = "我們的婚宴",
  preparedSnapshot = "READY",
  token,
}: {
  confirmationName?: string;
  preparedSnapshot?: string;
  token: string;
}) {
  const formData = new FormData();
  formData.set("confirmationName", confirmationName);
  formData.set("preparedSnapshot", preparedSnapshot);
  formData.set("expectedResetSnapshotToken", token);
  return formData;
}

const resetRows = [
  {
    id: "manual_group",
    version: 2,
    source: "MANUAL" as const,
    attachments: [],
  },
  {
    id: "notion_expense",
    version: 7,
    source: "NOTION" as const,
    attachments: [{ id: "attachment_b" }, { id: "attachment_a" }],
  },
];

const subtreeRows = [
  {
    id: "outside_group",
    parentId: "fixed_ITEM_WEDDING_VENUE",
    name: "其他方案",
    kind: "GROUP" as const,
    version: 8,
    source: "MANUAL" as const,
    systemTaxonomyKey: null,
    attachments: [],
  },
  {
    id: "subtree_root",
    parentId: "fixed_ITEM_PRE_WEDDING_PHOTOGRAPHY",
    name: "婚紗 方案",
    kind: "GROUP" as const,
    version: 4,
    source: "MANUAL" as const,
    systemTaxonomyKey: null,
    attachments: [{ id: "attachment_root" }],
  },
  {
    id: "subtree_child_group",
    parentId: "subtree_root",
    name: "拍攝延伸",
    kind: "GROUP" as const,
    version: 5,
    source: "MANUAL" as const,
    systemTaxonomyKey: null,
    attachments: [],
  },
  {
    id: "subtree_grandchild",
    parentId: "subtree_child_group",
    name: "拍攝用小白鞋",
    kind: "EXPENSE" as const,
    version: 6,
    source: "NOTION" as const,
    systemTaxonomyKey: null,
    attachments: [{ id: "attachment_b" }, { id: "attachment_a" }],
  },
  {
    id: "subtree_child_expense",
    parentId: "subtree_root",
    name: "攝影外拍服務",
    kind: "EXPENSE" as const,
    version: 7,
    source: "MANUAL" as const,
    systemTaxonomyKey: null,
    attachments: [],
  },
];

const subtreeOnlyRows = subtreeRows.filter((row) => row.id !== "outside_group");

describe("budget item server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-03-01T08:09:10.000Z"));
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "PLANNER",
      workspace: { id: "workspace_1" },
    });
    requireLockedWorkspaceAccess.mockResolvedValue({
      role: "PLANNER",
      workspace: { id: "workspace_1" },
    });
    create.mockResolvedValue({ id: "budget_1" });
    createMany.mockResolvedValue({ count: 2 });
    findFirst.mockImplementation((args) =>
      args?.where?.systemTaxonomyKey
        ? Promise.resolve({ id: `fixed_${args.where.systemTaxonomyKey}` })
        : Promise.resolve({
            bookingStatus: "PLANNING",
            parentId: "fixed_ITEM_WEDDING_VENUE",
            category: "VENUE_CATERING",
            children: [],
          }),
    );
    findMany.mockResolvedValue([]);
    workspaceFindFirst.mockResolvedValue({ name: "我們的婚宴" });
    updateMany.mockResolvedValue({ count: 1 });
    deleteMany.mockResolvedValue({ count: 1 });
    executeRaw.mockResolvedValue(1);
    queryRaw.mockImplementation((query) => {
      const sql = Array.from(query?.strings ?? []).join(" ");
      return Promise.resolve(
        sql.includes('WITH RECURSIVE "ancestors"')
          ? [
              { taxonomyKey: "ITEM_WEDDING_VENUE" },
              { taxonomyKey: "STAGE_PREPARATION_1_2_MONTHS" },
            ]
          : [{ parentId: null }],
      );
    });
    transaction.mockImplementation(async (callback) =>
      callback({
        $executeRaw: executeRaw,
        $queryRaw: queryRaw,
        budgetItem: {
          create,
          createMany,
          findFirst,
          findMany,
          updateMany,
          deleteMany,
        },
        weddingWorkspace: { findFirst: workspaceFindFirst },
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("adds only selected Drive engagement suggestions under server-owned taxonomy parents", async () => {
    const formData = engagementSuggestionFormData(
      "ENGAGEMENT_GROOM_LARGE_BETROTHAL_GIFT",
      "ENGAGEMENT_BRIDE_ACCEPTANCE_GIFT",
    );
    formData.set("workspaceId", "workspace_attacker");
    formData.set("parentId", "forged_parent");
    formData.set("category", "OTHER_PENDING");
    formData.set("name", "forged_name");
    formData.set("plannedAmount", "999999");

    await expect(
      addBudgetEngagementSuggestionsAction(
        "workspace_1",
        idleState,
        formData,
      ),
    ).resolves.toEqual({
      status: "success",
      message: "已新增 2 筆文定建議項目。",
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_1",
        kind: "GROUP",
        systemTaxonomyKey: "ITEM_ENGAGEMENT_GROOM",
        parent: {
          workspaceId: "workspace_1",
          systemTaxonomyKey: "STAGE_ENGAGEMENT_CEREMONY",
        },
      },
      select: { id: true },
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_1",
        kind: "GROUP",
        systemTaxonomyKey: "ITEM_ENGAGEMENT_BRIDE",
        parent: {
          workspaceId: "workspace_1",
          systemTaxonomyKey: "STAGE_ENGAGEMENT_CEREMONY",
        },
      },
      select: { id: true },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          workspaceId: "workspace_1",
          parentId: "fixed_ITEM_ENGAGEMENT_GROOM",
          suggestionKey: "ENGAGEMENT_GROOM_LARGE_BETROTHAL_GIFT",
          name: "大聘",
        }),
        expect.objectContaining({
          workspaceId: "workspace_1",
          parentId: "fixed_ITEM_ENGAGEMENT_BRIDE",
          suggestionKey: "ENGAGEMENT_BRIDE_ACCEPTANCE_GIFT",
          name: "接聘禮",
        }),
      ],
      skipDuplicates: true,
    });
    const writtenRows = createMany.mock.calls[0][0].data;
    expect(
      writtenRows.every(
        (row: Record<string, unknown>) =>
        row.source === "MANUAL" &&
        row.kind === "EXPENSE" &&
        row.category === "DECOR_GIFTS" &&
        row.plannedAmount === 0 &&
        row.actualAmount === null &&
        row.bookingStatus === "PLANNING" &&
        row.systemTaxonomyKey === null &&
          row.relatedTaxonomyItemKey === null,
      ),
    ).toBe(true);
    expect(requireCurrentUser.mock.invocationCallOrder[0]).toBeLessThan(
      requireWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(requireWorkspaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      createMany.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ["empty", []],
    ["unknown", ["ENGAGEMENT_GROOM_NOT_REAL"]],
    [
      "duplicate",
      [
        "ENGAGEMENT_GROOM_LARGE_BETROTHAL_GIFT",
        "ENGAGEMENT_GROOM_LARGE_BETROTHAL_GIFT",
      ],
    ],
  ])("rejects %s engagement suggestion keys before opening a transaction", async (
    _label,
    keys,
  ) => {
    await expect(
      addBudgetEngagementSuggestionsAction(
        "workspace_1",
        idleState,
        engagementSuggestionFormData(...keys),
      ),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });

    expect(transaction).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it("checks edit membership before parsing engagement suggestions", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );

    await expect(
      addBudgetEngagementSuggestionsAction(
        "workspace_1",
        idleState,
        new FormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "FORBIDDEN",
      message: "無權存取此婚宴工作區。",
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it.each([
    [1, "已新增 1 筆文定建議項目；其餘已存在。"],
    [0, "所選文定建議項目已存在。"],
  ])("keeps repeat engagement submissions idempotent when %i rows are new", async (
    count,
    message,
  ) => {
    createMany.mockResolvedValueOnce({ count });

    await expect(
      addBudgetEngagementSuggestionsAction(
        "workspace_1",
        idleState,
        engagementSuggestionFormData(
          "ENGAGEMENT_GROOM_LARGE_BETROTHAL_GIFT",
          "ENGAGEMENT_BRIDE_ACCEPTANCE_GIFT",
        ),
      ),
    ).resolves.toEqual({ status: "success", message });
    expect(revalidatePath).toHaveBeenCalledWith(budgetPath);
  });

  it("fails closed when an engagement taxonomy parent is missing", async () => {
    findFirst.mockResolvedValueOnce(null);

    await expect(
      addBudgetEngagementSuggestionsAction(
        "workspace_1",
        idleState,
        engagementSuggestionFormData(
          "ENGAGEMENT_GROOM_LARGE_BETROTHAL_GIFT",
        ),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "VALIDATION",
      message: "指定的品項分類不存在或無法使用。",
    });
    expect(createMany).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a fixed engagement error without leaking database details", async () => {
    createMany.mockRejectedValueOnce(new Error("postgres://secret"));

    await expect(
      addBudgetEngagementSuggestionsAction(
        "workspace_1",
        idleState,
        engagementSuggestionFormData(
          "ENGAGEMENT_GROOM_LARGE_BETROTHAL_GIFT",
        ),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法新增文定建議項目，請稍後再試。",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("adds selected common wedding suggestions under server-owned taxonomy parents", async () => {
    createMany.mockResolvedValueOnce({ count: 3 });
    const formData = engagementSuggestionFormData(
      "PREPARATION_PROPOSAL_FAMILY_MEAL",
      "PREPARATION_PRE_WEDDING_PHOTOGRAPHY_RETOUCHING",
      "PREPARATION_WEDDING_SHOES_BRIDE",
    );
    formData.set("workspaceId", "workspace_attacker");
    formData.set("parentId", "forged_parent");
    formData.set("name", "forged_name");
    formData.set("plannedAmount", "999999");

    await expect(
      addBudgetPreparationSuggestionsAction(
        "workspace_1",
        idleState,
        formData,
      ),
    ).resolves.toEqual({
      status: "success",
      message: "已新增 3 筆常見婚禮建議項目。",
    });

    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          workspaceId: "workspace_1",
          parentId: "fixed_ITEM_PROPOSAL",
          suggestionKey: "PREPARATION_PROPOSAL_FAMILY_MEAL",
          name: "兩家人見面餐費",
          category: "RINGS_KEEPSAKES",
        }),
        expect.objectContaining({
          parentId: "fixed_ITEM_PRE_WEDDING_PHOTOGRAPHY",
          suggestionKey:
            "PREPARATION_PRE_WEDDING_PHOTOGRAPHY_RETOUCHING",
          name: "精修",
          category: "PHOTOGRAPHY_VIDEO",
        }),
        expect.objectContaining({
          parentId: "fixed_ITEM_WEDDING_SHOES",
          suggestionKey: "PREPARATION_WEDDING_SHOES_BRIDE",
          name: "新娘婚鞋",
          category: "ATTIRE_STYLING",
        }),
      ],
      skipDuplicates: true,
    });
    const writtenRows = createMany.mock.calls[0][0].data;
    expect(
      writtenRows.every(
        (row: Record<string, unknown>) =>
          row.source === "MANUAL" &&
          row.kind === "EXPENSE" &&
          row.plannedAmount === 0 &&
          row.actualAmount === null &&
          row.bookingStatus === "PLANNING" &&
          row.systemTaxonomyKey === null &&
          row.relatedTaxonomyItemKey === null,
      ),
    ).toBe(true);
    expect(requireWorkspaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      requireLockedWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(requireLockedWorkspaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      createMany.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ["empty", []],
    ["unknown", ["PREPARATION_NOT_REAL"]],
    [
      "duplicate",
      [
        "PREPARATION_WEDDING_SHOES_BRIDE",
        "PREPARATION_WEDDING_SHOES_BRIDE",
      ],
    ],
  ])("rejects %s common wedding suggestion keys before opening a transaction", async (
    _label,
    keys,
  ) => {
    await expect(
      addBudgetPreparationSuggestionsAction(
        "workspace_1",
        idleState,
        engagementSuggestionFormData(...keys),
      ),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
    expect(transaction).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it("checks edit membership before parsing common wedding suggestions", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );
    await expect(
      addBudgetPreparationSuggestionsAction(
        "workspace_1",
        idleState,
        new FormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "FORBIDDEN",
      message: "無權存取此婚宴工作區。",
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    [1, "已新增 1 筆常見婚禮建議項目；其餘已存在。"],
    [0, "所選常見婚禮建議項目已存在。"],
  ])("keeps repeat common wedding submissions idempotent when %i rows are new", async (
    count,
    message,
  ) => {
    createMany.mockResolvedValueOnce({ count });
    await expect(
      addBudgetPreparationSuggestionsAction(
        "workspace_1",
        idleState,
        engagementSuggestionFormData(
          "PREPARATION_PRE_WEDDING_PHOTOGRAPHY_RETOUCHING",
          "PREPARATION_WEDDING_SHOES_BRIDE",
        ),
      ),
    ).resolves.toEqual({ status: "success", message });
    expect(revalidatePath).toHaveBeenCalledWith(budgetPath);
  });

  it("fails closed when a common wedding taxonomy parent is missing", async () => {
    findFirst.mockResolvedValueOnce(null);
    await expect(
      addBudgetPreparationSuggestionsAction(
        "workspace_1",
        idleState,
        engagementSuggestionFormData(
          "PREPARATION_PRE_WEDDING_PHOTOGRAPHY_RETOUCHING",
        ),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "VALIDATION",
      message: "指定的品項分類不存在或無法使用。",
    });
    expect(createMany).not.toHaveBeenCalled();
  });

  it("returns a fixed common wedding error without leaking database details", async () => {
    createMany.mockRejectedValueOnce(new Error("postgres://secret"));
    await expect(
      addBudgetPreparationSuggestionsAction(
        "workspace_1",
        idleState,
        engagementSuggestionFormData(
          "PREPARATION_WEDDING_SHOES_BRIDE",
        ),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法新增常見婚禮建議項目，請稍後再試。",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("creates an unpaid item only after edit authorization and ignores forged fields", async () => {
    const formData = validBudgetFormData();
    formData.set("workspaceId", "workspace_attacker");
    formData.set("userId", "attacker");
    formData.set("role", "OWNER");
    formData.set("paid", "true");
    formData.set("paidAt", "2020-01-01T00:00:00.000Z");
    formData.set("bookingStatus", "PAID");
    formData.set("parentId", "forged_parent");
    formData.set("source", "NOTION");
    formData.set("externalId", "a0000000-0000-4000-8000-000000000001");
    formData.set("sourceHash", "a".repeat(64));
    formData.set("sourceOrder", "1");
    formData.set("version", "99");
    formData.set("createdAt", "2020-01-01T00:00:00.000Z");
    formData.set("category", "OTHER_PENDING");

    await expect(
      createBudgetItemAction("workspace_1", idleState, formData),
    ).resolves.toEqual({ status: "success", message: "已新增花費項目。" });

    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_1",
        kind: "GROUP",
        systemTaxonomyKey: "ITEM_WEDDING_VENUE",
        parent: {
          workspaceId: "workspace_1",
          systemTaxonomyKey: "STAGE_PREPARATION_1_2_MONTHS",
        },
      },
      select: { id: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1",
        parentId: "fixed_ITEM_WEDDING_VENUE",
        kind: "EXPENSE",
        source: "MANUAL",
        externalId: null,
        sourceHash: null,
        sourceOrder: null,
        name: "婚宴 場地",
        category: "VENUE_CATERING",
        systemTaxonomyKey: null,
        relatedTaxonomyItemKey: null,
        plannedAmount: 120000,
        actualAmount: null,
        dueDate: new Date("2028-02-29T00:00:00.000Z"),
        notes: "含訂金",
        bookingStatus: "PLANNING",
        depositAmount: null,
        balanceAmount: null,
        additionalAmount: null,
        estimatedRange: null,
        candidateVendors: null,
        confirmedVendor: null,
        vendorContact: null,
        primaryContact: null,
        paid: false,
        paidAt: null,
      },
    });
    expect(requireCurrentUser.mock.invocationCallOrder[0]).toBeLessThan(
      requireWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(requireWorkspaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      create.mock.invocationCallOrder[0],
    );
    expect(revalidatePath).toHaveBeenCalledWith(budgetPath);
  });

  it("creates an expense with an optional related Drive taxonomy item", async () => {
    const formData = validBudgetFormData();
    formData.set(
      "relatedTaxonomyItemKey",
      "ITEM_WEDDING_PHOTOGRAPHY",
    );

    await expect(
      createBudgetItemAction("workspace_1", idleState, formData),
    ).resolves.toMatchObject({ status: "success" });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category: "VENUE_CATERING",
        relatedTaxonomyItemKey: "ITEM_WEDDING_PHOTOGRAPHY",
      }),
    });
  });

  it.each([
    "STAGE_PREPARATION_1_2_MONTHS",
    "INTERNAL_UNCLASSIFIED_ITEM",
    "ITEM_WEDDING_VENUE",
    "ITEM_NOT_REAL",
  ])(
    "rejects an invalid or non-distinct related taxonomy key: %s",
    async (relatedKey) => {
      const formData = validBudgetFormData();
      formData.set("relatedTaxonomyItemKey", relatedKey);

      await expect(
        createBudgetItemAction("workspace_1", idleState, formData),
      ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });

      expect(transaction).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("derives a child expense taxonomy from same-workspace ancestors and ignores forged taxonomy fields", async () => {
    const formData = validBudgetFormData();
    formData.set("taxonomyItemKey", "ITEM_WEDDING_PHOTOGRAPHY");
    formData.set(
      "relatedTaxonomyItemKey",
      "ITEM_WEDDING_PHOTOGRAPHY",
    );
    formData.set("category", "OTHER_PENDING");

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

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_1",
        parentId: "parent_1",
        category: "VENUE_CATERING",
        systemTaxonomyKey: null,
        relatedTaxonomyItemKey: "ITEM_WEDDING_PHOTOGRAPHY",
      }),
    });
  });

  it("validates a child relation against its authoritative ancestor taxonomy", async () => {
    const formData = validBudgetFormData();
    formData.set("taxonomyItemKey", "ITEM_WEDDING_PHOTOGRAPHY");
    formData.set("relatedTaxonomyItemKey", "ITEM_WEDDING_VENUE");

    await expect(
      createChildBudgetItemAction(
        "workspace_1",
        "parent_1",
        idleState,
        formData,
      ),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });

    expect(queryRaw).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("does not allow adding an ordinary child directly below a fixed stage", async () => {
    queryRaw.mockResolvedValueOnce([
      { taxonomyKey: "STAGE_PREPARATION_1_2_MONTHS" },
    ]);

    await expect(
      createChildBudgetItemAction(
        "workspace_1",
        "fixed_stage",
        idleState,
        validBudgetFormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "指定的上層項目不存在或無法使用。",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("does not expose the internal unclassified item as a writable classification or parent", async () => {
    const topLevelForm = validBudgetFormData();
    topLevelForm.set("taxonomyItemKey", "INTERNAL_UNCLASSIFIED_ITEM");
    await expect(
      createBudgetItemAction("workspace_1", idleState, topLevelForm),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });

    queryRaw.mockResolvedValueOnce([
      { taxonomyKey: "INTERNAL_UNCLASSIFIED_ITEM" },
      { taxonomyKey: "INTERNAL_UNCLASSIFIED_STAGE" },
    ]);
    await expect(
      createChildBudgetItemAction(
        "workspace_1",
        "legacy_parent",
        idleState,
        validBudgetFormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "指定的上層項目不存在或無法使用。",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a neutral structural GROUP at the root and ignores forged expense fields", async () => {
    const formData = groupFormData();
    formData.set("category", "VENUE_CATERING");
    formData.set("plannedAmount", "999999");
    formData.set("actualAmount", "888888");
    formData.set("notes", "不可寫入群組");
    formData.set("paid", "true");
    formData.set("bookingStatus", "PAID");
    formData.set("parentId", "forged_parent");
    formData.set("source", "NOTION");

    await expect(
      createBudgetGroupAction("workspace_1", null, idleState, formData),
    ).resolves.toEqual({ status: "success", message: "已建立群組。" });

    expect(create).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1",
        parentId: "fixed_ITEM_WEDDING_VENUE",
        kind: "GROUP",
        source: "MANUAL",
        externalId: null,
        sourceHash: null,
        sourceOrder: null,
        name: "婚紗 方案",
        category: null,
        systemTaxonomyKey: null,
        legacyCategory: null,
        plannedAmount: 0,
        actualAmount: null,
        dueDate: null,
        notes: null,
        paid: false,
        paidAt: null,
        bookingStatus: "PLANNING",
        depositAmount: null,
        balanceAmount: null,
        additionalAmount: null,
        estimatedRange: null,
        candidateVendors: null,
        confirmedVendor: null,
        vendorContact: null,
        primaryContact: null,
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(budgetPath);
  });

  it("creates a nested neutral GROUP under the server-bound same-workspace parent", async () => {
    await expect(
      createBudgetGroupAction(
        "workspace_1",
        "parent_1",
        idleState,
        groupFormData("儀式"),
      ),
    ).resolves.toEqual({ status: "success", message: "已建立群組。" });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_1",
        parentId: "parent_1",
        name: "儀式",
        kind: "GROUP",
        category: null,
        plannedAmount: 0,
      }),
    });
  });

  it("rejects an invalid or cross-workspace GROUP parent with a safe error", async () => {
    create.mockRejectedValueOnce({ code: "P2003", meta: "tenant secret" });

    await expect(
      createBudgetGroupAction(
        "workspace_1",
        "parent_from_workspace_2",
        idleState,
        groupFormData("偽造巢狀群組"),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "指定的上層項目不存在或無法使用。",
    });
    expect(revalidatePath).not.toHaveBeenCalled();

    await expect(
      createBudgetGroupAction(
        "workspace_1",
        " ",
        idleState,
        groupFormData(),
      ),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
    expect(create).toHaveBeenCalledOnce();
  });

  it("renames only a tenant-scoped GROUP with optimistic version CAS", async () => {
    const formData = groupFormData("  完整   方案  ", "7");
    formData.set("category", "OTHER_PENDING");
    formData.set("plannedAmount", "123");
    formData.set("parentId", "forged_parent");

    await expect(
      updateBudgetGroupAction(
        "workspace_1",
        "group_1",
        idleState,
        formData,
      ),
    ).resolves.toEqual({ status: "success", message: "已更新群組。" });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "group_1",
        workspaceId: "workspace_1",
        version: 7,
        kind: "GROUP",
        systemTaxonomyKey: null,
      },
      data: { name: "完整 方案", version: { increment: 1 } },
    });
  });

  it("returns STALE for a changed, missing, EXPENSE, or cross-workspace GROUP", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      updateBudgetGroupAction(
        "workspace_1",
        "group_from_workspace_2",
        idleState,
        groupFormData("偽造更新", "3"),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "STALE",
      message: "資料已更新或不存在，請重新整理後再試。",
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "group_from_workspace_2",
          workspaceId: "workspace_1",
          version: 3,
          kind: "GROUP",
          systemTaxonomyKey: null,
        },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(budgetPath);
  });

  it.each(["OWNER", "PARTNER", "PLANNER"])(
    "allows the %s editor role returned by the membership guard",
    async (role) => {
      requireWorkspaceAccess.mockResolvedValueOnce({ role, workspace: {} });
      await expect(
        createBudgetItemAction(
          "workspace_1",
          idleState,
          validBudgetFormData(),
        ),
      ).resolves.toMatchObject({ status: "success" });
      expect(create).toHaveBeenCalledOnce();
    },
  );

  it("denies VIEWER or outsider before parsing or touching BudgetItem data", async () => {
    requireWorkspaceAccess.mockRejectedValue(new WorkspaceAccessDeniedError());

    const calls = [
      createBudgetGroupAction(
        "workspace_1",
        null,
        idleState,
        groupFormData(),
      ),
      createBudgetItemAction("workspace_1", idleState, new FormData()),
      updateBudgetGroupAction(
        "workspace_1",
        "group_1",
        idleState,
        groupFormData("群組", "0"),
      ),
      updateBudgetItemAction(
        "workspace_1",
        "budget_1",
        idleState,
        new FormData(),
      ),
      changeBudgetItemBookingStatusAction(
        "workspace_1",
        "budget_1",
        idleState,
        statusFormData("forged"),
      ),
      deleteBudgetItemAction(
        "workspace_1",
        "budget_1",
        idleState,
        new FormData(),
      ),
      moveBudgetItemAction(
        "workspace_1",
        "budget_1",
        idleState,
        new FormData(),
      ),
      dissolveBudgetGroupAction(
        "workspace_1",
        "group_1",
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
    expect(executeRaw).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not swallow a current-user redirect", async () => {
    const redirectError = new Error("NEXT_REDIRECT");
    requireCurrentUser.mockRejectedValueOnce(redirectError);

    await expect(
      createBudgetItemAction("workspace_1", idleState, new FormData()),
    ).rejects.toBe(redirectError);
    expect(requireWorkspaceAccess).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("validates details and version only after authorization", async () => {
    const invalidAmount = validBudgetFormData();
    invalidAmount.set("plannedAmount", "1.5");

    await expect(
      createBudgetItemAction("workspace_1", idleState, invalidAmount),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
    await expect(
      updateBudgetItemAction(
        "workspace_1",
        "budget_1",
        idleState,
        validBudgetFormData("9007199254740992"),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "VALIDATION",
      message: "版本資訊無效，請重新整理後再試。",
    });
    expect(requireWorkspaceAccess).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each(["", "-1", "1.5", "1e2", "NaN", "2147483648"])(
    "rejects an invalid expectedVersion: %s",
    async (expectedVersion) => {
      await expect(
        deleteBudgetItemAction(
          "workspace_1",
          "budget_1",
          idleState,
          versionFormData(expectedVersion),
        ),
      ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
      await expect(
        dissolveBudgetGroupAction(
          "workspace_1",
          "group_1",
          idleState,
          versionFormData(expectedVersion),
        ),
      ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
      expect(deleteMany).not.toHaveBeenCalled();
      expect(executeRaw).not.toHaveBeenCalled();
    },
  );

  it("updates details with id + workspace + version CAS without changing payment state", async () => {
    await expect(
      updateBudgetItemAction(
        "workspace_1",
        "budget_1",
        idleState,
        validBudgetFormData("7"),
      ),
    ).resolves.toEqual({ status: "success", message: "已更新花費項目。" });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "budget_1",
        workspaceId: "workspace_1",
        version: 7,
        kind: "EXPENSE",
      },
      data: {
        name: "婚宴 場地",
        category: "VENUE_CATERING",
        plannedAmount: 120000,
        actualAmount: null,
        dueDate: new Date("2028-02-29T00:00:00.000Z"),
        notes: "含訂金",
        depositAmount: null,
        balanceAmount: null,
        additionalAmount: null,
        estimatedRange: null,
        candidateVendors: null,
        confirmedVendor: null,
        vendorContact: null,
        primaryContact: null,
        relatedTaxonomyItemKey: null,
        version: { increment: 1 },
        parentId: "fixed_ITEM_WEDDING_VENUE",
      },
    });
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty(
      "bookingStatus",
    );
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty("paid");
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty("paidAt");
  });

  it("updates the optional related taxonomy item within the existing CAS", async () => {
    const formData = validBudgetFormData("7");
    formData.set(
      "relatedTaxonomyItemKey",
      "ITEM_WEDDING_PHOTOGRAPHY",
    );

    await expect(
      updateBudgetItemAction(
        "workspace_1",
        "budget_1",
        idleState,
        formData,
      ),
    ).resolves.toMatchObject({ status: "success" });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ version: 7 }),
        data: expect.objectContaining({
          relatedTaxonomyItemKey: "ITEM_WEDDING_PHOTOGRAPHY",
          version: { increment: 1 },
        }),
      }),
    );
  });

  it("rejects an update relation equal to the selected taxonomy before CAS", async () => {
    const formData = validBudgetFormData("7");
    formData.set("relatedTaxonomyItemKey", "ITEM_WEDDING_VENUE");

    await expect(
      updateBudgetItemAction(
        "workspace_1",
        "budget_1",
        idleState,
        formData,
      ),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });

    expect(transaction).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("moves a leaf expense to the selected fixed item and derives its legacy category", async () => {
    const formData = validBudgetFormData("8");
    formData.set("taxonomyItemKey", "ITEM_WEDDING_PHOTOGRAPHY");
    formData.set("category", "VENUE_CATERING");

    await expect(
      updateBudgetItemAction(
        "workspace_1",
        "budget_1",
        idleState,
        formData,
      ),
    ).resolves.toMatchObject({ status: "success" });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "budget_1",
        workspaceId: "workspace_1",
        version: 8,
        kind: "EXPENSE",
      },
      data: expect.objectContaining({
        parentId: "fixed_ITEM_WEDDING_PHOTOGRAPHY",
        category: "PHOTOGRAPHY_VIDEO",
      }),
    });
  });

  it("lets a legacy leaf leave the internal unclassified subtree for a Drive item", async () => {
    queryRaw.mockResolvedValueOnce([
      { taxonomyKey: "INTERNAL_UNCLASSIFIED_ITEM" },
      { taxonomyKey: "INTERNAL_UNCLASSIFIED_STAGE" },
    ]);
    findFirst.mockResolvedValueOnce({
      bookingStatus: "PLANNING",
      parentId: "legacy_parent",
      category: "TRANSPORT_LODGING",
      children: [],
    });
    const formData = validBudgetFormData("8");
    formData.set("taxonomyItemKey", "ITEM_WEDDING_VENUE");

    await expect(
      updateBudgetItemAction(
        "workspace_1",
        "legacy_leaf",
        idleState,
        formData,
      ),
    ).resolves.toMatchObject({ status: "success" });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "legacy_leaf" }),
        data: expect.objectContaining({
          parentId: "fixed_ITEM_WEDDING_VENUE",
          category: "VENUE_CATERING",
        }),
      }),
    );
  });

  it("rejects changing taxonomy for an expense that still has children", async () => {
    findFirst.mockResolvedValueOnce({
      bookingStatus: "PLANNING",
      parentId: "fixed_ITEM_WEDDING_VENUE",
      category: "VENUE_CATERING",
      children: [{ id: "child_1" }],
    });
    const formData = validBudgetFormData("8");
    formData.set("taxonomyItemKey", "ITEM_WEDDING_PHOTOGRAPHY");

    await expect(
      updateBudgetItemAction(
        "workspace_1",
        "budget_1",
        idleState,
        formData,
      ),
    ).resolves.toEqual({
      status: "error",
      code: "VALIDATION",
      message:
        "有下層項目的花費無法直接變更品項分類，請先整理下層項目。",
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["PLANNING", null],
    ["BOOKED_BALANCE_DUE", 12000],
    ["PAID", 46500],
  ] as const)(
    "derives actual amount from authoritative %s status and ignores forged form payment fields",
    async (bookingStatus, expectedActualAmount) => {
      findFirst.mockResolvedValueOnce({
        bookingStatus,
        parentId: "fixed_ITEM_WEDDING_VENUE",
        category: "VENUE_CATERING",
      });
      const formData = validBudgetFormData("11");
      formData.set("actualAmount", "999999");
      formData.set("bookingStatus", "PAID-ish");
      formData.set("plannedAmount", "888888");
      formData.set("depositAmount", "12000");
      formData.set("balanceAmount", "34000");
      formData.set("additionalAmount", "500");

      await expect(
        updateBudgetItemAction(
          "workspace_1",
          "budget_1",
          idleState,
          formData,
        ),
      ).resolves.toMatchObject({ status: "success" });

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          id: "budget_1",
          workspaceId: "workspace_1",
          version: 11,
          kind: "EXPENSE",
        },
        select: {
          bookingStatus: true,
          parentId: true,
          category: true,
          children: { take: 1, select: { id: true } },
        },
      });
      expect(updateMany).toHaveBeenCalledWith({
        where: {
          id: "budget_1",
          workspaceId: "workspace_1",
          version: 11,
          kind: "EXPENSE",
        },
        data: expect.objectContaining({
          plannedAmount: 46500,
          depositAmount: 12000,
          actualAmount: expectedActualAmount,
          version: { increment: 1 },
        }),
      });
      expect(updateMany.mock.calls[0][0].data).not.toHaveProperty(
        "bookingStatus",
      );
    },
  );

  it("returns STALE without updating when the authoritative versioned row is missing", async () => {
    findFirst.mockResolvedValueOnce(null);

    await expect(
      updateBudgetItemAction(
        "workspace_1",
        "budget_missing",
        idleState,
        validBudgetFormData("3"),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "STALE",
      message: "資料已更新或不存在，請重新整理後再試。",
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "budget_missing",
        workspaceId: "workspace_1",
        version: 3,
        kind: "EXPENSE",
      },
      select: {
        bookingStatus: true,
        parentId: true,
        category: true,
        children: { take: 1, select: { id: true } },
      },
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(budgetPath);
  });

  it("updates every rich editable field while deriving planned amount and ignoring hierarchy metadata", async () => {
    const formData = validBudgetFormData("11");
    formData.set("plannedAmount", "999999");
    formData.set("depositAmount", "12000");
    formData.set("balanceAmount", "34000");
    formData.set("additionalAmount", "500");
    formData.set("estimatedRange", "  NT$40,000 ～ NT$60,000  ");
    formData.set("candidateVendors", "  合成候選廠商  ");
    formData.set("confirmedVendor", "  合成確認廠商  ");
    formData.set("vendorContact", "  synthetic-contact@example.test  ");
    formData.set("primaryContact", "PARTNER_B");
    formData.set("bookingStatus", "PAID");
    formData.set("parentId", "forged_parent");
    formData.set("source", "NOTION");
    formData.set("externalId", "a0000000-0000-4000-8000-000000000001");
    formData.set("sourceHash", "a".repeat(64));
    formData.set("sourceOrder", "1");

    await expect(
      updateBudgetItemAction(
        "workspace_1",
        "budget_1",
        idleState,
        formData,
      ),
    ).resolves.toMatchObject({ status: "success" });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "budget_1",
        workspaceId: "workspace_1",
        version: 11,
        kind: "EXPENSE",
      },
      data: expect.objectContaining({
        plannedAmount: 46500,
        depositAmount: 12000,
        balanceAmount: 34000,
        additionalAmount: 500,
        estimatedRange: "NT$40,000 ～ NT$60,000",
        candidateVendors: "合成候選廠商",
        confirmedVendor: "合成確認廠商",
        vendorContact: "synthetic-contact@example.test",
        primaryContact: "PARTNER_B",
        version: { increment: 1 },
        parentId: "fixed_ITEM_WEDDING_VENUE",
      }),
    });
    for (const forbiddenField of [
      "bookingStatus",
      "source",
      "externalId",
      "sourceHash",
      "sourceOrder",
    ]) {
      expect(updateMany.mock.calls[0][0].data).not.toHaveProperty(
        forbiddenField,
      );
    }
  });

  it("changes the three-state booking status with one tenant-scoped CAS statement", async () => {
    await expect(
      changeBudgetItemBookingStatusAction(
        "workspace_1",
        "budget_1",
        idleState,
        statusFormData("PAID", "4"),
      ),
    ).resolves.toEqual({ status: "success", message: "已更新付款狀態。" });

    expect(executeRaw).toHaveBeenCalledOnce();
    const statement = executeRaw.mock.calls[0][0] as {
      sql: string;
      values: unknown[];
    };
    expect(statement.sql).toMatch(/UPDATE "budget_items"[\s\S]*CASE[\s\S]*"booking_status" = 'PAID'/u);
    expect(statement.sql).toMatch(
      /"actual_amount" = CASE[\s\S]*WHEN 'PLANNING' THEN NULL[\s\S]*WHEN 'BOOKED_BALANCE_DUE' THEN "deposit_amount"[\s\S]*WHEN 'PAID' THEN "planned_amount"[\s\S]*END/u,
    );
    expect(statement.sql).toMatch(/"id" = [^\s]+[\s\S]*"workspace_id" = [^\s]+[\s\S]*"version" =/u);
    expect(statement.values).toEqual(
      expect.arrayContaining([
        "PAID",
        true,
        new Date("2027-03-01T08:09:10.000Z"),
        "budget_1",
        "workspace_1",
        4,
      ]),
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("accepts BOOKED_BALANCE_DUE and encodes paidAt clearing in the same statement", async () => {
    await expect(
      changeBudgetItemBookingStatusAction(
        "workspace_1",
        "budget_1",
        idleState,
        statusFormData("BOOKED_BALANCE_DUE", "5"),
      ),
    ).resolves.toMatchObject({ status: "success" });

    const statement = executeRaw.mock.calls[0][0] as {
      sql: string;
      values: unknown[];
    };
    expect(statement.sql).toMatch(/WHEN[^\n]*<> 'PAID' THEN NULL/u);
    expect(statement.values).toEqual(
      expect.arrayContaining(["BOOKED_BALANCE_DUE", false, 5]),
    );
  });

  it("rejects an invalid booking target only after authorization", async () => {
    await expect(
      changeBudgetItemBookingStatusAction(
        "workspace_1",
        "budget_1",
        idleState,
        statusFormData("PAID-ish"),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "VALIDATION",
      message: "請選擇有效的下訂與付款狀態。",
    });
    expect(requireWorkspaceAccess).toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("rejects missing or blank booking targets without writing", async () => {
    for (const formData of [versionFormData("0"), statusFormData("", "0")]) {
      await expect(
        changeBudgetItemBookingStatusAction(
          "workspace_1",
          "budget_1",
          idleState,
          formData,
        ),
      ).resolves.toEqual({
        status: "error",
        code: "VALIDATION",
        message: "請選擇有效的下訂與付款狀態。",
      });
    }
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("keeps same-target booking status under CAS and returns STALE for an old token", async () => {
    executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(
      changeBudgetItemBookingStatusAction(
        "workspace_1",
        "budget_1",
        idleState,
        statusFormData("PLANNING", "6"),
      ),
    ).resolves.toMatchObject({ status: "success" });
    await expect(
      changeBudgetItemBookingStatusAction(
        "workspace_1",
        "budget_1",
        idleState,
        statusFormData("PLANNING", "6"),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith(budgetPath);
  });

  it("authorizes edit access before parsing a group-subtree deletion form", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );

    await expect(
      deleteBudgetGroupSubtreeAction(
        "workspace_1",
        "subtree_root",
        idleState,
        new FormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "FORBIDDEN",
      message: "無權存取此婚宴工作區。",
    });

    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
    );
    expect(transaction).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("fails closed when locked edit access is lost before reading the subtree", async () => {
    requireLockedWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );

    await expect(
      deleteBudgetGroupSubtreeAction(
        "workspace_1",
        "subtree_root",
        idleState,
        subtreeDeleteFormData({ token: "0".repeat(64) }),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "FORBIDDEN",
      message: "無權存取此婚宴工作區。",
    });

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
      expect.any(Object),
    );
    expect(findMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("deletes one server-derived nested subtree with normalized confirmation and attachment-bound snapshot", async () => {
    findMany.mockResolvedValueOnce(subtreeRows);
    deleteMany.mockResolvedValueOnce({ count: subtreeOnlyRows.length });
    const token = summarizeBudgetSubtreeSnapshot(subtreeOnlyRows, "subtree_root").token;
    const formData = subtreeDeleteFormData({ token });

    expect(Array.from(formData.keys()).sort()).toEqual([
      "confirmationName",
      "expectedSubtreeSnapshotToken",
      "expectedVersion",
    ]);
    formData.set("workspaceId", "workspace_attacker");
    formData.set("itemId", "outside_group");
    formData.set("descendantIds", "outside_group");
    formData.set("attachmentIds", "forged_attachment");

    await expect(
      deleteBudgetGroupSubtreeAction(
        "workspace_1",
        "subtree_root",
        idleState,
        formData,
      ),
    ).resolves.toEqual({
      status: "success",
      message:
        "已永久刪除群組「婚紗 方案」與 3 筆下層項目，以及 3 個附件。",
    });

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(executeRaw).toHaveBeenCalledOnce();
    const hierarchyLock = executeRaw.mock.calls[0][0] as {
      strings: string[];
      values: unknown[];
    };
    expect(hierarchyLock.strings.join(" ")).toContain(
      "pg_advisory_xact_lock",
    );
    expect(hierarchyLock.values).toContain("workspace_1");
    expect(findMany).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_1",
        systemTaxonomyKey: null,
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        parentId: true,
        name: true,
        kind: true,
        version: true,
        source: true,
        systemTaxonomyKey: true,
        attachments: {
          orderBy: { id: "asc" },
          select: { id: true },
        },
      },
    });
    expect(deleteMany).toHaveBeenCalledOnce();
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_1",
        systemTaxonomyKey: null,
        id: {
          in: [
            "subtree_child_expense",
            "subtree_child_group",
            "subtree_grandchild",
            "subtree_root",
          ],
        },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(budgetPath);
  });

  it.each([
    ["a fixed taxonomy target", "fixed_ITEM_PRE_WEDDING_PHOTOGRAPHY"],
    ["a target outside the authorized workspace", "outside_workspace_group"],
  ])("does not delete %s", async (_label, itemId) => {
    findMany.mockResolvedValueOnce(subtreeRows);

    await expect(
      deleteBudgetGroupSubtreeAction(
        "workspace_1",
        itemId,
        idleState,
        subtreeDeleteFormData({ token: "0".repeat(64) }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: "workspace_1",
          systemTaxonomyKey: null,
        },
      }),
    );
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("does not delete when the target is an EXPENSE", async () => {
    findMany.mockResolvedValueOnce(
      subtreeRows.map((row) =>
        row.id === "subtree_root"
          ? { ...row, kind: "EXPENSE" as const }
          : row,
      ),
    );

    await expect(
      deleteBudgetGroupSubtreeAction(
        "workspace_1",
        "subtree_root",
        idleState,
        subtreeDeleteFormData({ token: "0".repeat(64) }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("binds every attachment ID into the subtree token and rejects stale snapshots", async () => {
    findMany.mockResolvedValueOnce(subtreeRows);
    const tokenWithoutAttachments = summarizeBudgetSubtreeSnapshot(
      subtreeOnlyRows.map((row) => ({ ...row, attachments: [] })),
      "subtree_root",
    ).token;

    await expect(
      deleteBudgetGroupSubtreeAction(
        "workspace_1",
        "subtree_root",
        idleState,
        subtreeDeleteFormData({ token: tokenWithoutAttachments }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });

    expect(deleteMany).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(budgetPath);
  });

  it("does not delete when the normalized confirmation name is wrong", async () => {
    findMany.mockResolvedValueOnce(subtreeRows);

    await expect(
      deleteBudgetGroupSubtreeAction(
        "workspace_1",
        "subtree_root",
        idleState,
        subtreeDeleteFormData({
          confirmationName: "另一個方案",
          token: summarizeBudgetSubtreeSnapshot(subtreeOnlyRows, "subtree_root").token,
        }),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "VALIDATION",
      message: "群組名稱不相符，群組與下層項目均未刪除。",
    });

    expect(deleteMany).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("deletes with id + workspace + version CAS", async () => {
    await expect(
      deleteBudgetItemAction(
        "workspace_1",
        "budget_1",
        idleState,
        versionFormData("9"),
      ),
    ).resolves.toEqual({ status: "success", message: "已移除花費項目。" });

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: "budget_1",
        workspaceId: "workspace_1",
        version: 9,
        systemTaxonomyKey: null,
      },
    });
  });

  it("returns a fixed understandable error when a parent still has children", async () => {
    deleteMany.mockRejectedValueOnce({ code: "P2003", meta: "secret" });

    await expect(
      deleteBudgetItemAction(
        "workspace_1",
        "budget_parent",
        idleState,
        versionFormData("2"),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "此花費項目包含子項，請先處理子項後再移除。",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns STALE and revalidates for forged, missing, or changed IDs", async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(
      updateBudgetItemAction(
        "workspace_1",
        "budget_from_workspace_2",
        idleState,
        validBudgetFormData("3"),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "STALE",
      message: "資料已更新或不存在，請重新整理後再試。",
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "budget_from_workspace_2",
          workspaceId: "workspace_1",
          version: 3,
          kind: "EXPENSE",
        },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(budgetPath);
  });

  it("allows at most one mutation with the same expectedVersion", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    deleteMany.mockResolvedValueOnce({ count: 0 });

    const updated = await updateBudgetItemAction(
      "workspace_1",
      "budget_1",
      idleState,
      validBudgetFormData("6"),
    );
    const deleted = await deleteBudgetItemAction(
      "workspace_1",
      "budget_1",
      idleState,
      versionFormData("6"),
    );

    expect(updated.status).toBe("success");
    expect(deleted).toMatchObject({ status: "error", code: "STALE" });
    expect(updateMany.mock.calls[0][0].where.version).toBe(6);
    expect(deleteMany.mock.calls[0][0].where.version).toBe(6);
  });

  it("moves with recursive cycle protection and optimistic versioning", async () => {
    const formData = versionFormData("7");
    formData.set("targetParentId", "parent_2");

    await expect(
      moveBudgetItemAction("workspace_1", "budget_1", idleState, formData),
    ).resolves.toEqual({
      status: "success",
      message: "已調整階層位置。",
    });

    const lock = executeRaw.mock.calls[0][0] as {
      strings: string[];
      values: unknown[];
    };
    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(lock.strings.join(" ")).toContain("pg_advisory_xact_lock");
    expect(lock.values).toContain("workspace_1");

    const query = executeRaw.mock.calls[1][0] as {
      strings: string[];
      values: unknown[];
    };
    const moveSql = query.strings.join(" ");
    expect(moveSql).toContain('WITH RECURSIVE "descendants"');
    expect(moveSql).toContain('"workspace_id"');
    expect(moveSql).toContain('"version"');
    expect(moveSql).toContain('"system_taxonomy_key" IS NULL');
    expect(moveSql).toContain('FROM "item_ancestors"');
    expect(moveSql).toContain('FROM "target_ancestors"');
    expect(query.values).toEqual(
      expect.arrayContaining(["budget_1", "workspace_1", "parent_2", 7]),
    );
    expect(revalidatePath).toHaveBeenCalledWith(budgetPath);
  });

  it("rejects invalid or stale hierarchy moves without a second write", async () => {
    await expect(
      moveBudgetItemAction(
        "workspace_1",
        "budget_1",
        idleState,
        versionFormData("7"),
      ),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
    expect(executeRaw).not.toHaveBeenCalled();

    executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const staleMove = versionFormData("7");
    staleMove.set("targetParentId", "parent_2");
    await expect(
      moveBudgetItemAction("workspace_1", "budget_1", idleState, staleMove),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });

  it.each([null, "", "A".repeat(64), "a".repeat(63), "a".repeat(65)])(
    "rejects an invalid direct-child fingerprint before opening a dissolve transaction: %s",
    async (fingerprint) => {
      const formData = versionFormData("7");
      if (fingerprint !== null) {
        formData.set("expectedDirectChildSetHash", fingerprint);
      }

      await expect(
        dissolveBudgetGroupAction(
          "workspace_1",
          "group_1",
          idleState,
          formData,
        ),
      ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
      expect(transaction).not.toHaveBeenCalled();
      expect(executeRaw).not.toHaveBeenCalled();
    },
  );

  it("returns STALE with zero writes when the locked direct-child IDs no longer match the confirmation", async () => {
    queryRaw
      .mockResolvedValueOnce([{ parentId: null }])
      .mockResolvedValueOnce([
        {
          id: "group_1",
          workspaceId: "workspace_1",
          kind: "GROUP",
          version: 7,
          parentId: null,
        },
      ])
      .mockResolvedValueOnce([{ id: "child_a" }, { id: "child_added" }]);
    executeRaw.mockResolvedValueOnce(1);

    await expect(
      dissolveBudgetGroupAction(
        "workspace_1",
        "group_1",
        idleState,
        dissolveFormData("7", ["child_a"]),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith(budgetPath);
  });

  it("dissolves a GROUP with locked authoritative parent, direct-child preservation, and delete CAS", async () => {
    queryRaw
      .mockResolvedValueOnce([{ parentId: "authoritative_parent" }])
      .mockResolvedValueOnce([{ id: "authoritative_parent" }])
      .mockResolvedValueOnce([
        {
          id: "group_1",
          workspaceId: "workspace_1",
          kind: "GROUP",
          version: 7,
          parentId: "authoritative_parent",
        },
      ])
      .mockResolvedValueOnce([{ id: "child_b" }, { id: "child_a" }]);
    executeRaw
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    const formData = dissolveFormData("7", ["child_a", "child_b"]);
    formData.set("parentId", "forged_parent");
    formData.set("targetParentId", "forged_target");
    formData.set("directChildCount", "999");

    await expect(
      dissolveBudgetGroupAction(
        "workspace_1",
        "group_1",
        idleState,
        formData,
      ),
    ).resolves.toEqual({
      status: "success",
      message: "已移除群組並保留其中項目。",
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
      expect.objectContaining({
        $executeRaw: executeRaw,
        $queryRaw: queryRaw,
      }),
    );

    const lock = executeRaw.mock.calls[0][0] as {
      strings: string[];
      values: unknown[];
    };
    expect(lock.strings.join(" ")).toContain("pg_advisory_xact_lock");
    expect(lock.values).toContain("workspace_1");

    const candidateGroup = queryRaw.mock.calls[0][0] as {
      strings: string[];
      values: unknown[];
    };
    expect(candidateGroup.strings.join(" ")).not.toContain("FOR UPDATE");

    const lockedParent = queryRaw.mock.calls[1][0] as {
      strings: string[];
      values: unknown[];
    };
    expect(lockedParent.strings.join(" ")).toContain("FOR KEY SHARE");
    expect(lockedParent.values).toEqual(
      expect.arrayContaining(["authoritative_parent", "workspace_1"]),
    );

    const lockedGroup = queryRaw.mock.calls[2][0] as {
      strings: string[];
      values: unknown[];
    };
    const lockedGroupSql = lockedGroup.strings.join(" ");
    expect(lockedGroupSql).toContain('"parent_id" AS "parentId"');
    expect(lockedGroupSql).toContain('FROM "budget_items"');
    expect(lockedGroupSql).toContain('"id" =');
    expect(lockedGroupSql).toContain('"workspace_id" =');
    expect(lockedGroupSql).toContain('"workspace_id" AS "workspaceId"');
    expect(lockedGroupSql).toContain('"kind"::text AS "kind"');
    expect(lockedGroupSql).toContain("FOR UPDATE");
    expect(lockedGroup.values).toEqual(
      expect.arrayContaining(["group_1", "workspace_1"]),
    );

    const lockedChildren = queryRaw.mock.calls[3][0] as {
      strings: string[];
      values: unknown[];
    };
    expect(lockedChildren.strings.join(" ")).toContain('ORDER BY "id"');
    expect(lockedChildren.strings.join(" ")).toContain("FOR UPDATE");

    const moveChildren = executeRaw.mock.calls[1][0] as {
      strings: string[];
      values: unknown[];
    };
    const moveChildrenSql = moveChildren.strings.join(" ");
    expect(moveChildrenSql).toContain('UPDATE "budget_items" AS "child"');
    expect(moveChildrenSql).toContain('"parent_id" =');
    expect(moveChildrenSql).toContain('"version" = "child"."version" + 1');
    expect(moveChildrenSql).toContain('"updated_at" = CURRENT_TIMESTAMP');
    expect(moveChildrenSql).toContain('"child"."workspace_id" =');
    expect(moveChildrenSql).toContain('"child"."parent_id" =');
    expect(moveChildren.values).toEqual(
      expect.arrayContaining([
        "authoritative_parent",
        "workspace_1",
        "group_1",
      ]),
    );

    const deleteGroup = executeRaw.mock.calls[2][0] as {
      strings: string[];
      values: unknown[];
    };
    const deleteGroupSql = deleteGroup.strings.join(" ");
    expect(deleteGroupSql).toContain('DELETE FROM "budget_items"');
    expect(deleteGroupSql).toContain('"id" =');
    expect(deleteGroupSql).toContain('"workspace_id" =');
    expect(deleteGroupSql).toContain('"version" =');
    expect(deleteGroupSql).toContain('"kind" = \'GROUP\'');
    expect(deleteGroup.values).toEqual(
      expect.arrayContaining(["group_1", "workspace_1", 7]),
    );
    expect(moveChildren.values).not.toEqual(
      expect.arrayContaining(["forged_parent", "forged_target", "999"]),
    );
    expect(revalidatePath).toHaveBeenCalledWith(budgetPath);
  });

  it("fails closed for stale, foreign, non-GROUP, and final delete races", async () => {
    queryRaw.mockResolvedValueOnce([]);

    await expect(
      dissolveBudgetGroupAction(
        "workspace_1",
        "foreign_or_expense",
        idleState,
        dissolveFormData("3", []),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(executeRaw).toHaveBeenCalledOnce();

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
    queryRaw
      .mockResolvedValueOnce([{ parentId: null }])
      .mockResolvedValueOnce([
        {
          id: "group_raced",
          workspaceId: "workspace_1",
          kind: "GROUP",
          version: 4,
          parentId: null,
        },
      ])
      .mockResolvedValueOnce([]);
    executeRaw
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    transaction.mockImplementation(async (callback) =>
      callback({
        $executeRaw: executeRaw,
        $queryRaw: queryRaw,
        budgetItem: { create, findFirst, updateMany, deleteMany },
      }),
    );

    await expect(
      dissolveBudgetGroupAction(
        "workspace_1",
        "group_raced",
        idleState,
        dissolveFormData("4", []),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(revalidatePath).toHaveBeenCalledWith(budgetPath);
  });

  it("returns a fixed dissolve error for database failures", async () => {
    queryRaw.mockRejectedValueOnce(new Error("database secret"));

    await expect(
      dissolveBudgetGroupAction(
        "workspace_1",
        "group_1",
        idleState,
        dissolveFormData("1", []),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法移除群組並保留其中項目，請稍後再試。",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sanitizes authorization and write failures without revalidation", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new Error("membership database secret"),
    );
    await expect(
      createBudgetItemAction("workspace_1", idleState, new FormData()),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法確認工作區權限，請稍後再試。",
    });

    requireWorkspaceAccess.mockResolvedValue({
      role: "OWNER",
      workspace: { id: "workspace_1" },
    });
    create.mockRejectedValueOnce(new Error("postgres://secret"));
    await expect(
      createBudgetItemAction(
        "workspace_1",
        idleState,
        validBudgetFormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法新增花費項目，請稍後再試。",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns fixed safe messages for update, status, and delete failures", async () => {
    updateMany.mockRejectedValueOnce({ code: "P2025", meta: "secret" });
    executeRaw.mockRejectedValueOnce(new Error("database secret"));
    deleteMany.mockRejectedValueOnce(new Error("postgres://secret"));

    await expect(
      updateBudgetItemAction(
        "workspace_1",
        "budget_1",
        idleState,
        validBudgetFormData(),
      ),
    ).resolves.toMatchObject({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法更新花費項目，請稍後再試。",
    });
    await expect(
      changeBudgetItemBookingStatusAction(
        "workspace_1",
        "budget_1",
        idleState,
        statusFormData("PAID"),
      ),
    ).resolves.toMatchObject({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法更新付款狀態，請稍後再試。",
    });
    await expect(
      deleteBudgetItemAction(
        "workspace_1",
        "budget_1",
        idleState,
        versionFormData(),
      ),
    ).resolves.toMatchObject({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法移除花費項目，請稍後再試。",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns the fixed update error when the authoritative lookup fails", async () => {
    findFirst.mockRejectedValueOnce(new Error("postgres://lookup-secret"));

    await expect(
      updateBudgetItemAction(
        "workspace_1",
        "budget_1",
        idleState,
        validBudgetFormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法更新花費項目，請稍後再試。",
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps a committed write successful when revalidation throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    revalidatePath.mockImplementationOnce(() => {
      throw new Error("secret cache failure");
    });

    await expect(
      createBudgetItemAction(
        "workspace_1",
        idleState,
        validBudgetFormData(),
      ),
    ).resolves.toEqual({
      status: "success",
      message: "已新增花費項目；畫面未自動更新，請重新整理。",
    });
    expect(log).toHaveBeenCalledWith("婚禮花費頁面重新驗證失敗。");
    expect(log).not.toHaveBeenCalledWith(expect.anything(), expect.anything());
  });

  it("atomically resets the exact owner-confirmed ordinary Budget snapshot and preserves fixed taxonomy rows", async () => {
    requireWorkspaceAccess.mockResolvedValueOnce({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
    });
    requireLockedWorkspaceAccess.mockResolvedValueOnce({
      role: "OWNER",
      workspace: { id: "workspace_1" },
    });
    findMany.mockResolvedValueOnce(resetRows);
    deleteMany.mockResolvedValueOnce({ count: 2 });
    const resetSnapshot = summarizeBudgetResetSnapshot(resetRows);
    const formData = resetBudgetFormData({ token: resetSnapshot.token });
    formData.set("workspaceId", "workspace_attacker");
    formData.set("role", "OWNER");
    formData.set("itemCount", "999");
    formData.set("attachmentIds", "forged");

    await expect(
      resetBudgetDataAction("workspace_1", idleState, formData),
    ).resolves.toEqual({
      status: "success",
      message: "已清除 2 筆花費與 2 個附件，Drive 固定分類已保留。",
    });

    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "manageMembers",
    );
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "manageMembers",
      expect.objectContaining({
        budgetItem: expect.any(Object),
        weddingWorkspace: expect.any(Object),
      }),
    );
    expect(workspaceFindFirst).toHaveBeenCalledWith({
      where: { id: "workspace_1" },
      select: { name: true },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_1", systemTaxonomyKey: null },
      orderBy: { id: "asc" },
      select: {
        id: true,
        version: true,
        source: true,
        attachments: {
          orderBy: { id: "asc" },
          select: { id: true },
        },
      },
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_1", systemTaxonomyKey: null },
    });
    expect(revalidatePath).toHaveBeenCalledWith(budgetPath);
  });

  it.each(["PARTNER", "PLANNER", "VIEWER"])(
    "rejects %s before opening a Budget reset transaction",
    async (role) => {
      requireWorkspaceAccess.mockRejectedValueOnce(
        new WorkspaceAccessDeniedError(),
      );
      const token = summarizeBudgetResetSnapshot(resetRows).token;

      await expect(
        resetBudgetDataAction(
          "workspace_1",
          idleState,
          resetBudgetFormData({ token }),
        ),
      ).resolves.toEqual({
        status: "error",
        code: "FORBIDDEN",
        message: "無權存取此婚宴工作區。",
      });

      expect(requireWorkspaceAccess).toHaveBeenCalledWith(
        "workspace_1",
        "session_user",
        "manageMembers",
      );
      expect(role).toMatch(/PARTNER|PLANNER|VIEWER/u);
      expect(transaction).not.toHaveBeenCalled();
      expect(deleteMany).not.toHaveBeenCalled();
    },
  );

  it("fails closed when locked OWNER access is lost", async () => {
    requireWorkspaceAccess.mockResolvedValueOnce({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
    });
    requireLockedWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );
    const token = summarizeBudgetResetSnapshot(resetRows).token;

    await expect(
      resetBudgetDataAction(
        "workspace_1",
        idleState,
        resetBudgetFormData({ token }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(workspaceFindFirst).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("requires a prepared Notion snapshot, the authoritative workspace name, and a current server snapshot token", async () => {
    requireWorkspaceAccess.mockResolvedValue({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
    });
    const currentToken = summarizeBudgetResetSnapshot(resetRows).token;

    await expect(
      resetBudgetDataAction(
        "workspace_1",
        idleState,
        resetBudgetFormData({
          token: currentToken,
          preparedSnapshot: "",
        }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
    expect(transaction).not.toHaveBeenCalled();

    findMany.mockResolvedValueOnce(resetRows);
    await expect(
      resetBudgetDataAction(
        "workspace_1",
        idleState,
        resetBudgetFormData({
          token: currentToken,
          confirmationName: "另一個婚宴",
        }),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "VALIDATION",
      message: "婚宴名稱不相符，花費資料未清除。",
    });
    expect(deleteMany).not.toHaveBeenCalled();

    findMany.mockResolvedValueOnce(resetRows);
    await expect(
      resetBudgetDataAction(
        "workspace_1",
        idleState,
        resetBudgetFormData({ token: "0".repeat(64) }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(deleteMany).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(budgetPath);
  });

  it("does not act on an empty snapshot and rolls back a deletion count mismatch as stale", async () => {
    requireWorkspaceAccess.mockResolvedValue({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
    });
    findMany.mockResolvedValueOnce([]);
    await expect(
      resetBudgetDataAction(
        "workspace_1",
        idleState,
        resetBudgetFormData({
          token: summarizeBudgetResetSnapshot([]).token,
        }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(deleteMany).not.toHaveBeenCalled();

    findMany.mockReset();
    findMany.mockResolvedValue(resetRows);
    workspaceFindFirst.mockResolvedValue({ name: "我們的婚宴" });
    deleteMany.mockResolvedValueOnce({ count: 1 });
    await expect(
      resetBudgetDataAction(
        "workspace_1",
        idleState,
        resetBudgetFormData({
          token: summarizeBudgetResetSnapshot(resetRows).token,
        }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(deleteMany).toHaveBeenCalledOnce();
  });

  it("sanitizes unexpected Budget reset failures", async () => {
    requireWorkspaceAccess.mockResolvedValueOnce({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
    });
    transaction.mockRejectedValueOnce(new Error("postgres://reset-secret"));

    await expect(
      resetBudgetDataAction(
        "workspace_1",
        idleState,
        resetBudgetFormData({ token: "0".repeat(64) }),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法清除花費資料，請稍後再試。",
    });
  });
});
