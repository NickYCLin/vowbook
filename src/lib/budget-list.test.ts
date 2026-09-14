import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  BUDGET_SYSTEM_NODES,
  BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES,
  type BudgetTaxonomyItemKey,
} from "@/domain/budget-item";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const { requireCurrentUser, requireWorkspaceAccess, findMany, transaction } = vi.hoisted(
  () => ({
    requireCurrentUser: vi.fn(),
    requireWorkspaceAccess: vi.fn(),
    findMany: vi.fn(),
    transaction: vi.fn(),
  }),
);

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: transaction,
    budgetItem: { findMany },
  },
}));

const transactionClient = {
  membership: { findUnique: vi.fn() },
  budgetItem: { findMany },
};

import {
  BudgetItemDataError,
  getBudgetPageData,
  summarizeBudgetCeremonyStageCleanups,
  sumTwdAmounts,
} from "./budget-list";

const select = {
  id: true,
  parentId: true,
  source: true,
  sourceOrder: true,
  name: true,
  kind: true,
  category: true,
  systemTaxonomyKey: true,
  relatedTaxonomyItemKey: true,
  suggestionKey: true,
  plannedAmount: true,
  actualAmount: true,
  dueDate: true,
  notes: true,
  paid: true,
  paidAt: true,
  bookingStatus: true,
  preparationStatus: true,
  depositAmount: true,
  balanceAmount: true,
  additionalAmount: true,
  estimatedRange: true,
  candidateVendors: true,
  confirmedVendor: true,
  vendorContact: true,
  primaryContact: true,
  version: true,
  createdAt: true,
  attachments: {
    where: { workspaceId: "workspace_1" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      originalName: true,
      mediaType: true,
      byteSize: true,
      createdAt: true,
    },
  },
};

const deterministicOrder = [
  { sourceOrder: { sort: "asc", nulls: "last" } },
  { category: "asc" },
  { name: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
];

function directChildSetHash(ids: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify(ids.toSorted()))
    .digest("hex");
}

function fixedTaxonomyRecords() {
  return BUDGET_SYSTEM_NODES.map((node) => ({
    id: "fixed_" + node.key,
    parentId: node.parentKey === null ? null : "fixed_" + node.parentKey,
    source: "MANUAL",
    sourceOrder: node.sourceOrder,
    name: node.label,
    kind: "GROUP",
    category: null,
    systemTaxonomyKey: node.key,
    relatedTaxonomyItemKey: null,
    plannedAmount: 0,
    actualAmount: null,
    dueDate: null,
    notes: null,
    paid: false,
    paidAt: null,
    bookingStatus: "PLANNING",
    preparationStatus: "NEEDS_ACTION",
    depositAmount: null,
    balanceAmount: null,
    additionalAmount: null,
    estimatedRange: null,
    candidateVendors: null,
    confirmedVendor: null,
    vendorContact: null,
    primaryContact: null,
    version: 0,
    createdAt: new Date("2027-01-01T00:00:00.000Z"),
  }));
}

function taxonomyExpense({
  id,
  primaryKey,
  relatedTaxonomyItemKey,
  plannedAmount = 1,
  actualAmount = null,
}: {
  id: string;
  primaryKey: BudgetTaxonomyItemKey;
  relatedTaxonomyItemKey: string | null;
  plannedAmount?: number;
  actualAmount?: number | null;
}) {
  return {
    id,
    parentId: "fixed_" + primaryKey,
    source: "MANUAL",
    sourceOrder: null,
    name: id,
    kind: "EXPENSE",
    category: BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES[primaryKey],
    systemTaxonomyKey: null,
    relatedTaxonomyItemKey,
    plannedAmount,
    actualAmount,
    dueDate: null,
    notes: null,
    paid: false,
    paidAt: null,
    bookingStatus: "PLANNING",
    preparationStatus: "NEEDS_ACTION",
    depositAmount: null,
    balanceAmount: null,
    additionalAmount: null,
    estimatedRange: null,
    candidateVendors: null,
    confirmedVendor: null,
    vendorContact: null,
    primaryContact: null,
    version: 0,
    createdAt: new Date("2027-01-02T00:00:00.000Z"),
  };
}

function taxonomyGroup(relatedTaxonomyItemKey: string | null) {
  return {
    ...taxonomyExpense({
      id: "custom_group",
      primaryKey: "ITEM_ATTIRE_RENTAL",
      relatedTaxonomyItemKey,
    }),
    kind: "GROUP",
    category: null,
    plannedAmount: 0,
  };
}

describe("getBudgetPageData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "VIEWER",
      workspace: {
        id: "workspace_1",
        name: "我們的婚宴",
        timezone: "Asia/Taipei",
        hasEngagementCeremony: false,
        hasProcessionCeremony: false,
        ceremonyPreferencesVersion: 0,
      },
    });
    findMany.mockResolvedValue([]);
    transaction.mockImplementation(async (operation) =>
      operation(transactionClient),
    );
  });

  it("authorizes before one tenant-scoped deterministic query", async () => {
    await expect(
      getBudgetPageData("workspace_1", {
        now: new Date("2028-02-28T16:00:00.000Z"),
      }),
    ).resolves.toEqual({
      workspaceName: "我們的婚宴",
      workspaceToday: "2028-02-29",
      canEdit: false,
      canResetBudget: false,
      resetSnapshot: null,
      hasEngagementCeremony: false,
      hasProcessionCeremony: false,
      ceremonyPreferencesVersion: 0,
      ceremonyStageCleanups: [],
      items: [],
      summary: {
        itemCount: 0,
        paidCount: 0,
        plannedTotal: "0",
        actualTotal: "0",
        balanceDueTotal: "0",
        balanceDueCount: 0,
        overdueBalanceDueCount: 0,
        balanceDueMissingAmountCount: 0,
        nearestUpcomingBalanceDueDate: null,
        selfProvidedCount: 0,
        notPlannedCount: 0,
      },
    });

    expect(requireCurrentUser).toHaveBeenCalledWith();
    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "read",
      transactionClient,
    );
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_1" },
      orderBy: deterministicOrder,
      select,
    });
    expect(requireCurrentUser.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.mock.invocationCallOrder[0],
    );
    expect(transaction.mock.invocationCallOrder[0]).toBeLessThan(
      requireWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(requireWorkspaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      findMany.mock.invocationCallOrder[0],
    );
  });

  it("exposes only the workspace-owned Chinese ceremony opt-ins", async () => {
    requireWorkspaceAccess.mockResolvedValueOnce({
      role: "VIEWER",
      workspace: {
        id: "workspace_1",
        name: "我們的婚宴",
        timezone: "Asia/Taipei",
        hasEngagementCeremony: false,
        hasProcessionCeremony: true,
        ceremonyPreferencesVersion: 3,
      },
    });
    await expect(getBudgetPageData("workspace_1")).resolves.toMatchObject({
      hasEngagementCeremony: false,
      hasProcessionCeremony: true,
      ceremonyPreferencesVersion: 3,
    });
  });

  it.each([
    ["OWNER", true, true],
    ["PARTNER", true, false],
    ["PLANNER", true, false],
    ["VIEWER", false, false],
  ])("maps %s to canEdit=%s and canResetBudget=%s", async (role, canEdit, canResetBudget) => {
    requireWorkspaceAccess.mockResolvedValueOnce({
      role,
      workspace: {
        id: "workspace_1",
        name: "我們的婚宴",
        timezone: "Asia/Taipei",
      },
    });

    await expect(getBudgetPageData("workspace_1")).resolves.toMatchObject({
      canEdit,
      canResetBudget,
    });
  });

  it("returns an OWNER-only reset snapshot for ordinary row versions, sources, and attachment IDs", async () => {
    requireWorkspaceAccess.mockResolvedValueOnce({
      role: "OWNER",
      workspace: {
        id: "workspace_1",
        name: "我們的婚宴",
        timezone: "Asia/Taipei",
      },
    });
    const manual = {
      ...taxonomyExpense({
        id: "manual_expense",
        primaryKey: "ITEM_WEDDING_VENUE",
  relatedTaxonomyItemKey: null,
      }),
      version: 3,
      attachments: [
        {
          id: "attachment_manual",
          originalName: "合約.pdf",
          mediaType: "application/pdf",
          byteSize: 9,
          createdAt: new Date("2027-01-03T00:00:00.000Z"),
        },
      ],
    };
    const notion = {
      ...taxonomyExpense({
        id: "notion_expense",
        primaryKey: "ITEM_WEDDING_PHOTOGRAPHY",
  relatedTaxonomyItemKey: null,
      }),
      source: "NOTION",
      version: 5,
      attachments: [
        {
          id: "attachment_notion",
          originalName: "收據.jpg",
          mediaType: "image/jpeg",
          byteSize: 10,
          createdAt: new Date("2027-01-04T00:00:00.000Z"),
        },
      ],
    };
    findMany.mockResolvedValueOnce([
      ...fixedTaxonomyRecords(),
      notion,
      manual,
    ]);

    const data = await getBudgetPageData("workspace_1");
    expect(data.resetSnapshot).toEqual({
      token: expect.stringMatching(/^[0-9a-f]{64}$/u),
      itemCount: 2,
      notionItemCount: 1,
      manualItemCount: 1,
      attachmentCount: 2,
    });
  });

  it("projects a complete attachment-bound snapshot only for nonempty custom groups", async () => {
    const group = {
      ...taxonomyGroup(null),
      name: "宴客",
      source: "NOTION",
      version: 2,
      attachments: [],
    };
    const child = {
      ...taxonomyExpense({
        id: "staff_red_envelope",
        primaryKey: "ITEM_ATTIRE_RENTAL",
        relatedTaxonomyItemKey: null,
      }),
      parentId: group.id,
      name: "婚禮工作人員紅包",
      version: 3,
      attachments: [
        {
          id: "attachment_receipt",
          originalName: "收據.jpg",
          mediaType: "image/jpeg",
          byteSize: 10,
          createdAt: new Date("2027-01-04T00:00:00.000Z"),
        },
      ],
    };
    findMany.mockResolvedValueOnce([
      ...fixedTaxonomyRecords(),
      group,
      child,
    ]);

    const data = await getBudgetPageData("workspace_1");
    const groupItem = data.items.find((item) => item.id === group.id);
    const childItem = data.items.find((item) => item.id === child.id);
    const childToken = createHash("sha256")
      .update(
        JSON.stringify({
          id: child.id,
          version: 3,
          source: "MANUAL",
          attachmentIds: ["attachment_receipt"],
          children: [],
        }),
      )
      .digest("hex");
    const expectedToken = createHash("sha256")
      .update(
        JSON.stringify({
          id: group.id,
          version: 2,
          source: "NOTION",
          attachmentIds: [],
          children: [{ id: child.id, token: childToken }],
        }),
      )
      .digest("hex");

    expect(groupItem?.subtreeDeleteSnapshot).toEqual({
      token: expectedToken,
      itemCount: 2,
      attachmentCount: 1,
    });
    expect(childItem?.subtreeDeleteSnapshot).toBeUndefined();
    expect(
      data.items.find((item) => item.systemTaxonomyKey)?.subtreeDeleteSnapshot,
    ).toBeUndefined();
  });

  it("maps serializable DTOs and computes summary from the same scoped rows", async () => {
    findMany.mockResolvedValue([
      {
        id: "item_unpaid",
        parentId: null,
        source: "MANUAL",
        sourceOrder: null,
        name: "婚宴場地",
        kind: "EXPENSE",
        category: "ATTIRE_STYLING",
  plannedAmount: 2_147_483_647,
        actualAmount: null,
        dueDate: new Date("2028-02-29T00:00:00.000Z"),
        notes: "含訂金",
        paid: false,
        paidAt: null,
        bookingStatus: "PLANNING",
        preparationStatus: "NEEDS_ACTION",
        depositAmount: null,
        balanceAmount: null,
        additionalAmount: null,
        estimatedRange: null,
        candidateVendors: null,
        confirmedVendor: null,
        vendorContact: null,
        primaryContact: null,
        version: 2,
        createdAt: new Date("2027-01-01T00:00:00.000Z"),
        attachments: [
          {
            id: "attachment_1",
            originalName: "場地合約.pdf",
            mediaType: "application/pdf",
            byteSize: 9,
            createdAt: new Date("2027-01-03T00:00:00.000Z"),
            data: Buffer.from("%PDF-1.7"),
          },
        ],
      },
      {
        id: "item_paid",
        parentId: null,
        source: "MANUAL",
        sourceOrder: null,
        name: "婚禮攝影",
        kind: "EXPENSE",
        category: "PHOTOGRAPHY_VIDEO",
  plannedAmount: 2_147_483_647,
        actualAmount: 88000,
        dueDate: null,
        notes: null,
        paid: true,
        paidAt: new Date("2027-03-01T08:09:10.000Z"),
        bookingStatus: "PAID",
        preparationStatus: "NEEDS_ACTION",
        depositAmount: null,
        balanceAmount: null,
        additionalAmount: null,
        estimatedRange: null,
        candidateVendors: null,
        confirmedVendor: null,
        vendorContact: null,
        primaryContact: null,
        version: 4,
        createdAt: new Date("2027-01-02T00:00:00.000Z"),
      },
    ]);

    const data = await getBudgetPageData("workspace_1");

    expect(data.items).toEqual([
      {
        id: "item_unpaid",
        parentId: null,
        depth: 0,
        hasChildren: false,
        breadcrumb: ["婚宴場地"],
        directChildren: [],
        directChildCount: 0,
        directChildSetHash: directChildSetHash([]),
        descendantCount: 0,
        source: "MANUAL",
        name: "婚宴場地",
        kind: "EXPENSE",
        category: "ATTIRE_STYLING",
  relatedTaxonomyItemKey: null,
        directParentName: null,
  plannedAmount: 2_147_483_647,
        rolledUpPlannedAmount: "2147483647",
        actualAmount: null,
        rolledUpActualAmount: "0",
        rolledUpActualAmountRecorded: false,
        rolledUpDepositAmount: "0",
        rolledUpDepositAmountRecorded: false,
        rolledUpBalanceAmount: "0",
        rolledUpBalanceAmountRecorded: false,
        dueDate: "2028-02-29",
        notes: "含訂金",
        paid: false,
        paidAt: null,
        bookingStatus: "PLANNING",
        preparationStatus: "NEEDS_ACTION",
        depositAmount: null,
        balanceAmount: null,
        additionalAmount: null,
        estimatedRange: null,
        candidateVendors: null,
        confirmedVendor: null,
        vendorContact: null,
        primaryContact: null,
        version: 2,
        attachments: [
          {
            id: "attachment_1",
            originalName: "場地合約.pdf",
            mediaType: "application/pdf",
            byteSize: 9,
            createdAt: "2027-01-03T00:00:00.000Z",
          },
        ],
      },
      {
        id: "item_paid",
        parentId: null,
        depth: 0,
        hasChildren: false,
        breadcrumb: ["婚禮攝影"],
        directChildren: [],
        directChildCount: 0,
        directChildSetHash: directChildSetHash([]),
        descendantCount: 0,
        source: "MANUAL",
        name: "婚禮攝影",
        kind: "EXPENSE",
        category: "PHOTOGRAPHY_VIDEO",
  relatedTaxonomyItemKey: null,
        directParentName: null,
  plannedAmount: 2_147_483_647,
        rolledUpPlannedAmount: "2147483647",
        actualAmount: 88000,
        rolledUpActualAmount: "88000",
        rolledUpActualAmountRecorded: true,
        rolledUpDepositAmount: "0",
        rolledUpDepositAmountRecorded: false,
        rolledUpBalanceAmount: "0",
        rolledUpBalanceAmountRecorded: false,
        dueDate: null,
        notes: null,
        paid: true,
        paidAt: "2027-03-01T08:09:10.000Z",
        bookingStatus: "PAID",
        preparationStatus: "NEEDS_ACTION",
        depositAmount: null,
        balanceAmount: null,
        additionalAmount: null,
        estimatedRange: null,
        candidateVendors: null,
        confirmedVendor: null,
        vendorContact: null,
        primaryContact: null,
        version: 4,
      },
    ]);
    expect(data.summary).toEqual({
      itemCount: 2,
      paidCount: 1,
      plannedTotal: "4294967294",
      actualTotal: "88000",
      balanceDueTotal: "0",
      balanceDueCount: 0,
      overdueBalanceDueCount: 0,
      balanceDueMissingAmountCount: 0,
      nearestUpcomingBalanceDueDate: null,
      selfProvidedCount: 0,
      notPlannedCount: 0,
    });
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    expect(JSON.stringify(data)).not.toContain("PDF-1.7");
    expect(select).not.toHaveProperty("attachments.select.data");
    expect(findMany).toHaveBeenCalledOnce();
  });

  it("keeps owned and not-planned preparation records but excludes their retained money from every budget rollup", async () => {
    const group = taxonomyGroup(null);
    const active = {
      ...taxonomyExpense({
        id: "active_expense",
        primaryKey: "ITEM_ATTIRE_RENTAL",
        relatedTaxonomyItemKey: null,
        plannedAmount: 100,
        actualAmount: 40,
      }),
      parentId: group.id,
      preparationStatus: "NEEDS_ACTION",
    };
    const owned = {
      ...taxonomyExpense({
        id: "owned_suit",
        primaryKey: "ITEM_ATTIRE_RENTAL",
        relatedTaxonomyItemKey: null,
        plannedAmount: 200,
        actualAmount: 200,
      }),
      parentId: group.id,
      preparationStatus: "ALREADY_OWNED",
      bookingStatus: "PAID",
      paid: true,
      paidAt: new Date("2027-01-03T00:00:00.000Z"),
      depositAmount: 50,
      balanceAmount: 150,
    };
    const skipped = {
      ...taxonomyExpense({
        id: "skipped_shoes",
        primaryKey: "ITEM_ATTIRE_RENTAL",
        relatedTaxonomyItemKey: null,
        plannedAmount: 300,
        actualAmount: 80,
      }),
      parentId: group.id,
      preparationStatus: "NOT_PLANNED",
      bookingStatus: "BOOKED_BALANCE_DUE",
      depositAmount: 80,
      balanceAmount: 220,
    };
    findMany.mockResolvedValueOnce([
      ...fixedTaxonomyRecords(),
      group,
      active,
      owned,
      skipped,
    ]);

    const data = await getBudgetPageData("workspace_1");

    expect(data.items.find((item) => item.id === group.id)).toMatchObject({
      rolledUpPlannedAmount: "100",
      rolledUpActualAmount: "40",
      rolledUpDepositAmount: "0",
      rolledUpBalanceAmount: "0",
    });
    expect(data.items.find((item) => item.id === "owned_suit")).toMatchObject({
      preparationStatus: "ALREADY_OWNED",
      plannedAmount: 200,
      rolledUpPlannedAmount: "0",
      rolledUpActualAmount: "0",
    });
    expect(data.summary).toEqual({
      itemCount: 1,
      paidCount: 0,
      plannedTotal: "100",
      actualTotal: "40",
      balanceDueTotal: "0",
      balanceDueCount: 0,
      overdueBalanceDueCount: 0,
      balanceDueMissingAmountCount: 0,
      nearestUpcomingBalanceDueDate: null,
      selfProvidedCount: 1,
      notPlannedCount: 1,
    });
  });

  it("preserves explicit zero payment records through group rollups", async () => {
    const group = taxonomyGroup(null);
    const child = {
      ...taxonomyExpense({
        id: "zero_payment_child",
        primaryKey: "ITEM_ATTIRE_RENTAL",
        relatedTaxonomyItemKey: null,
        plannedAmount: 0,
        actualAmount: 0,
      }),
      parentId: group.id,
      depositAmount: 0,
      balanceAmount: 0,
      bookingStatus: "PAID",
      paid: true,
      paidAt: new Date("2027-01-02T03:04:05.000Z"),
    };
    findMany.mockResolvedValueOnce([...fixedTaxonomyRecords(), group, child]);

    const data = await getBudgetPageData("workspace_1");
    expect(data.items.find((item) => item.id === group.id)).toMatchObject({
      rolledUpActualAmount: "0",
      rolledUpActualAmountRecorded: true,
      rolledUpDepositAmount: "0",
      rolledUpDepositAmountRecorded: true,
      rolledUpBalanceAmount: "0",
      rolledUpBalanceAmountRecorded: true,
    });
  });

  it("exposes a nullable public related taxonomy item without changing tree rollups or summary totals", async () => {
    findMany.mockResolvedValue([
      ...fixedTaxonomyRecords(),
      {
        ...taxonomyExpense({
          id: "attire_for_photo",
          primaryKey: "ITEM_ATTIRE_RENTAL",
          relatedTaxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
          plannedAmount: 100,
          actualAmount: 80,
        }),
        source: "NOTION",
      },
      taxonomyExpense({
        id: "photo_package",
        primaryKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
  relatedTaxonomyItemKey: null,
  plannedAmount: 200,
        actualAmount: 150,
      }),
    ]);

    const data = await getBudgetPageData("workspace_1");
    const relatedExpense = data.items.find(
      (item) => item.id === "attire_for_photo",
    );
    const photoExpense = data.items.find(
      (item) => item.id === "photo_package",
    );
    const attireTaxonomy = data.items.find(
      (item) => item.systemTaxonomyKey === "ITEM_ATTIRE_RENTAL",
    );
    const photoTaxonomy = data.items.find(
      (item) =>
        item.systemTaxonomyKey === "ITEM_PRE_WEDDING_PHOTOGRAPHY",
    );

    expect(relatedExpense).toMatchObject({
      parentId: "fixed_ITEM_ATTIRE_RENTAL",
      category: "ATTIRE_STYLING",
      relatedTaxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
      rolledUpPlannedAmount: "100",
      rolledUpActualAmount: "80",
      rolledUpDepositAmount: "0",
      rolledUpBalanceAmount: "0",
    });
    expect(photoExpense).toMatchObject({
      relatedTaxonomyItemKey: null,
      rolledUpPlannedAmount: "200",
      rolledUpActualAmount: "150",
      rolledUpDepositAmount: "0",
      rolledUpBalanceAmount: "0",
    });
    expect(attireTaxonomy).toMatchObject({
      directChildCount: 1,
      rolledUpPlannedAmount: "100",
      rolledUpActualAmount: "80",
      rolledUpDepositAmount: "0",
      rolledUpBalanceAmount: "0",
    });
    expect(photoTaxonomy).toMatchObject({
      directChildCount: 1,
      rolledUpPlannedAmount: "200",
      rolledUpActualAmount: "150",
      rolledUpDepositAmount: "0",
      rolledUpBalanceAmount: "0",
    });
    expect(data.summary).toMatchObject({
      itemCount: 2,
      plannedTotal: "300",
      actualTotal: "230",
    });
  });

  it.each([
    [
      "fixed system node relation",
      () =>
        fixedTaxonomyRecords().map((item) =>
          item.systemTaxonomyKey === "ITEM_ATTIRE_RENTAL"
            ? {
                ...item,
                relatedTaxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
              }
            : item,
        ),
    ],
    [
      "custom group relation",
      () => [
        ...fixedTaxonomyRecords(),
        taxonomyGroup("ITEM_PRE_WEDDING_PHOTOGRAPHY"),
      ],
    ],
    [
      "unknown relation key",
      () => [
        ...fixedTaxonomyRecords(),
        taxonomyExpense({
          id: "invalid_relation",
          primaryKey: "ITEM_ATTIRE_RENTAL",
          relatedTaxonomyItemKey: "ITEM_DOES_NOT_EXIST",
        }),
      ],
    ],
    [
      "internal relation key",
      () => [
        ...fixedTaxonomyRecords(),
        taxonomyExpense({
          id: "internal_relation",
          primaryKey: "ITEM_ATTIRE_RENTAL",
          relatedTaxonomyItemKey: "INTERNAL_UNCLASSIFIED_ITEM",
        }),
      ],
    ],
    [
      "stage relation key",
      () => [
        ...fixedTaxonomyRecords(),
        taxonomyExpense({
          id: "stage_relation",
          primaryKey: "ITEM_ATTIRE_RENTAL",
          relatedTaxonomyItemKey: "STAGE_PREPARATION_1_2_MONTHS",
        }),
      ],
    ],
    [
      "same primary and related taxonomy item",
      () => [
        ...fixedTaxonomyRecords(),
        taxonomyExpense({
          id: "self_relation",
          primaryKey: "ITEM_ATTIRE_RENTAL",
          relatedTaxonomyItemKey: "ITEM_ATTIRE_RENTAL",
        }),
      ],
    ],
  ])("rejects %s", async (_case, records) => {
    findMany.mockResolvedValue(records());

    await expect(getBudgetPageData("workspace_1")).rejects.toEqual(
      new BudgetItemDataError("目前無法載入婚禮花費，請稍後再試。"),
    );
  });

  it("returns explicit breadcrumb, direct children, and all-descendant metadata", async () => {
    const record = (id: string, parentId: string | null, name: string) => ({
      id,
      parentId,
      source: "MANUAL",
      sourceOrder: null,
      name,
      kind: "EXPENSE",
      category: "OTHER_PENDING",
      plannedAmount: 1,
      actualAmount: null,
      dueDate: null,
      notes: null,
      paid: false,
      paidAt: null,
      bookingStatus: "PLANNING",
      preparationStatus: "NEEDS_ACTION",
      depositAmount: null,
      balanceAmount: null,
      additionalAmount: null,
      estimatedRange: null,
      candidateVendors: null,
      confirmedVendor: null,
      vendorContact: null,
      primaryContact: null,
      version: 0,
      createdAt: new Date("2027-01-01T00:00:00.000Z"),
    });
    findMany.mockResolvedValue([
      record("root", null, "婚宴"),
      record("child", "root", "場地"),
      record("grandchild", "child", "宴會廳"),
    ]);

    const data = await getBudgetPageData("workspace_1");

    expect(data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "root",
          parentId: null,
          breadcrumb: ["婚宴"],
          directChildren: [
            { id: "child", name: "場地", hasChildren: true },
          ],
          directChildCount: 1,
          descendantCount: 2,
        }),
        expect.objectContaining({
          id: "child",
          parentId: "root",
          breadcrumb: ["婚宴", "場地"],
          directChildren: [
            { id: "grandchild", name: "宴會廳", hasChildren: false },
          ],
          directChildCount: 1,
          descendantCount: 1,
        }),
      ]),
    );
  });

  it("binds every GROUP projection to a deterministic sorted direct-child SHA-256 fingerprint, including empty groups", async () => {
    const record = (
      id: string,
      parentId: string | null,
      name: string,
      kind: "GROUP" | "EXPENSE",
    ) => ({
      id,
      parentId,
      source: "MANUAL",
      sourceOrder: null,
      name,
      kind,
      category: kind === "GROUP" ? null : "OTHER_PENDING",
      plannedAmount: 0,
      actualAmount: null,
      dueDate: null,
      notes: null,
      paid: false,
      paidAt: null,
      bookingStatus: "PLANNING",
      preparationStatus: "NEEDS_ACTION",
      depositAmount: null,
      balanceAmount: null,
      additionalAmount: null,
      estimatedRange: null,
      candidateVendors: null,
      confirmedVendor: null,
      vendorContact: null,
      primaryContact: null,
      version: 0,
      createdAt: new Date("2027-01-01T00:00:00.000Z"),
    });
    findMany.mockResolvedValue([
      record("group_populated", null, "有內容群組", "GROUP"),
      record("child_z", "group_populated", "子項乙", "EXPENSE"),
      record("child_a", "group_populated", "子項甲", "EXPENSE"),
      record("group_empty", null, "空群組", "GROUP"),
    ]);

    const data = await getBudgetPageData("workspace_1");
    expect(data.items.find((item) => item.id === "group_populated")).toMatchObject({
      directChildSetHash: directChildSetHash(["child_z", "child_a"]),
    });
    expect(data.items.find((item) => item.id === "group_empty")).toMatchObject({
      directChildSetHash: directChildSetHash([]),
    });
  });

  it("separates overdue balances from the nearest balance that is not yet due", async () => {
    const record = (
      id: string,
      parentId: string | null,
      bookingStatus: "PLANNING" | "BOOKED_BALANCE_DUE" | "PAID",
      balanceAmount: number | null,
      dueDate: Date | null,
    ) => ({
      id,
      parentId,
      source: "MANUAL",
      sourceOrder: null,
      name: id,
      kind: "EXPENSE",
      category: "OTHER_PENDING",
      plannedAmount: 0,
      actualAmount: null,
      dueDate,
      notes: null,
      paid: bookingStatus === "PAID",
      paidAt: null,
      bookingStatus,
      preparationStatus: "NEEDS_ACTION",
      depositAmount: null,
      balanceAmount,
      additionalAmount: null,
      estimatedRange: null,
      candidateVendors: null,
      confirmedVendor: null,
      vendorContact: null,
      primaryContact: null,
      version: 0,
      createdAt: new Date("2027-01-01T00:00:00.000Z"),
    });

    findMany.mockResolvedValue([
      record(
        "planning_excluded",
        null,
        "PLANNING",
        2_147_483_647,
        new Date("2027-01-01T00:00:00.000Z"),
      ),
      record(
        "paid_excluded",
        null,
        "PAID",
        2_147_483_647,
        new Date("2027-01-02T00:00:00.000Z"),
      ),
      record(
        "due_parent",
        null,
        "BOOKED_BALANCE_DUE",
        111,
        new Date("2028-06-01T00:00:00.000Z"),
      ),
      record(
        "due_child",
        "due_parent",
        "BOOKED_BALANCE_DUE",
        2_222,
        new Date("2028-04-30T00:00:00.000Z"),
      ),
      record(
        "due_child_missing_amount",
        "due_parent",
        "BOOKED_BALANCE_DUE",
        null,
        new Date("2028-05-02T00:00:00.000Z"),
      ),
      record(
        "due_root_without_date",
        null,
        "BOOKED_BALANCE_DUE",
        33_333,
        null,
      ),
    ]);

    const data = await getBudgetPageData("workspace_1", {
      now: new Date("2028-05-01T00:00:00.000Z"),
    });

    expect(data.summary).toEqual(
      expect.objectContaining({
        balanceDueTotal: "35666",
        balanceDueCount: 4,
        overdueBalanceDueCount: 1,
        balanceDueMissingAmountCount: 1,
        nearestUpcomingBalanceDueDate: "2028-05-02",
      }),
    );
    expect(findMany).toHaveBeenCalledOnce();
  });

  it("uses the workspace timezone boundary when deciding whether a due date is overdue", async () => {
    findMany.mockResolvedValue([
      ...fixedTaxonomyRecords(),
      {
        ...taxonomyExpense({
          id: "taipei_boundary",
          primaryKey: "ITEM_WEDDING_VENUE",
          relatedTaxonomyItemKey: null,
        }),
        bookingStatus: "BOOKED_BALANCE_DUE",
        balanceAmount: 12_000,
        dueDate: new Date("2028-04-30T00:00:00.000Z"),
      },
    ]);

    const beforeMidnight = await getBudgetPageData("workspace_1", {
      now: new Date("2028-04-30T15:59:59.999Z"),
    });
    const afterMidnight = await getBudgetPageData("workspace_1", {
      now: new Date("2028-04-30T16:00:00.000Z"),
    });

    expect(beforeMidnight.workspaceToday).toBe("2028-04-30");
    expect(beforeMidnight.summary).toMatchObject({
      overdueBalanceDueCount: 0,
      nearestUpcomingBalanceDueDate: "2028-04-30",
    });
    expect(afterMidnight.workspaceToday).toBe("2028-05-01");
    expect(afterMidnight.summary).toMatchObject({
      overdueBalanceDueCount: 1,
      nearestUpcomingBalanceDueDate: null,
    });
  });

  it("denies a membership revoked at the transaction boundary before reading amounts", async () => {
    requireWorkspaceAccess.mockRejectedValue(new WorkspaceAccessDeniedError());

    await expect(
      getBudgetPageData("workspace_secret"),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    expect(findMany).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledOnce();
  });

  it("does not swallow the current-user redirect", async () => {
    const redirectError = new Error("NEXT_REDIRECT");
    requireCurrentUser.mockRejectedValue(redirectError);

    await expect(getBudgetPageData("workspace_1")).rejects.toBe(redirectError);
    expect(requireWorkspaceAccess).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("sanitizes membership and query failures", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new Error("membership database secret"),
    );
    await expect(getBudgetPageData("workspace_1")).rejects.toEqual(
      new BudgetItemDataError("目前無法載入婚禮花費，請稍後再試。"),
    );
    expect(findMany).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledOnce();

    requireWorkspaceAccess.mockResolvedValue({
      role: "OWNER",
      workspace: {
        id: "workspace_1",
        name: "我們的婚宴",
        timezone: "Asia/Taipei",
      },
    });
    findMany.mockRejectedValueOnce(new Error("postgres://secret"));
    await expect(getBudgetPageData("workspace_1")).rejects.toEqual(
      new BudgetItemDataError("目前無法載入婚禮花費，請稍後再試。"),
    );

  });

  it("keeps exact totals after valid PostgreSQL Int rows cross Number.MAX_SAFE_INTEGER", () => {
    function* maximumPostgresIntegers() {
      for (let index = 0; index < 4_194_305; index += 1) {
        yield 2_147_483_647;
      }
    }

    expect(sumTwdAmounts(maximumPostgresIntegers())).toBe(
      "9007201398030335",
    );
  });
});

describe("summarizeBudgetCeremonyStageCleanups", () => {
  const rows = [
    {
      id: "stage_procession",
      parentId: null,
      version: 0,
      source: "MANUAL" as const,
      systemTaxonomyKey: "STAGE_WEDDING_PROCESSION",
      attachments: [],
    },
    {
      id: "item_procession_groom",
      parentId: "stage_procession",
      version: 0,
      source: "MANUAL" as const,
      systemTaxonomyKey: "ITEM_PROCESSION_GROOM",
      attachments: [],
    },
    {
      id: "expense_door_gift",
      parentId: "item_procession_groom",
      version: 2,
      source: "MANUAL" as const,
      systemTaxonomyKey: null,
      attachments: [{ id: "attachment_1" }, { id: "attachment_2" }],
    },
    {
      id: "stage_engagement",
      parentId: null,
      version: 0,
      source: "MANUAL" as const,
      systemTaxonomyKey: "STAGE_ENGAGEMENT_CEREMONY",
      attachments: [],
    },
    {
      id: "unrelated_expense",
      parentId: null,
      version: 0,
      source: "MANUAL" as const,
      systemTaxonomyKey: null,
      attachments: [],
    },
  ];

  it("reports only switched-off stages that still hold user rows", () => {
    expect(
      summarizeBudgetCeremonyStageCleanups(rows, {
        hasEngagementCeremony: false,
        hasProcessionCeremony: false,
      }),
    ).toEqual([
      {
        stageKey: "STAGE_WEDDING_PROCESSION",
        label: "迎娶儀式用品、工作人員紅包",
        removableItemCount: 1,
        attachmentCount: 2,
        snapshotToken: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    ]);
  });

  it("reports nothing while the ceremony is switched on", () => {
    expect(
      summarizeBudgetCeremonyStageCleanups(rows, {
        hasEngagementCeremony: true,
        hasProcessionCeremony: true,
      }),
    ).toEqual([]);
  });

  it("changes the snapshot token when any row in the stage subtree changes", () => {
    const [before] = summarizeBudgetCeremonyStageCleanups(rows, {
      hasEngagementCeremony: false,
      hasProcessionCeremony: false,
    });
    const [after] = summarizeBudgetCeremonyStageCleanups(
      rows.map((row) =>
        row.id === "expense_door_gift" ? { ...row, version: 3 } : row,
      ),
      { hasEngagementCeremony: false, hasProcessionCeremony: false },
    );
    expect(after?.snapshotToken).not.toBe(before?.snapshotToken);

    const [unchanged] = summarizeBudgetCeremonyStageCleanups(
      rows.map((row) =>
        row.id === "unrelated_expense" ? { ...row, version: 9 } : row,
      ),
      { hasEngagementCeremony: false, hasProcessionCeremony: false },
    );
    expect(unchanged?.snapshotToken).toBe(before?.snapshotToken);
  });
});
