import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/actions/budget-items", () => ({
  addBudgetEngagementSuggestionsAction: vi.fn(),
  addBudgetPreparationSuggestionsAction: vi.fn(),
  createBudgetGroupAction: vi.fn(),
  dissolveBudgetGroupAction: vi.fn(),
  updateBudgetGroupAction: vi.fn(),
  createBudgetItemAction: vi.fn(),
  createChildBudgetItemAction: vi.fn(),
  updateBudgetItemAction: vi.fn(),
  changeBudgetItemBookingStatusAction: vi.fn(),
  moveBudgetItemAction: vi.fn(),
  deleteBudgetItemAction: vi.fn(),
}));

import { BudgetList } from "./budget-list";
import type { BudgetItemListItem, BudgetSummary } from "@/lib/budget-list";

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
});

const item: BudgetItemListItem = {
  id: "budget_internal",
  parentId: null,
  depth: 0,
  hasChildren: false,
  breadcrumb: ["婚禮攝影"],
  directChildren: [],
  directChildCount: 0,
  directChildSetHash: "0".repeat(64),
  descendantCount: 0,
  source: "MANUAL",
  sourceHierarchyPath: [],
  name: "婚禮攝影",
  kind: "EXPENSE",
  category: "PHOTOGRAPHY_VIDEO",
  relatedTaxonomyItemKey: null,
  directParentName: null,
  plannedAmount: 88000,
  rolledUpPlannedAmount: "88000",
  actualAmount: null,
  rolledUpActualAmount: "0",
  rolledUpDepositAmount: "0",
  rolledUpBalanceAmount: "0",
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
  version: 1,
};

const summary: BudgetSummary = {
  itemCount: 1,
  paidCount: 0,
  plannedTotal: "88000",
  actualTotal: "0",
  balanceDueTotal: "0",
  balanceDueCount: 0,
  balanceDueMissingAmountCount: 0,
  nearestBalanceDueDate: null,
};

describe("budget nested dialog focus containment", () => {
  it("cycles inside the top edit dialog without moving focus to its parent", () => {
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={[item]}
        summary={summary}
        canEdit
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "開啟花費明細與附件：婚禮攝影",
      }),
    );
    const managementDialog = screen.getByRole("dialog", {
      name: "婚禮攝影",
    });
    const managementFirst = within(managementDialog).getByRole("button", {
      name: "關閉管理：婚禮攝影",
    });
    const managementLast = within(managementDialog).getByText("移除項目", {
      selector: "summary",
    });

    managementLast.focus();
    fireEvent.keyDown(managementLast, { key: "Tab" });
    expect(managementFirst).toHaveFocus();

    fireEvent.keyDown(managementFirst, { key: "Tab", shiftKey: true });
    expect(managementLast).toHaveFocus();

    fireEvent.click(
      within(managementDialog).getByRole("button", {
        name: "編輯項目：婚禮攝影",
      }),
    );

    const editDialog = screen.getByRole("dialog", {
      name: "編輯花費項目",
    });
    const first = within(editDialog).getByRole("button", {
      name: "關閉編輯花費項目：婚禮攝影",
    });
    const last = within(editDialog).getByRole("button", {
      name: "儲存花費項目",
    });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    expect(managementFirst).not.toHaveFocus();

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    expect(managementLast).not.toHaveFocus();
  });
});
