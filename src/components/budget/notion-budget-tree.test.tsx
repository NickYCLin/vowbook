import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./budget-forms", () => ({
  CreateBudgetItemForm: () => <form aria-label="合成新增表單" />,
  EditBudgetItemForm: ({ name }: { name: string }) => (
    <form aria-label={`編輯 ${name}`} />
  ),
  MoveBudgetItemForm: ({ itemName }: { itemName: string }) => (
    <form aria-label={`調整階層位置：${itemName}`} />
  ),
  DeleteBudgetItemForm: ({ name }: { name: string }) => (
    <form aria-label={`刪除 ${name}`} />
  ),
  ChangeBudgetItemBookingStatusForm: ({ itemName }: { itemName: string }) => (
    <form aria-label={`更新狀態 ${itemName}`} />
  ),
}));

import type { BudgetItemListItem, BudgetSummary } from "@/lib/budget-list";
import { BudgetList } from "./budget-list";

const richImportedItem: BudgetItemListItem = {
  id: "synthetic_native_id",
  parentId: "synthetic_parent_id",
  depth: 2,
  hasChildren: true,
  breadcrumb: ["合成根分類", "合成子分類", '<img src=x onerror="synthetic()">'],
  directChildren: [
    {
      id: "synthetic_child_id",
      name: "合成直接子項",
      hasChildren: false,
    },
  ],
  directChildCount: 1,
  directChildSetHash: "1".repeat(64),
  descendantCount: 1,
  source: "NOTION",
  sourceHierarchyPath: ["合成根分類", "合成子分類", '<img src=x onerror="synthetic()">'],
  name: '<img src=x onerror="synthetic()">',
  kind: "EXPENSE",
  category: "OTHER_PENDING",
  directParentName: "合成子分類",
  relatedTaxonomyItemKey: null,
  plannedAmount: 46500,
  rolledUpPlannedAmount: "9007199254740993",
  actualAmount: 12000,
  rolledUpActualAmount: "12000",
  rolledUpDepositAmount: "12000",
  rolledUpBalanceAmount: "34000",
  dueDate: null,
  notes: "<script>synthetic()</script>",
  paid: false,
  paidAt: null,
  bookingStatus: "BOOKED_BALANCE_DUE",
  depositAmount: 12000,
  balanceAmount: 34000,
  additionalAmount: 500,
  estimatedRange: "NT$40,000 ～ NT$60,000",
  candidateVendors: "合成候選廠商",
  confirmedVendor: "合成確認廠商",
  vendorContact: "synthetic-contact@example.test",
  primaryContact: "PARTNER_A",
  version: 3,
};

const summary: BudgetSummary = {
  itemCount: 1,
  paidCount: 0,
  plannedTotal: "46500",
  actualTotal: "12000",
  balanceDueTotal: "34000",
  balanceDueCount: 1,
  balanceDueMissingAmountCount: 0,
  nearestBalanceDueDate: null,
};

describe("Notion Budget tree UI", () => {
  it("renders hierarchy and exact direct/rolled-up amounts with rich fields in details", () => {
    const { container } = render(
      <BudgetList
        workspaceId="synthetic_workspace"
        items={[richImportedItem]}
        summary={summary}
        canEdit
      />,
    );

    expect(screen.queryByText("Notion 匯入")).not.toBeInTheDocument();
    expect(screen.getAllByText("第 3 層").length).toBeGreaterThan(0);
    expect(screen.getByText("本項直接費用").nextSibling).toHaveTextContent(
      "NT$46,500",
    );
    expect(screen.getByText("含子項總計").nextSibling).toHaveTextContent(
      "NT$9,007,199,254,740,993",
    );
    const row = container.querySelector<HTMLElement>(
      "[data-budget-depth='2']",
    );
    const rowSurface = row?.querySelector<HTMLElement>(
      "[data-budget-ledger-surface]",
    );
    expect(within(rowSurface!).getByText("已下訂")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(within(rowSurface!).getByText("已下訂，尾款未清")).toHaveClass(
      "sr-only",
    );
    expect(within(rowSurface!).getByText("訂金").nextSibling).toHaveTextContent(
      "NT$12,000",
    );
    expect(within(rowSurface!).getByText("尾款").nextSibling).toHaveTextContent(
      "NT$34,000",
    );
    expect(
      rowSurface?.querySelector(
        '[data-budget-ledger-content-name="true"]',
      ),
    ).toHaveTextContent("追加：NT$500");
    expect(screen.getByText("合成候選廠商")).toBeInTheDocument();
    expect(screen.getByText("synthetic-contact@example.test")).toBeInTheDocument();
    expect(screen.getByText("新人一方")).toBeInTheDocument();
    expect(screen.getByText("資料來源：Notion 單次匯入")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(row).toHaveClass("min-w-0");
    expect(row).not.toHaveClass("border-l");
    expect(row).not.toHaveClass("pl-2");
    expect(row).toHaveAttribute("data-budget-ledger-row", "leaf");
    expect(rowSurface).toHaveAttribute(
      "data-budget-ledger-surface",
      "leaf-line",
    );
    expect(rowSurface).toHaveAttribute("data-budget-scan-alignment", "shared");
    expect(row?.style.marginInlineStart).toBe("");
    expect(row?.style.paddingInlineStart).toBe("");
    expect(row?.tagName).toBe("ARTICLE");
    expect(row?.querySelector("dialog")).not.toHaveAttribute("open");
    expect(
      row?.querySelector("dialog form[aria-label^='編輯']"),
    ).toBeInTheDocument();
    expect(row?.querySelector("[data-budget-ledger-surface] form")).toBeNull();
    expect(container).not.toHaveTextContent("synthetic_native_id");
  });

  it("does not render any mutation form for VIEWER", () => {
    render(
      <BudgetList
        workspaceId="synthetic_workspace"
        items={[richImportedItem]}
        summary={summary}
        canEdit={false}
      />,
    );

    expect(screen.queryByRole("form", { name: /^編輯 / })).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /^刪除 / })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: /^更新狀態 / }),
    ).not.toBeInTheDocument();
  });
});
