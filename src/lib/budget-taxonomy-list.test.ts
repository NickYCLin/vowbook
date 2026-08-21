import { beforeEach, describe, expect, it, vi } from "vitest";

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
  BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
  BUDGET_INTERNAL_UNCLASSIFIED_STAGE_KEY,
  BUDGET_SYSTEM_NODES,
  BUDGET_TAXONOMY_STAGES,
} from "@/domain/budget-item";

import { getBudgetPageData } from "./budget-list";

function record({
  id,
  parentId,
  name,
  kind,
  category,
  plannedAmount,
  actualAmount,
}: {
  id: string;
  parentId: string | null;
  name: string;
  kind: "GROUP" | "EXPENSE";
  category:
    | "VENUE_CATERING"
    | "PHOTOGRAPHY_VIDEO"
    | "TRANSPORT_LODGING"
    | "OTHER_PENDING"
    | null;
  plannedAmount: number;
  actualAmount: number | null;
}) {
  return {
    id,
    parentId,
    source: "MANUAL",
    sourceOrder: null,
    name,
    kind,
    category,
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
    createdAt: new Date("2027-01-01T00:00:00.000Z"),
  };
}

function fixedTaxonomyRecords() {
  const ids = new Map(
    BUDGET_SYSTEM_NODES.map((node) => [node.key, `fixed_${node.key}`]),
  );
  return BUDGET_SYSTEM_NODES.map((node) => ({
    ...record({
      id: ids.get(node.key) as string,
      parentId:
        node.parentKey === null
          ? null
          : (ids.get(node.parentKey) as string),
      name: node.label,
      kind: "GROUP",
      category: null,
      plannedAmount: 0,
      actualAmount: null,
    }),
    sourceOrder: node.sourceOrder,
    systemTaxonomyKey: node.key,
  }));
}

describe("budget taxonomy view model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "VIEWER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
    });
  });

  it("returns group/expense semantics, typed categories, breadcrumbs, and direct parents", async () => {
    findMany.mockResolvedValue([
      record({
        id: "group",
        parentId: null,
        name: "婚紗方案",
        kind: "GROUP",
        category: null,
        plannedAmount: 0,
        actualAmount: null,
      }),
      record({
        id: "venue",
        parentId: "group",
        name: "合成場地",
        kind: "EXPENSE",
        category: "VENUE_CATERING",
        plannedAmount: 100,
        actualAmount: null,
      }),
      record({
        id: "photo",
        parentId: "group",
        name: "合成攝影",
        kind: "EXPENSE",
        category: "PHOTOGRAPHY_VIDEO",
        plannedAmount: 200,
        actualAmount: null,
      }),
    ]);

    const data = await getBudgetPageData("workspace_1");

    expect(data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "group",
          kind: "GROUP",
          category: null,
          directParentName: null,
          rolledUpPlannedAmount: "300",
        }),
        expect.objectContaining({
          id: "venue",
          kind: "EXPENSE",
          category: "VENUE_CATERING",
          breadcrumb: ["婚紗方案", "合成場地"],
          directParentName: "婚紗方案",
        }),
      ]),
    );
    expect(data.summary).toMatchObject({
      itemCount: 2,
      paidCount: 0,
      plannedTotal: "300",
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ kind: true, category: true }),
      }),
    );
  });

  it("validates all fixed nodes while keeping only six Drive stages and twenty Drive items public", async () => {
    findMany.mockResolvedValue([
      ...fixedTaxonomyRecords(),
      {
        ...record({
          id: "custom_photo_package",
          parentId: "fixed_ITEM_WEDDING_PHOTOGRAPHY",
          name: "婚紗攝影方案",
          kind: "GROUP",
          category: null,
          plannedAmount: 0,
          actualAmount: null,
        }),
        systemTaxonomyKey: null,
      },
      {
        ...record({
          id: "photo_expense",
          parentId: "custom_photo_package",
          name: "攝影團隊",
          kind: "EXPENSE",
          category: "PHOTOGRAPHY_VIDEO",
          plannedAmount: 50000,
          actualAmount: null,
        }),
        systemTaxonomyKey: null,
      },
    ]);

    const data = await getBudgetPageData("workspace_1");

    expect(BUDGET_TAXONOMY_STAGES).toHaveLength(6);
    expect(
      BUDGET_TAXONOMY_STAGES.reduce(
        (total, stage) => total + stage.items.length,
        0,
      ),
    ).toBe(20);
    expect(
      data.items.filter((item) => item.systemTaxonomyKey !== null),
    ).toHaveLength(28);
    expect(
      data.items.find((item) => item.id === "custom_photo_package"),
    ).toMatchObject({
      parentId: "fixed_ITEM_WEDDING_PHOTOGRAPHY",
      depth: 2,
      systemTaxonomyKey: null,
    });
    expect(
      data.items.find((item) => item.id === "photo_expense"),
    ).toMatchObject({
      depth: 3,
      category: "PHOTOGRAPHY_VIDEO",
    });
  });

  it("fails closed when an expense category disagrees with its fixed item", async () => {
    findMany.mockResolvedValue([
      ...fixedTaxonomyRecords(),
      {
        ...record({
          id: "mismatched",
          parentId: "fixed_ITEM_WEDDING_PHOTOGRAPHY",
          name: "錯置場地",
          kind: "EXPENSE",
          category: "VENUE_CATERING",
          plannedAmount: 1,
          actualAmount: null,
        }),
        systemTaxonomyKey: null,
      },
    ]);

    await expect(getBudgetPageData("workspace_1")).rejects.toThrow(
      "目前無法載入婚禮花費，請稍後再試。",
    );
  });

  it("keeps an exact-name legacy tree with mixed categories below the internal item", async () => {
    findMany.mockResolvedValue([
      ...fixedTaxonomyRecords(),
      {
        ...record({
          id: "legacy_pending_group",
          parentId: `fixed_${BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY}`,
          name: "喜餅",
          kind: "GROUP",
          category: null,
          plannedAmount: 0,
          actualAmount: null,
        }),
        systemTaxonomyKey: null,
      },
      {
        ...record({
          id: "legacy_venue",
          parentId: "legacy_pending_group",
          name: "既有場地費",
          kind: "EXPENSE",
          category: "VENUE_CATERING",
          plannedAmount: 100,
          actualAmount: null,
        }),
        systemTaxonomyKey: null,
      },
      {
        ...record({
          id: "legacy_transport",
          parentId: "legacy_pending_group",
          name: "既有交通費",
          kind: "EXPENSE",
          category: "TRANSPORT_LODGING",
          plannedAmount: 200,
          actualAmount: null,
        }),
        systemTaxonomyKey: null,
      },
    ]);

    const data = await getBudgetPageData("workspace_1");

    expect(data.items.find((item) => item.id === "legacy_venue")).toMatchObject({
      category: "VENUE_CATERING",
      breadcrumb: ["系統保留", "未分類既有項目", "喜餅", "既有場地費"],
    });
    expect(
      data.items.find((item) => item.id === "legacy_transport"),
    ).toMatchObject({ category: "TRANSPORT_LODGING" });
  });

  it.each([
    [
      "missing fixed node",
      (records: ReturnType<typeof fixedTaxonomyRecords>) => records.slice(1),
    ],
    [
      "renamed fixed node",
      (records: ReturnType<typeof fixedTaxonomyRecords>) =>
        records.map((item) =>
          item.systemTaxonomyKey === "ITEM_PROPOSAL"
            ? { ...item, name: "自訂提親" }
            : item,
        ),
    ],
    [
      "reparented fixed item",
      (records: ReturnType<typeof fixedTaxonomyRecords>) =>
        records.map((item) =>
          item.systemTaxonomyKey === "ITEM_PROPOSAL"
            ? {
                ...item,
                parentId: `fixed_${BUDGET_INTERNAL_UNCLASSIFIED_STAGE_KEY}`,
              }
            : item,
        ),
    ],
  ])("fails closed for %s", async (_label, mutate) => {
    findMany.mockResolvedValue(mutate(fixedTaxonomyRecords()));
    await expect(getBudgetPageData("workspace_1")).rejects.toThrow(
      "目前無法載入婚禮花費，請稍後再試。",
    );
  });

  it("treats an explicitly present null taxonomy key as the strict production contract", async () => {
    findMany.mockResolvedValue([
      {
        ...record({
          id: "ordinary_root",
          parentId: null,
          name: "不可成為根節點",
          kind: "EXPENSE",
          category: "OTHER_PENDING",
          plannedAmount: 1,
          actualAmount: null,
        }),
        systemTaxonomyKey: null,
      },
    ]);
    await expect(getBudgetPageData("workspace_1")).rejects.toThrow(
      "目前無法載入婚禮花費，請稍後再試。",
    );
  });

  it("fails closed when an ordinary node is attached directly below a stage", async () => {
    findMany.mockResolvedValue([
      ...fixedTaxonomyRecords(),
      {
        ...record({
          id: "ordinary_below_stage",
          parentId: "fixed_STAGE_PREPARATION_1_2_MONTHS",
          name: "錯誤層級",
          kind: "GROUP",
          category: null,
          plannedAmount: 0,
          actualAmount: null,
        }),
        systemTaxonomyKey: null,
      },
    ]);
    await expect(getBudgetPageData("workspace_1")).rejects.toThrow(
      "目前無法載入婚禮花費，請稍後再試。",
    );
  });
});
