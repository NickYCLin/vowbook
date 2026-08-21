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

import { BudgetItemDataError, getBudgetPageData } from "./budget-list";

function record(
  id: string,
  parentId: string | null,
  sourceOrder: number | null,
  plannedAmount: number,
  actualAmount: number | null,
) {
  return {
    id,
    parentId,
    source: sourceOrder === null ? "MANUAL" : "NOTION",
    sourceOrder,
    name: `合成節點 ${id}`,
    kind: "EXPENSE",
    category: "OTHER_PENDING",
    plannedAmount,
    actualAmount,
    dueDate: null,
    notes: id === "grandchild" ? "<script>synthetic()</script>" : null,
    paid: id === "root",
    paidAt: null,
    bookingStatus: id === "root" ? "PAID" : "PLANNING",
    depositAmount: plannedAmount,
    balanceAmount: null,
    additionalAmount: null,
    estimatedRange: null,
    candidateVendors: null,
    confirmedVendor: null,
    vendorContact: null,
    primaryContact: null,
    version: 0,
    createdAt: new Date(`2027-01-0${sourceOrder ?? 9}T00:00:00.000Z`),
  };
}

describe("Notion Budget tree query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "synthetic_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "VIEWER",
      workspace: { id: "synthetic_workspace", name: "合成婚宴" },
    });
  });

  it("returns a deterministic 3-level tree with exact recursive bigint rollups", async () => {
    findMany.mockResolvedValue([
      record("manual", null, null, 2_147_483_647, 10),
      record("grandchild", "child", 2, 2_147_483_647, null),
      record("child", "root", 1, 2_147_483_647, 20),
      record("root", null, 0, 2_147_483_647, 30),
      record("sibling", "root", 3, 100, null),
    ]);

    const data = await getBudgetPageData("synthetic_workspace");

    expect(data.items.map((item) => [item.id, item.depth])).toEqual([
      ["root", 0],
      ["child", 1],
      ["grandchild", 2],
      ["sibling", 1],
      ["manual", 0],
    ]);
    expect(data.items.map((item) => item.rolledUpPlannedAmount)).toEqual([
      "6442451041",
      "4294967294",
      "2147483647",
      "100",
      "2147483647",
    ]);
    expect(data.items[0]).toMatchObject({
      hasChildren: true,
      rolledUpActualAmount: "50",
      bookingStatus: "PAID",
      source: "NOTION",
    });
    expect(data.summary).toEqual({
      itemCount: 5,
      paidCount: 1,
      plannedTotal: "8589934688",
      actualTotal: "60",
      balanceDueTotal: "0",
      balanceDueCount: 0,
      balanceDueMissingAmountCount: 0,
      nearestBalanceDueDate: null,
    });
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    expect(findMany).toHaveBeenCalledOnce();

    const query = findMany.mock.calls[0][0];
    expect(query.where).toEqual({ workspaceId: "synthetic_workspace" });
    expect(query.select).not.toHaveProperty("externalId");
    expect(query.select).not.toHaveProperty("sourceHash");
    expect(query.select).not.toHaveProperty("workspaceId");
  });

  it.each([
    ["orphan", [record("orphan", "missing", 0, 1, null)]],
    ["self cycle", [record("self", "self", 0, 1, null)]],
    [
      "multi-node cycle",
      [record("a", "b", 0, 1, null), record("b", "a", 1, 1, null)],
    ],
  ])("fails the whole page safely for %s", async (_label, rows) => {
    findMany.mockResolvedValue(rows);

    await expect(getBudgetPageData("synthetic_workspace")).rejects.toEqual(
      new BudgetItemDataError("目前無法載入婚禮花費，請稍後再試。"),
    );
  });
});
