import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
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

vi.mock("@/actions/budget-items", () => actions);

import {
  BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
  BUDGET_INTERNAL_UNCLASSIFIED_STAGE_KEY,
} from "@/domain/budget-item";
import type { BudgetItemListItem, BudgetSummary } from "@/lib/budget-list";
import { BudgetList } from "./budget-list";

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

const summary: BudgetSummary = {
  itemCount: 1,
  paidCount: 0,
  plannedTotal: "120000",
  actualTotal: "0",
  balanceDueTotal: "0",
  balanceDueCount: 0,
  balanceDueMissingAmountCount: 0,
  nearestBalanceDueDate: null,
};

const group: BudgetItemListItem = {
  id: "group_1",
  parentId: null,
  depth: 0,
  hasChildren: true,
  breadcrumb: ["婚紗方案"],
  directChildren: [{ id: "expense_1", name: "婚紗攝影", hasChildren: false }],
  directChildCount: 1,
  directChildSetHash: "1".repeat(64),
  descendantCount: 1,
  source: "MANUAL",
  sourceHierarchyPath: [],
  name: "婚紗方案",
  kind: "GROUP",
  category: null,
  relatedTaxonomyItemKey: null,
  directParentName: null,
  plannedAmount: 0,
  rolledUpPlannedAmount: "120000",
  actualAmount: null,
  rolledUpActualAmount: "0",
  rolledUpDepositAmount: "0",
  rolledUpBalanceAmount: "0",
  dueDate: null,
  notes: "只用於彙總方案",
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

const expense: BudgetItemListItem = {
  id: "expense_1",
  parentId: "group_1",
  depth: 1,
  hasChildren: false,
  breadcrumb: ["婚紗方案", "婚紗攝影"],
  directChildren: [],
  directChildCount: 0,
  directChildSetHash: "0".repeat(64),
  descendantCount: 0,
  source: "MANUAL",
  sourceHierarchyPath: [],
  name: "婚紗攝影",
  kind: "EXPENSE",
  category: "PHOTOGRAPHY_VIDEO",
  relatedTaxonomyItemKey: null,
  directParentName: "婚紗方案",
  plannedAmount: 120000,
  rolledUpPlannedAmount: "120000",
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
  version: 2,
};

const fixedStage: BudgetItemListItem = {
  ...group,
  id: "stage_1",
  name: "籌備第1-2月",
  systemTaxonomyKey: "STAGE_PREPARATION_1_2_MONTHS",
  breadcrumb: ["籌備第1-2月"],
  directChildren: [
    { id: "taxonomy_item_1", name: "婚宴場地", hasChildren: true },
  ],
  directChildSetHash: "2".repeat(64),
  descendantCount: 2,
};

const fixedItem: BudgetItemListItem = {
  ...group,
  id: "taxonomy_item_1",
  parentId: "stage_1",
  depth: 1,
  name: "婚宴場地",
  systemTaxonomyKey: "ITEM_WEDDING_VENUE",
  breadcrumb: ["籌備第1-2月", "婚宴場地"],
  directParentName: "籌備第1-2月",
  directChildren: [
    { id: "venue_expense_1", name: "場地訂金", hasChildren: false },
  ],
  directChildSetHash: "3".repeat(64),
  descendantCount: 1,
};

const fixedVenueExpense: BudgetItemListItem = {
  ...expense,
  id: "venue_expense_1",
  parentId: "taxonomy_item_1",
  depth: 2,
  name: "場地訂金",
  systemTaxonomyKey: null,
  category: "VENUE_CATERING",
  breadcrumb: ["籌備第1-2月", "婚宴場地", "場地訂金"],
  directParentName: "婚宴場地",
};


const photographyStage: BudgetItemListItem = {
  ...fixedStage,
  id: "stage_photography",
  directChildren: [
    { id: "item_photography", name: "婚紗照拍攝", hasChildren: true },
  ],
  descendantCount: 2,
  rolledUpPlannedAmount: "30000",
};

const photographyItem: BudgetItemListItem = {
  ...fixedItem,
  id: "item_photography",
  parentId: "stage_photography",
  name: "婚紗照拍攝",
  systemTaxonomyKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
  breadcrumb: ["籌備第1-2月", "婚紗照拍攝"],
  directChildren: [
    { id: "expense_photography", name: "攝影方案", hasChildren: false },
  ],
  descendantCount: 1,
  rolledUpPlannedAmount: "30000",
};

const photographyExpense: BudgetItemListItem = {
  ...expense,
  id: "expense_photography",
  parentId: "item_photography",
  depth: 2,
  name: "攝影方案",
  systemTaxonomyKey: null,
  category: "PHOTOGRAPHY_VIDEO",
  breadcrumb: ["籌備第1-2月", "婚紗照拍攝", "攝影方案"],
  directParentName: "婚紗照拍攝",
  plannedAmount: 30000,
  rolledUpPlannedAmount: "30000",
};

const attireStage: BudgetItemListItem = {
  ...fixedStage,
  id: "stage_attire",
  name: "籌備婚禮第4個月",
  systemTaxonomyKey: "STAGE_PREPARATION_4_MONTH",
  breadcrumb: ["籌備婚禮第4個月"],
  directChildren: [
    { id: "item_attire", name: "禮服租借", hasChildren: true },
  ],
  descendantCount: 2,
  rolledUpPlannedAmount: "12000",
};

const attireItem: BudgetItemListItem = {
  ...fixedItem,
  id: "item_attire",
  parentId: "stage_attire",
  name: "禮服租借",
  systemTaxonomyKey: "ITEM_ATTIRE_RENTAL",
  breadcrumb: ["籌備婚禮第4個月", "禮服租借"],
  directParentName: "籌備婚禮第4個月",
  directChildren: [
    { id: "expense_attire", name: "拍攝禮服加購", hasChildren: false },
  ],
  descendantCount: 1,
  rolledUpPlannedAmount: "12000",
};

const relatedAttireExpense: BudgetItemListItem = {
  ...expense,
  id: "expense_attire",
  parentId: "item_attire",
  depth: 2,
  name: "拍攝禮服加購",
  systemTaxonomyKey: null,
  category: "ATTIRE_STYLING",
  relatedTaxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
  breadcrumb: ["籌備婚禮第4個月", "禮服租借", "拍攝禮服加購"],
  directParentName: "禮服租借",
  plannedAmount: 12000,
  rolledUpPlannedAmount: "12000",
};

const internalStage: BudgetItemListItem = {
  ...group,
  id: "internal_stage",
  name: "系統保留",
  systemTaxonomyKey: BUDGET_INTERNAL_UNCLASSIFIED_STAGE_KEY,
  breadcrumb: ["系統保留"],
  directChildren: [
    { id: "internal_item", name: "未分類既有項目", hasChildren: true },
  ],
  directChildSetHash: "4".repeat(64),
  descendantCount: 2,
};

const internalItem: BudgetItemListItem = {
  ...group,
  id: "internal_item",
  parentId: "internal_stage",
  depth: 1,
  name: "未分類既有項目",
  systemTaxonomyKey: BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
  breadcrumb: ["系統保留", "未分類既有項目"],
  directParentName: "系統保留",
  directChildren: [
    { id: "legacy_expense", name: "舊交通費", hasChildren: false },
  ],
  directChildSetHash: "5".repeat(64),
  descendantCount: 1,
};

const legacyExpense: BudgetItemListItem = {
  ...expense,
  id: "legacy_expense",
  parentId: "internal_item",
  depth: 2,
  name: "舊交通費",
  systemTaxonomyKey: null,
  category: "TRANSPORT_LODGING",
  breadcrumb: ["系統保留", "未分類既有項目", "舊交通費"],
  directParentName: "未分類既有項目",
};

function selectGroupView(): void {
  expect(
    screen.queryByRole("group", { name: "花費檢視方式" }),
  ).not.toBeInTheDocument();
}

describe("budget taxonomy UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("keeps stages collapsed and fixed while item classifications can add actual entries", () => {
    const { container } = render(
      <BudgetList
        workspaceId="workspace_1"
        items={[fixedStage, fixedItem, fixedVenueExpense]}
        summary={summary}
        canEdit
      />,
    );

    const stageRow = container.querySelector(
      '[data-budget-taxonomy-kind="stage"]',
    );
    const itemRow = container.querySelector(
      '[data-budget-taxonomy-kind="item"]',
    );
    expect(
      screen.queryByRole("heading", { name: "待重新分類的既有資料" }),
    ).not.toBeInTheDocument();
    expect(stageRow).toHaveAttribute(
      "data-budget-hierarchy-level",
      "parent",
    );
    const stageSurface = stageRow?.querySelector(
      "[data-budget-ledger-surface]",
    );
    expect(stageSurface).toHaveAttribute(
      "data-budget-ledger-surface",
      "stage-chapter",
    );
    expect(stageSurface).toHaveAttribute(
      "data-budget-row-layout",
      "hierarchy-ledger",
    );
    expect(
      stageSurface?.querySelector('[data-budget-scan-layout="stage-header"]'),
    ).toHaveClass("bg-clay-soft", "border-line-strong");
    expect(stageRow).not.toHaveTextContent("母分類");
    expect(stageRow).toHaveTextContent("籌備階段");
    expect(itemRow).toHaveAttribute("data-budget-hierarchy-level", "child");
    const itemSurface = itemRow?.querySelector(
      "[data-budget-ledger-surface]",
    );
    expect(itemSurface).toHaveAttribute(
      "data-budget-ledger-surface",
      "taxonomy-child",
    );
    expect(itemSurface).toHaveAttribute(
      "data-budget-row-layout",
      "hierarchy-ledger",
    );
    expect(
      itemSurface?.querySelector(
        '[data-budget-scan-layout="taxonomy-header"]',
      ),
    ).toHaveClass("bg-surface", "border-l-[3px]");
    expect(itemRow).not.toHaveTextContent("子分類");
    expect(itemRow).toHaveTextContent("品項分類");
    expect(
      itemRow?.querySelector('[data-budget-hierarchy-connector="true"]'),
    ).not.toBeNull();
    expect(
      itemSurface?.querySelector('[data-budget-mobile-row="metadata"]'),
    ).toBeNull();
    expect(itemRow).toHaveAttribute("hidden");
    expect(
      screen.getByRole("heading", { name: "籌備第1-2月", level: 3 }),
    ).toBeVisible();

    const stageToggle = screen.getByRole("button", {
      name: "展開籌備階段：籌備第1-2月",
    });
    expect(stageToggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(
      screen.getByRole("button", { name: "管理籌備階段：籌備第1-2月" }),
    );
    const stageDialog = screen.getByRole("dialog", {
      name: "籌備第1-2月",
    });
    expect(stageDialog).toHaveTextContent("固定籌備階段");
    expect(
      within(stageDialog).getByRole("navigation", {
        name: "籌備階段層級路徑",
      }),
    ).toBeVisible();
    expect(
      within(stageDialog).getByRole("region", {
        name: "籌備第1-2月 籌備階段完整資料",
      }),
    ).toBeVisible();
    expect(
      within(stageDialog).queryByText("在此項下新增花費", {
        selector: "summary",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(stageDialog).queryByRole("button", { name: /建立群組/u }),
    ).not.toBeInTheDocument();
    expect(
      within(stageDialog).queryByText("調整所在位置", {
        selector: "summary",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(stageDialog).getByRole("button", {
        name: "關閉管理：籌備第1-2月",
      }),
    );

    fireEvent.click(stageToggle);
    expect(itemRow).not.toHaveAttribute("hidden");
    expect(
      screen.getByRole("heading", { name: "婚宴場地", level: 4 }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "展開品項分類：婚宴場地",
      }),
    ).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(
      screen.getByRole("button", { name: "展開品項分類：婚宴場地" }),
    );
    expect(
      screen.getByRole("heading", { name: "場地訂金", level: 5 }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "管理品項分類：婚宴場地" }),
    );
    const itemDialog = screen.getByRole("dialog", { name: "婚宴場地" });
    expect(itemDialog).toHaveTextContent("固定品項分類");
    expect(
      within(itemDialog).getByRole("navigation", {
        name: "品項分類層級路徑",
      }),
    ).toBeVisible();
    expect(
      within(itemDialog).getByRole("region", {
        name: "婚宴場地 品項分類完整資料",
      }),
    ).toBeVisible();
    expect(
      within(itemDialog).getByText("在此項下新增花費", {
        selector: "summary",
      }),
    ).toBeInTheDocument();
    expect(
      within(itemDialog).getByRole("button", {
        name: "在「婚宴場地」下建立群組",
      }),
    ).toBeInTheDocument();
    expect(
      within(itemDialog).queryByText("調整所在位置", {
        selector: "summary",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(itemDialog).queryByRole("button", {
        name: "編輯群組：婚宴場地",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(itemDialog).queryByRole("form", {
        name: "移除項目：婚宴場地",
      }),
    ).not.toBeInTheDocument();
  }, 10_000);

  it("shows only fixed stages and items that contain workspace data", () => {
    const emptyStage: BudgetItemListItem = {
      ...fixedStage,
      id: "stage_empty",
      name: "籌備第3個月",
      systemTaxonomyKey: "STAGE_PREPARATION_3_MONTH",
      breadcrumb: ["籌備第3個月"],
      directChildren: [
        { id: "item_empty", name: "喜餅", hasChildren: false },
      ],
      directChildCount: 1,
      descendantCount: 1,
      rolledUpPlannedAmount: "0",
      rolledUpActualAmount: "0",
      rolledUpDepositAmount: "0",
      rolledUpBalanceAmount: "0",
    };
    const emptyItem: BudgetItemListItem = {
      ...fixedItem,
      id: "item_empty",
      parentId: emptyStage.id,
      name: "喜餅",
      systemTaxonomyKey: "ITEM_WEDDING_CAKES",
      breadcrumb: ["籌備第3個月", "喜餅"],
      directParentName: "籌備第3個月",
      hasChildren: false,
      directChildren: [],
      directChildCount: 0,
      directChildSetHash: "0".repeat(64),
      descendantCount: 0,
      rolledUpPlannedAmount: "0",
      rolledUpActualAmount: "0",
      rolledUpDepositAmount: "0",
      rolledUpBalanceAmount: "0",
    };
    const { container } = render(
      <BudgetList
        workspaceId="workspace_1"
        items={[
          fixedStage,
          fixedItem,
          fixedVenueExpense,
          emptyStage,
          emptyItem,
        ]}
        summary={summary}
        canEdit={false}
      />,
    );

    expect(
      container.querySelector('[data-budget-item-id="stage_1"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-budget-item-id="taxonomy_item_1"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-budget-item-id="venue_expense_1"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-budget-item-id="stage_empty"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-budget-item-id="item_empty"]'),
    ).toBeNull();
  });

  it("shows a real empty state when the workspace only has empty fixed taxonomy nodes", () => {
    const emptyStage: BudgetItemListItem = {
      ...fixedStage,
      directChildren: [
        { id: "taxonomy_item_1", name: "婚宴場地", hasChildren: false },
      ],
      directChildCount: 1,
      descendantCount: 1,
      rolledUpPlannedAmount: "0",
      rolledUpActualAmount: "0",
      rolledUpDepositAmount: "0",
      rolledUpBalanceAmount: "0",
    };
    const emptyItem: BudgetItemListItem = {
      ...fixedItem,
      hasChildren: false,
      directChildren: [],
      directChildCount: 0,
      directChildSetHash: "0".repeat(64),
      descendantCount: 0,
      rolledUpPlannedAmount: "0",
      rolledUpActualAmount: "0",
      rolledUpDepositAmount: "0",
      rolledUpBalanceAmount: "0",
    };
    const { container } = render(
      <BudgetList
        workspaceId="workspace_empty"
        items={[emptyStage, emptyItem]}
        summary={{
          ...summary,
          itemCount: 0,
          plannedTotal: "0",
          actualTotal: "0",
        }}
        canEdit={false}
      />,
    );

    expect(container.querySelector("[data-budget-taxonomy-kind]")).toBeNull();
    expect(
      screen.getByText("尚無花費明細。分類仍可在新增花費時選擇。"),
    ).toBeVisible();
    expect(screen.queryByText(/尚未準備好分類/u)).not.toBeInTheDocument();
  });

  it("hides internal wrappers and lets a legacy leaf choose one of the 20 Drive items", async () => {
    actions.updateBudgetItemAction.mockResolvedValueOnce({
      status: "success",
      message: "已更新花費項目。",
    });
    render(
      <BudgetList
        workspaceId="workspace_1"
        items={[
          fixedStage,
          fixedItem,
          fixedVenueExpense,
          internalStage,
          internalItem,
          legacyExpense,
        ]}
        summary={{ ...summary, itemCount: 2 }}
        canEdit
      />,
    );

    expect(
      screen.getByRole("heading", { name: "待重新分類的既有資料" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "系統保留" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "未分類既有項目" }),
    ).not.toBeInTheDocument();
    const legacyRow = screen
      .getByRole("heading", { name: "舊交通費" })
      .closest<HTMLElement>("[data-budget-ledger-row]");
    expect(legacyRow).not.toBeNull();
    expect(
      within(legacyRow!).getByText("分類狀態：待重新分類", {
        selector: "[data-budget-category-label]",
      }),
    ).toBeVisible();
    expect(legacyRow).not.toHaveTextContent("系統保留");
    expect(legacyRow).not.toHaveTextContent("未分類既有項目");

    fireEvent.click(
      within(legacyRow!).getByRole("button", {
        name: "開啟花費明細與附件：舊交通費",
      }),
    );
    const managementDialog = screen.getByRole("dialog", { name: "舊交通費" });
    expect(
      within(managementDialog).queryByText("調整所在位置", {
        selector: "summary",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(managementDialog).getByRole("button", {
        name: "編輯項目：舊交通費",
      }),
    );
    const editDialog = screen.getByRole("dialog", { name: "編輯花費項目" });
    const taxonomy = within(editDialog).getByRole("combobox", {
      name: "品項分類",
    });
    expect(taxonomy).toHaveValue("");
    expect(within(taxonomy).getAllByRole("group")).toHaveLength(6);
    expect(within(taxonomy).getAllByRole("option")).toHaveLength(20);
    expect(taxonomy).not.toHaveTextContent("系統保留");
    expect(taxonomy).not.toHaveTextContent("未分類既有項目");

    fireEvent.change(taxonomy, {
      target: { value: "ITEM_WEDDING_VENUE" },
    });
    fireEvent.submit(within(editDialog).getByRole("form", { name: "編輯 舊交通費" }));
    await waitFor(() => expect(actions.updateBudgetItemAction).toHaveBeenCalledOnce());
    const submitted = actions.updateBudgetItemAction.mock.calls[0][3] as FormData;
    expect(submitted.get("taxonomyItemKey")).toBe("ITEM_WEDDING_VENUE");
    expect(submitted.get("taxonomyItemKey")).not.toBe(
      BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
    );
  });

  it("renders group and expense semantics, direct parent context, and searches item names", () => {
    const { container } = render(
      <BudgetList
        workspaceId="workspace_1"
        items={[group, expense]}
        summary={summary}
        canEdit
      />,
    );

    selectGroupView();

    expect(
      screen.queryByRole("group", { name: "花費檢視方式" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "依費用類別" }),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('ul[data-budget-view="group"]'),
    ).not.toBeNull();

    expect(
      container.querySelector('[data-budget-item-kind="GROUP"]'),
    ).toHaveTextContent("群組");
    expect(
      container.querySelector('[data-budget-item-kind="EXPENSE"]'),
    ).toHaveTextContent("婚紗照拍攝");
    const expenseSurface = container.querySelector(
      '[data-budget-item-kind="EXPENSE"] [data-budget-ledger-surface]',
    );

    expect(expenseSurface).toHaveTextContent("婚紗方案 › 婚紗攝影");
    expect(expenseSurface).toHaveTextContent("分類狀態：待重新分類");
    expect(expenseSurface).not.toHaveTextContent("直接上層：婚紗方案");

    fireEvent.change(screen.getByRole("searchbox", { name: "搜尋花費項目" }), {
      target: { value: "婚紗攝影" },
    });
    expect(
      screen.getByText("符合 1 / 1 筆花費、0 / 1 個群組，另顯示 1 個上層群組"),
    ).toBeInTheDocument();
  });

  it("keeps group management neutral and offers a path-scoped child expense form", () => {
    render(
      <BudgetList
        workspaceId="workspace_1"
        items={[group, expense]}
        summary={summary}
        canEdit
      />,
    );

    selectGroupView();

    fireEvent.click(screen.getByRole("button", { name: "管理群組：婚紗方案" }));
    const dialog = screen.getByRole("dialog", { name: "婚紗方案" });
    expect(dialog).toHaveTextContent("婚紗方案");
    expect(dialog).toHaveTextContent("第 1 層");
    expect(dialog).toHaveTextContent("直接上層：無（最上層）");
    expect(dialog).toHaveTextContent("直接子項 1 項");
    expect(dialog).toHaveTextContent("全部下層 1 項");
    expect(dialog).toHaveTextContent("群組");
    expect(
      within(dialog).queryByRole("button", { name: "編輯項目：婚紗方案" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("form", { name: "更新狀態 婚紗方案" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByText("在此項下新增花費", { selector: "summary" }),
    );
    expect(
      within(dialog).getByRole("form", {
        name: "在婚紗方案下新增花費表單",
      }),
    ).toHaveTextContent("建立位置：婚紗方案");
  });

  it("offers a separate hierarchy move form without self or descendant targets", () => {
    render(
      <BudgetList
        workspaceId="workspace_1"
        items={[group, expense]}
        summary={summary}
        canEdit
      />,
    );

    selectGroupView();
    fireEvent.click(screen.getByRole("button", { name: "全部展開" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "開啟花費明細與附件：婚紗攝影",
      }),
    );
    const expenseDialog = screen.getByRole("dialog", { name: "婚紗攝影" });
    fireEvent.click(
      within(expenseDialog).getByText("調整所在位置", { selector: "summary" }),
    );
    const expenseMoveForm = within(expenseDialog).getByRole("form", {
      name: "調整階層位置：婚紗攝影",
    });
    const options = within(expenseMoveForm)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual(["婚紗方案"]);
    expect(options).not.toContain("婚紗攝影");
  });

  it("locks the outer management dialog while a hierarchy move is pending", async () => {
    let finishMove:
      ((state: { status: "success"; message: string }) => void) | undefined;
    actions.moveBudgetItemAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishMove = resolve;
        }),
    );
    render(
      <BudgetList
        workspaceId="workspace_1"
        items={[group, expense]}
        summary={summary}
        canEdit
      />,
    );

    selectGroupView();
    fireEvent.click(screen.getByRole("button", { name: "全部展開" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "開啟花費明細與附件：婚紗攝影",
      }),
    );

    const dialog = screen.getByRole("dialog", { name: "婚紗攝影" });
    fireEvent.click(
      within(dialog).getByText("調整所在位置", { selector: "summary" }),
    );
    const form = within(dialog).getByRole("form", {
      name: "調整階層位置：婚紗攝影",
    });
    fireEvent.change(within(form).getByLabelText("所在位置"), {
      target: { value: "" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "調整位置" }));

    const closeButton = within(dialog).getByRole("button", {
      name: "關閉管理：婚紗攝影",
    });
    await waitFor(() => expect(closeButton).toBeDisabled());
    fireEvent(
      dialog,
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(dialog).toHaveAttribute("open");

    await act(async () => {
      finishMove?.({ status: "success", message: "已調整階層位置。" });
    });
    await waitFor(() => expect(closeButton).not.toBeDisabled());
  });

  it("keeps the outer management dialog locked while child creation is pending", async () => {
    let finishCreate:
      ((state: { status: "success"; message: string }) => void) | undefined;
    actions.createChildBudgetItemAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCreate = resolve;
        }),
    );
    render(
      <BudgetList
        workspaceId="workspace_1"
        items={[group, expense]}
        summary={summary}
        canEdit
      />,
    );

    selectGroupView();

    fireEvent.click(screen.getByRole("button", { name: "管理群組：婚紗方案" }));
    const dialog = screen.getByRole("dialog", { name: "婚紗方案" });
    fireEvent.click(
      within(dialog).getByText("在此項下新增花費", { selector: "summary" }),
    );
    const form = within(dialog).getByRole("form", {
      name: "在婚紗方案下新增花費表單",
    });
    fireEvent.change(within(form).getByLabelText("項目名稱"), {
      target: { value: "合成子項" },
    });
    fireEvent.change(within(form).getByLabelText("品項分類"), {
      target: { value: "ITEM_PRE_WEDDING_PHOTOGRAPHY" },
    });
    fireEvent.change(within(form).getByLabelText("預計花費"), {
      target: { value: "1000" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "新增花費項目" }));

    const closeButton = within(dialog).getByRole("button", {
      name: "關閉管理：婚紗方案",
    });
    await waitFor(() => expect(closeButton).toBeDisabled());
    fireEvent(
      dialog,
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(dialog).toHaveAttribute("open");

    await act(async () => {
      finishCreate?.({
        status: "success",
        message: "已在指定項目下新增花費。",
      });
    });
    await waitFor(() => expect(closeButton).not.toBeDisabled());
  });

  it("shows edit-dialog hierarchy context and the six-stage, 20-item Drive taxonomy select", () => {
    render(
      <BudgetList
        workspaceId="workspace_1"
        items={[fixedStage, fixedItem, fixedVenueExpense]}
        summary={summary}
        canEdit
      />,
    );

    selectGroupView();
    fireEvent.click(screen.getByRole("button", { name: "全部展開" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "開啟花費明細與附件：場地訂金",
      }),
    );
    const managementDialog = screen.getByRole("dialog", {
      name: "場地訂金",
    });
    fireEvent.click(
      within(managementDialog).getByRole("button", {
        name: "編輯項目：場地訂金",
      }),
    );

    const editDialog = screen.getByRole("dialog", { name: "編輯花費項目" });
    expect(editDialog).toHaveTextContent("籌備第1-2月 › 婚宴場地 › 場地訂金");
    expect(editDialog).toHaveTextContent("第 3 層");
    expect(editDialog).toHaveTextContent("直接上層：婚宴場地");
    expect(editDialog).toHaveTextContent("直接子項 0 項");
    expect(editDialog).toHaveTextContent("全部下層 0 項");

    const category = within(editDialog).getByRole("combobox", {
      name: "品項分類",
    });
    expect(category).toHaveValue("ITEM_WEDDING_VENUE");
    expect(within(category).getAllByRole("group")).toHaveLength(6);
    expect(within(category).getAllByRole("option")).toHaveLength(20);
    expect(category).toHaveTextContent("婚紗照拍攝");
    expect(category).not.toHaveTextContent("其他");
    expect(category).not.toHaveTextContent("待分類");
  });


  it("keeps attire and styling in their Drive item while showing a single-count photography extension reference", () => {
    const relatedSummary: BudgetSummary = {
      ...summary,
      itemCount: 2,
      plannedTotal: "42000",
    };
    const { container } = render(
      <BudgetList
        workspaceId="workspace_1"
        items={[
          photographyStage,
          photographyItem,
          photographyExpense,
          attireStage,
          attireItem,
          relatedAttireExpense,
        ]}
        summary={relatedSummary}
        canEdit
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "全部展開" }));

    const canonicalRow = container.querySelector<HTMLElement>(
      '[data-budget-item-id="expense_attire"]',
    );
    expect(canonicalRow).not.toBeNull();
    expect(canonicalRow).toHaveTextContent("品項分類：禮服租借");
    expect(
      within(canonicalRow!).getByText("拍攝延伸", {
        selector: '[data-budget-relation-badge="true"]',
      }),
    ).toBeVisible();
    expect(canonicalRow).toHaveTextContent("用途：婚紗照拍攝");

    const photographyRow = container.querySelector<HTMLElement>(
      '[data-budget-item-id="item_photography"]',
    );
    expect(photographyRow).not.toBeNull();
    expect(
      within(photographyRow!).getByRole("group", {
        name: "品項分類預計花費：NT$30,000",
      }),
    ).toBeVisible();
    const referenceBlock = within(photographyRow!).getByRole("region", {
      name: "婚紗照拍攝的關聯延伸費用",
    });
    expect(referenceBlock).toHaveTextContent("關聯延伸費用 · 1 筆");
    expect(referenceBlock).toHaveTextContent(
      "下列費用保留原本主分類，只在此顯示拍攝用途；不計入本分類小計，總額只計一次。",
    );
    expect(referenceBlock).toHaveTextContent("拍攝禮服加購");
    expect(referenceBlock).toHaveTextContent("歸屬：禮服租借");
    expect(referenceBlock).toHaveTextContent("預計 NT$12,000");
    expect(referenceBlock).toHaveTextContent(
      "關聯預計費用小計（不計入本分類）NT$12,000",
    );
    const sourceLink = within(referenceBlock).getByRole("link", {
      name: "前往原始花費：拍攝禮服加購",
    });
    expect(sourceLink).toHaveAttribute("href", "#budget-item-row-expense_attire");

    fireEvent.click(
      screen.getByRole("button", { name: "收合籌備階段：籌備婚禮第4個月" }),
    );
    expect(canonicalRow).toHaveAttribute("hidden");
    fireEvent.click(sourceLink);
    expect(canonicalRow).not.toHaveAttribute("hidden");
    expect(canonicalRow).toHaveFocus();

    const searchbox = screen.getByRole("searchbox", { name: "搜尋花費項目" });
    expect(searchbox).toHaveAttribute(
      "placeholder",
      "名稱、品項分類、用途或廠商",
    );
    fireEvent.change(searchbox, {
      target: { value: "用途" },
    });
    expect(canonicalRow).not.toHaveAttribute("hidden");
    expect(
      screen.getByText(
        "符合 1 / 2 筆花費、0 / 4 個群組，另顯示 2 個上層群組",
      ),
    ).toBeVisible();
  });

  it("shows photography extension references even before the target item has a direct expense", () => {
    const emptyPhotographyStage: BudgetItemListItem = {
      ...photographyStage,
      directChildren: [
        { id: "item_photography", name: "婚紗照拍攝", hasChildren: false },
      ],
      descendantCount: 1,
      rolledUpPlannedAmount: "0",
    };
    const emptyPhotographyItem: BudgetItemListItem = {
      ...photographyItem,
      hasChildren: false,
      directChildren: [],
      directChildCount: 0,
      directChildSetHash: "0".repeat(64),
      descendantCount: 0,
      rolledUpPlannedAmount: "0",
    };
    const { container } = render(
      <BudgetList
        workspaceId="workspace_1"
        items={[
          emptyPhotographyStage,
          emptyPhotographyItem,
          attireStage,
          attireItem,
          relatedAttireExpense,
        ]}
        summary={{ ...summary, itemCount: 1, plannedTotal: "12000" }}
        canEdit
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "展開籌備階段：籌備第1-2月" }),
    );

    const photographyRow = container.querySelector<HTMLElement>(
      '[data-budget-item-id="item_photography"]',
    );
    expect(photographyRow).not.toBeNull();
    const relatedDisclosure = within(photographyRow!).getByRole("button", {
      name: "展開品項分類：婚紗照拍攝",
    });
    expect(relatedDisclosure).toHaveAttribute(
      "aria-controls",
      "budget-item-row-item_photography-related-expenses",
    );
    expect(
      within(photographyRow!).queryByRole("region", {
        name: "婚紗照拍攝的關聯延伸費用",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(relatedDisclosure);
    expect(
      within(photographyRow!).getByRole("region", {
        name: "婚紗照拍攝的關聯延伸費用",
      }),
    ).toBeVisible();
  });

  it("keeps long Latin tokens contained at the exact mobile contract width", () => {
    const longName = "VeryLongUnbrokenSyntheticBudgetToken".repeat(12);
    const { container } = render(
      <div style={{ width: "390px" }}>
        <BudgetList
          workspaceId="workspace_1"
          items={[{ ...expense, id: "long", name: longName }]}
          summary={summary}
          canEdit={false}
        />
      </div>,
    );
    expect(screen.getByRole("heading", { name: longName })).toHaveClass(
      "break-words",
    );
    expect(container.querySelector("dialog")).toHaveClass("overflow-x-hidden");
  });
});
