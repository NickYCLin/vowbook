import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  BUDGET_SYSTEM_NODES,
  BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES,
  type BudgetTaxonomyItemKey,
} from "@/domain/budget-item";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const { requireCurrentUser, requireWorkspaceAccess, findMany } = vi.hoisted(
  () => ({
    requireCurrentUser: vi.fn(),
    requireWorkspaceAccess: vi.fn(),
    findMany: vi.fn(),
  }),
);

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/prisma", () => ({
  prisma: { budgetItem: { findMany } },
}));

import {
  BudgetItemDataError,
  getBudgetPageData,
  sumTwdAmounts,
} from "./budget-list";

const select = {
  id: true,
  parentId: true,
  source: true,
  sourceOrder: true,
  sourceHierarchyPath: true,
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
    sourceHierarchyPath: [],
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
    sourceHierarchyPath: [],
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
      workspace: { id: "workspace_1", name: "我們的婚宴" },
    });
    findMany.mockResolvedValue([]);
  });

  it("authorizes before one tenant-scoped deterministic query", async () => {
    await expect(getBudgetPageData("workspace_1")).resolves.toEqual({
      workspaceName: "我們的婚宴",
      canEdit: false,
      canResetBudget: false,
      resetSnapshot: null,
      items: [],
      summary: {
        itemCount: 0,
        paidCount: 0,
        plannedTotal: "0",
        actualTotal: "0",
        balanceDueTotal: "0",
        balanceDueCount: 0,
        balanceDueMissingAmountCount: 0,
        nearestBalanceDueDate: null,
      },
    });

    expect(requireCurrentUser).toHaveBeenCalledWith();
    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "read",
    );
    expect(findMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_1" },
      orderBy: deterministicOrder,
      select,
    });
    expect(requireCurrentUser.mock.invocationCallOrder[0]).toBeLessThan(
      requireWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(requireWorkspaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      findMany.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ["OWNER", true, true],
    ["PARTNER", true, false],
    ["PLANNER", true, false],
    ["VIEWER", false, false],
  ])("maps %s to canEdit=%s and canResetBudget=%s", async (role, canEdit, canResetBudget) => {
    requireWorkspaceAccess.mockResolvedValueOnce({
      role,
      workspace: { id: "workspace_1", name: "我們的婚宴" },
    });

    await expect(getBudgetPageData("workspace_1")).resolves.toMatchObject({
      canEdit,
      canResetBudget,
    });
  });

  it("returns an OWNER-only reset snapshot for ordinary row versions, sources, and attachment IDs", async () => {
    requireWorkspaceAccess.mockResolvedValueOnce({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
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
        sourceHierarchyPath: [],
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
        sourceHierarchyPath: [],
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
      balanceDueMissingAmountCount: 0,
      nearestBalanceDueDate: null,
    });
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    expect(JSON.stringify(data)).not.toContain("PDF-1.7");
    expect(select).not.toHaveProperty("attachments.select.data");
    expect(findMany).toHaveBeenCalledOnce();
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
        sourceHierarchyPath: [
          "婚紗拍攝",
          "其他",
          "合成姓名的小白鞋",
        ],
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
      sourceHierarchyPath: [
        "婚紗拍攝",
        "其他",
        "合成姓名的小白鞋",
      ],
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

  it("rejects a source hierarchy path on a manual row", async () => {
    findMany.mockResolvedValue([
      ...fixedTaxonomyRecords(),
      {
        ...taxonomyExpense({
          id: "manual_with_source_path",
          primaryKey: "ITEM_WEDDING_SHOES",
          relatedTaxonomyItemKey: null,
        }),
        sourceHierarchyPath: ["不可信來源路徑"],
      },
    ]);

    await expect(getBudgetPageData("workspace_1")).rejects.toEqual(
      new BudgetItemDataError(),
    );
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

  it("summarizes only direct balance-due rows with exact amounts, missing values, and the nearest date", async () => {
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

    const data = await getBudgetPageData("workspace_1");

    expect(data.summary).toEqual(
      expect.objectContaining({
        balanceDueTotal: "35666",
        balanceDueCount: 4,
        balanceDueMissingAmountCount: 1,
        nearestBalanceDueDate: "2028-04-30",
      }),
    );
    expect(findMany).toHaveBeenCalledOnce();
  });

  it("preserves outsider denial without touching BudgetItem data", async () => {
    requireWorkspaceAccess.mockRejectedValue(new WorkspaceAccessDeniedError());

    await expect(
      getBudgetPageData("workspace_secret"),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("does not swallow the current-user redirect", async () => {
    const redirectError = new Error("NEXT_REDIRECT");
    requireCurrentUser.mockRejectedValue(redirectError);

    await expect(getBudgetPageData("workspace_1")).rejects.toBe(redirectError);
    expect(requireWorkspaceAccess).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("sanitizes membership and query failures", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new Error("membership database secret"),
    );
    await expect(getBudgetPageData("workspace_1")).rejects.toEqual(
      new BudgetItemDataError("目前無法載入婚禮花費，請稍後再試。"),
    );
    expect(findMany).not.toHaveBeenCalled();

    requireWorkspaceAccess.mockResolvedValue({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
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
