import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./budget-forms", () => ({
  CreateBudgetItemForm: ({
    parentId = null,
    parentBreadcrumb = [],
  }: {
    parentId?: string | null;
    parentBreadcrumb?: string[];
  }) => (
    <form
      aria-label={
        parentId === null
          ? "新增花費表單"
          : `在${parentBreadcrumb.at(-1) ?? "指定項目"}下新增花費表單`
      }
      data-parent-id={parentId ?? undefined}
    >
      <button type="submit">提交新增</button>
    </form>
  ),
  ResetBudgetDataForm: ({
    workspaceName,
    snapshot,
  }: {
    workspaceName: string;
    snapshot: { itemCount: number };
  }) => (
    <section aria-label="資料重建">
      OWNER 重建 {workspaceName} {snapshot.itemCount}
    </section>
  ),
  EditBudgetItemForm: ({ name }: { name: string }) => (
    <form aria-label={`編輯 ${name}`}>
      <label>
        項目名稱
        <input defaultValue={name} />
      </label>
      <button type="button" aria-label={`編輯項目：${name}`}>
        編輯項目
      </button>
    </form>
  ),
  MoveBudgetItemForm: ({ itemName }: { itemName: string }) => (
    <form aria-label={`調整階層位置：${itemName}`} />
  ),
  DeleteBudgetItemForm: ({
    name,
    onSuccess,
  }: {
    name: string;
    onSuccess?: () => void;
  }) => (
    <form aria-label={`移除項目：${name}`}>
      <button
        type="button"
        aria-label={`移除項目：${name}`}
        onClick={() => onSuccess?.()}
      >
        移除項目
      </button>
    </form>
  ),
  ChangeBudgetItemBookingStatusForm: ({
    itemName,
    onPendingChange,
  }: {
    itemName: string;
    onPendingChange?: (pending: boolean) => void;
  }) => (
    <form aria-label={`更新狀態 ${itemName}`}>
      <button type="submit">更新狀態 {itemName}</button>
      <button type="button" onClick={() => onPendingChange?.(true)}>
        模擬狀態處理中
      </button>
      <button type="button" onClick={() => onPendingChange?.(false)}>
        結束狀態處理
      </button>
    </form>
  ),
}));

vi.mock("./budget-group-forms", () => ({
  CreateBudgetGroupDialog: ({
    parentId = null,
    parentBreadcrumb = [],
    onSuccess,
  }: {
    parentId?: string | null;
    parentBreadcrumb?: string[];
    onSuccess?: (message: string) => void;
  }) => {
    const parentName = parentBreadcrumb.at(-1) ?? "指定項目";
    return (
      <button
        type="button"
        aria-label={
          parentId === null ? "建立群組" : `在「${parentName}」下建立群組`
        }
        onClick={() => onSuccess?.("已建立群組。")}
      >
        建立群組
      </button>
    );
  },
  EditBudgetGroupDialog: ({
    name,
    onSuccess,
  }: {
    name: string;
    onSuccess?: (message: string) => void;
  }) => (
    <button
      type="button"
      aria-label={`編輯群組：${name}`}
      onClick={() => onSuccess?.("已更新群組。")}
    >
      編輯群組
    </button>
  ),
  DissolveBudgetGroupForm: ({
    name,
    directChildCount,
    directParentName,
    onSuccess,
    onPendingChange,
  }: {
    name: string;
    directChildCount: number;
    directParentName: string | null;
    onSuccess?: (message: string) => void;
    onPendingChange?: (pending: boolean) => void;
  }) => (
    <form aria-label={`移除群組並保留項目：${name}`}>
      <p>
        {directChildCount} 個直接子項會移到
        {directParentName === null ? "最上層" : `原上層「${directParentName}」`}
        。
      </p>
      <button
        type="button"
        aria-label={`移除群組並保留項目：${name}`}
        onClick={() => onSuccess?.("已移除群組並保留其中項目。")}
      >
        移除群組並保留項目
      </button>
      <button type="button" onClick={() => onPendingChange?.(true)}>
        模擬移除群組處理中
      </button>
    </form>
  ),
  DeleteBudgetGroupSubtreeDialog: ({
    name,
    descendantCount,
    attachmentCount,
    onSuccess,
    onPendingChange,
  }: {
    name: string;
    descendantCount: number;
    attachmentCount: number;
    onSuccess?: (message: string) => void;
    onPendingChange?: (pending: boolean) => void;
  }) => (
    <form aria-label={`永久刪除群組：${name}`}>
      <p>
        下層 {descendantCount} 筆，附件 {attachmentCount} 個
      </p>
      <button
        type="button"
        aria-label={`永久刪除群組：${name}`}
        onClick={() => onSuccess?.("已永久刪除群組與全部下層項目。")}
      >
        永久刪除群組與全部下層
      </button>
      <button type="button" onClick={() => onPendingChange?.(true)}>
        模擬永久刪除處理中
      </button>
    </form>
  ),
}));

vi.mock("./budget-engagement-preset", () => ({
  BudgetEngagementPreset: ({
    existingSuggestionKeys,
    onSuccess,
  }: {
    existingSuggestionKeys: ReadonlySet<string>;
    onSuccess?: (message: string) => void;
  }) => (
    <button
      type="button"
      data-existing-suggestion-keys={[...existingSuggestionKeys].sort().join(",")}
      onClick={() => onSuccess?.("已加入文定品項。")}
    >
      測試文定建議
    </button>
  ),
}));

vi.mock("./budget-preparation-preset", () => ({
  BudgetPreparationPreset: ({
    existingSuggestionKeys,
    onSuccess,
  }: {
    existingSuggestionKeys: ReadonlySet<string>;
    onSuccess?: (message: string) => void;
  }) => (
    <button
      type="button"
      data-existing-suggestion-keys={[...existingSuggestionKeys].sort().join(",")}
      onClick={() => onSuccess?.("已加入常見婚禮項目。")}
    >
      測試常見婚禮建議
    </button>
  ),
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

beforeEach(() => {
  window.localStorage.clear();
});

const summary: BudgetSummary = {
  itemCount: 2,
  paidCount: 1,
  plannedTotal: "208000",
  actualTotal: "118000",
  balanceDueTotal: "90000",
  balanceDueCount: 2,
  balanceDueMissingAmountCount: 1,
  nearestBalanceDueDate: "2027-12-31",
};

const items: BudgetItemListItem[] = [
  {
    id: "budget_unpaid_internal",
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
  },
  {
    id: "budget_paid_internal",
    parentId: null,
    depth: 0,
    hasChildren: false,
    breadcrumb: ["婚宴場地"],
    directChildren: [],
    directChildCount: 0,
    directChildSetHash: "0".repeat(64),
    descendantCount: 0,
    source: "MANUAL",
    sourceHierarchyPath: [],
    name: "婚宴場地",
    kind: "EXPENSE",
    category: "VENUE_CATERING",
    relatedTaxonomyItemKey: null,
    directParentName: null,
    plannedAmount: 120000,
    rolledUpPlannedAmount: "120000",
    actualAmount: 118000,
    rolledUpActualAmount: "118000",
    rolledUpDepositAmount: "0",
    rolledUpBalanceAmount: "0",
    dueDate: "2028-02-29",
    notes: "含訂金與尾款",
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
    version: 2,
  },
];

const groupedItems: BudgetItemListItem[] = [
  {
    ...items[0],
    id: "budget_group_internal",
    name: "婚紗方案",
    kind: "GROUP",
    category: null,
    hasChildren: true,
    breadcrumb: ["婚紗方案"],
    directChildren: [
      { id: "budget_venue_internal", name: "禮服租借", hasChildren: false },
      { id: "budget_host_internal", name: "造型服務", hasChildren: false },
    ],
    directChildCount: 2,
    directChildSetHash: "1".repeat(64),
    descendantCount: 2,
    subtreeDeleteSnapshot: {
      token: "2".repeat(64),
      itemCount: 3,
      attachmentCount: 1,
    },
    plannedAmount: 0,
    rolledUpPlannedAmount: "150000",
    actualAmount: null,
    rolledUpActualAmount: "108000",
    rolledUpDepositAmount: "0",
    rolledUpBalanceAmount: "0",
  },
  {
    ...items[1],
    id: "budget_venue_internal",
    parentId: "budget_group_internal",
    depth: 1,
    name: "禮服租借",
    breadcrumb: ["婚紗方案", "禮服租借"],
    directParentName: "婚紗方案",
    category: "ATTIRE_STYLING",
    plannedAmount: 120000,
    rolledUpPlannedAmount: "120000",
    actualAmount: 100000,
    rolledUpActualAmount: "100000",
    rolledUpDepositAmount: "0",
    rolledUpBalanceAmount: "0",
    attachments: [
      {
        id: "attachment_venue_contract",
        originalName: "場地合約.pdf",
        mediaType: "application/pdf",
        byteSize: 2048,
        createdAt: "2027-01-02T03:04:05.000Z",
      },
    ],
  },
  {
    ...items[0],
    id: "budget_host_internal",
    parentId: "budget_group_internal",
    depth: 1,
    name: "造型服務",
    breadcrumb: ["婚紗方案", "造型服務"],
    directParentName: "婚紗方案",
    category: "PEOPLE_SERVICES",
    plannedAmount: 30000,
    rolledUpPlannedAmount: "30000",
    actualAmount: 8000,
    rolledUpActualAmount: "8000",
    rolledUpDepositAmount: "0",
    rolledUpBalanceAmount: "0",
    bookingStatus: "BOOKED_BALANCE_DUE",
  },
];

const emptyGroup: BudgetItemListItem = {
  ...groupedItems[0],
  id: "budget_empty_group_internal",
  name: "尚未整理的方案",
  hasChildren: false,
  breadcrumb: ["尚未整理的方案"],
  directChildren: [],
  directChildCount: 0,
  descendantCount: 0,
  subtreeDeleteSnapshot: undefined,
  rolledUpPlannedAmount: "0",
  rolledUpActualAmount: "0",
  rolledUpDepositAmount: "0",
  rolledUpBalanceAmount: "0",
};

function ledgerListItem(itemId: string): HTMLElement {
  const article = document.querySelector<HTMLElement>(
    '[data-budget-item-id="' + itemId + '"]',
  );
  const listItem = article?.closest<HTMLElement>("li");
  if (!listItem) {
    throw new Error("missing budget ledger item " + itemId);
  }
  return listItem;
}

function selectGroupView(): void {
  expect(
    screen.queryByRole("group", { name: "花費檢視方式" }),
  ).not.toBeInTheDocument();
}

describe("BudgetList", () => {
  it("passes existing suggestion keys to both presets only for editors", () => {
    const suggestedItems = [
      {
        ...items[0],
        suggestionKey: "ENGAGEMENT_GROOM_RED_ENVELOPE",
      },
      {
        ...items[1],
        suggestionKey: "ENGAGEMENT_BRIDE_TEA_SET",
      },
    ] as BudgetItemListItem[];
    const view = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={suggestedItems}
        summary={summary}
        canEdit
      />,
    );

    const preset = screen.getByRole("button", { name: "測試文定建議" });
    expect(preset).toHaveAttribute(
      "data-existing-suggestion-keys",
      "ENGAGEMENT_BRIDE_TEA_SET,ENGAGEMENT_GROOM_RED_ENVELOPE",
    );
    fireEvent.click(preset);
    expect(screen.getByRole("status")).toHaveTextContent("已加入文定品項。");

    const preparationPreset = screen.getByRole("button", {
      name: "測試常見婚禮建議",
    });
    expect(preparationPreset).toHaveAttribute(
      "data-existing-suggestion-keys",
      "ENGAGEMENT_BRIDE_TEA_SET,ENGAGEMENT_GROOM_RED_ENVELOPE",
    );
    fireEvent.click(preparationPreset);
    expect(screen.getByRole("status")).toHaveTextContent(
      "已加入常見婚禮項目。",
    );

    view.rerender(
      <BudgetList
        workspaceId="workspace_internal"
        items={suggestedItems}
        summary={summary}
        canEdit={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "測試文定建議" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "測試常見婚禮建議" }),
    ).not.toBeInTheDocument();
  });

  it("renders the group hierarchy as the only budget view", () => {
    const { container } = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={groupedItems}
        summary={{ ...summary, itemCount: 2 }}
        canEdit={false}
      />,
    );

    expect(
      screen.queryByRole("group", { name: "花費檢視方式" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "全部花費" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "依費用類別" }),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('ul[data-budget-view="group"]'),
    ).not.toBeNull();
    expect(screen.getByRole("heading", { name: "婚紗方案" })).toBeVisible();
    expect(screen.getByRole("button", { name: "全部展開" })).toBeVisible();
    const groupToggle = screen.getByRole("button", {
      name: "展開群組：婚紗方案",
    });
    expect(groupToggle).toHaveAttribute("aria-expanded", "false");
    expect(ledgerListItem("budget_venue_internal")).toHaveAttribute("hidden");
    fireEvent.click(groupToggle);
    expect(ledgerListItem("budget_venue_internal")).not.toHaveAttribute(
      "hidden",
    );
    expect(
      ledgerListItem("budget_venue_internal").querySelector("article"),
    ).toHaveAttribute("data-budget-depth", "1");
  });

  it("makes expense creation primary while groups stay optional in the single group view", () => {
    const { container } = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={items}
        summary={summary}
        canEdit
      />,
    );

    expect(
      screen.queryByRole("group", { name: "花費檢視方式" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "全部花費" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "依費用類別" }),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('ul[data-budget-view="group"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-budget-view="stage"]')).toBeNull();

    const actionToolbar = container.querySelector<HTMLElement>(
      "[data-budget-actions-toolbar]",
    );
    expect(actionToolbar).not.toBeNull();
    const actionDisclosures = Array.from(actionToolbar!.children);
    expect(actionDisclosures.map((element) => element.tagName)).toEqual([
      "DETAILS",
      "DETAILS",
      "BUTTON",
      "BUTTON",
    ]);
    expect(actionDisclosures[0]).toHaveAttribute(
      "data-budget-primary-action",
      "true",
    );
    expect(
      within(actionDisclosures[0] as HTMLElement).getByText("新增花費"),
    ).toBeVisible();
    const optionalGroupDisclosure = actionDisclosures[1] as HTMLDetailsElement;
    expect(optionalGroupDisclosure).not.toHaveAttribute("open");
    expect(
      within(optionalGroupDisclosure).getByText("建立群組（選用）"),
    ).toBeVisible();
    expect(
      optionalGroupDisclosure.querySelector("summary"),
    ).toHaveAccessibleName("建立群組（選用）");
    expect(actionDisclosures[2]).toHaveTextContent("測試文定建議");
    expect(actionDisclosures[3]).toHaveTextContent("測試常見婚禮建議");

    expect(
      screen.getByText(/籌備階段 → 品項分類 → 實際花費/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/文件中的品牌、金額與數量只是範例/),
    ).toBeInTheDocument();
  });

  it("keeps an expense subtree rollup stable under status filtering", () => {
    const expenseParent: BudgetItemListItem = {
      ...items[0],
      id: "budget_media_parent",
      name: "影像紀錄",
      hasChildren: true,
      directChildren: [
        {
          id: "budget_media_child",
          name: "婚禮攝影",
          hasChildren: false,
        },
        {
          id: "budget_host_child",
          name: "婚禮主持",
          hasChildren: false,
        },
      ],
      directChildCount: 2,
      descendantCount: 2,
      category: "VENUE_CATERING",
      plannedAmount: 0,
      rolledUpPlannedAmount: "80000",
      actualAmount: null,
      rolledUpActualAmount: "68000",
      rolledUpDepositAmount: "5200",
      rolledUpBalanceAmount: "12000",
      bookingStatus: "PLANNING",
      paid: false,
      paidAt: null,
    };
    const sameCategoryChild: BudgetItemListItem = {
      ...items[1],
      id: "budget_media_child",
      parentId: expenseParent.id,
      depth: 1,
      name: "婚禮攝影",
      breadcrumb: [expenseParent.name, "婚禮攝影"],
      directParentName: expenseParent.name,
      category: "VENUE_CATERING",
      plannedAmount: 62800,
      rolledUpPlannedAmount: "62800",
      actualAmount: 62800,
      rolledUpActualAmount: "62800",
      rolledUpDepositAmount: "0",
      rolledUpBalanceAmount: "0",
      bookingStatus: "PAID",
      paid: true,
      paidAt: "2027-01-02T03:04:05.000Z",
    };
    const crossCategoryChild: BudgetItemListItem = {
      ...items[0],
      id: "budget_host_child",
      parentId: expenseParent.id,
      depth: 1,
      name: "婚禮主持",
      breadcrumb: [expenseParent.name, "婚禮主持"],
      directParentName: expenseParent.name,
      category: "PEOPLE_SERVICES",
      plannedAmount: 17200,
      rolledUpPlannedAmount: "17200",
      actualAmount: 5200,
      rolledUpActualAmount: "5200",
      rolledUpDepositAmount: "5200",
      rolledUpBalanceAmount: "12000",
      bookingStatus: "BOOKED_BALANCE_DUE",
      depositAmount: 5200,
      balanceAmount: 12000,
    };
    const zeroLeaf: BudgetItemListItem = {
      ...items[0],
      id: "budget_free_leaf",
      name: "免費借用",
      category: "OTHER_PENDING",
      plannedAmount: 0,
      rolledUpPlannedAmount: "0",
      actualAmount: null,
      rolledUpActualAmount: "0",
      rolledUpDepositAmount: "0",
      rolledUpBalanceAmount: "0",
      bookingStatus: "PLANNING",
    };
    const matrixItems = [
      expenseParent,
      sameCategoryChild,
      crossCategoryChild,
      zeroLeaf,
    ];
    const { container } = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={matrixItems}
        summary={{
          ...summary,
          itemCount: 4,
          paidCount: 1,
          plannedTotal: "80000",
          actualTotal: "68000",
          balanceDueTotal: "12000",
          balanceDueCount: 1,
          balanceDueMissingAmountCount: 0,
        }}
        canEdit={false}
      />,
    );

    selectGroupView();
    const groupLedger = container.querySelector(
      'ul[data-budget-view="group"]',
    ) as HTMLElement;
    const groupParentRow = within(groupLedger)
      .getByRole("heading", { name: "影像紀錄" })
      .closest("article") as HTMLElement;
    const groupParentAmounts = groupParentRow.querySelector(
      '[data-budget-mobile-row="amounts"]',
    ) as HTMLElement;
    const rollupAmount = within(groupParentAmounts).getByRole("group", {
      name: "含子項預計花費：NT$80,000",
    });
    expect(rollupAmount).toHaveTextContent("NT$80,000");
    expect(within(groupParentAmounts).getByText("含子項")).toBeVisible();
    // 四個金額統一成含子項：父列不能再宣稱「尚未記錄」，
    // 它底下的子項其實已經付了 NT$68,000。
    expect(
      within(groupParentAmounts).getByLabelText("含子項實付：NT$68,000"),
    ).toHaveTextContent("NT$68,000");
    expect(within(groupParentAmounts).getByText("含子項")).toBeVisible();
    expect(
      within(groupLedger).getByRole("heading", { name: "婚禮攝影" }),
    ).toBeVisible();
    expect(
      within(groupLedger).getByRole("heading", { name: "婚禮主持" }),
    ).toBeVisible();
    expect(within(groupParentRow).getByText("2 個直接項目")).toBeVisible();
    expect(within(groupParentRow).getByText("共 2 個下層項目")).toBeVisible();

    // 訂金與尾款以前只算本項，父列一律顯示「—」，看起來像什麼都沒付。
    const depositCell = groupParentAmounts.querySelector(
      '[data-budget-ledger-column="deposit"]',
    ) as HTMLElement;
    const balanceCell = groupParentAmounts.querySelector(
      '[data-budget-ledger-column="balance"]',
    ) as HTMLElement;
    expect(depositCell).toHaveTextContent("NT$5,200");
    expect(balanceCell).toHaveTextContent("NT$12,000");
    expect(depositCell).not.toHaveTextContent("—");
    expect(balanceCell).not.toHaveTextContent("—");

    fireEvent.click(screen.getByRole("button", { name: "規劃中" }));
    expect(ledgerListItem(sameCategoryChild.id)).toHaveAttribute("hidden");
    expect(ledgerListItem(crossCategoryChild.id)).toHaveAttribute("hidden");
    expect(ledgerListItem(expenseParent.id)).not.toHaveAttribute("hidden");
    expect(rollupAmount).toHaveTextContent("NT$80,000");
    const completeTreeScope = within(groupParentAmounts).getByText(
      "包含完整下層，即使部分項目因篩選未顯示",
    );
    expect(completeTreeScope).toBeVisible();
    expect(rollupAmount).toHaveAttribute(
      "aria-describedby",
      completeTreeScope.id,
    );
    expect(
      within(groupParentAmounts).queryByText("NT$0"),
    ).not.toBeInTheDocument();

    const zeroLeafRow = within(groupLedger)
      .getByRole("heading", { name: "免費借用" })
      .closest("article") as HTMLElement;
    expect(
      within(
        zeroLeafRow.querySelector(
          '[data-budget-mobile-row="amounts"]',
        ) as HTMLElement,
      ).getByLabelText("本項預計花費：NT$0"),
    ).toHaveTextContent("NT$0");

    expect(
      container.querySelector('[data-budget-summary-cell="planned"]'),
    ).toHaveTextContent("NT$80,000");
    expect(
      container.querySelector('[data-budget-summary-cell="actual"]'),
    ).toHaveTextContent("NT$68,000");
  });

  it("keeps explicitly recorded zero subtree payments distinct from missing values", () => {
    const zeroPaymentParent: BudgetItemListItem = {
      ...items[0],
      id: "budget_zero_payment_parent",
      name: "零元方案",
      hasChildren: true,
      directChildren: [
        {
          id: "budget_zero_payment_child",
          name: "零元子項",
          hasChildren: false,
        },
      ],
      directChildCount: 1,
      descendantCount: 1,
      plannedAmount: 0,
      rolledUpPlannedAmount: "0",
      actualAmount: null,
      rolledUpActualAmount: "0",
      rolledUpActualAmountRecorded: true,
      rolledUpDepositAmount: "0",
      rolledUpDepositAmountRecorded: true,
      rolledUpBalanceAmount: "0",
      rolledUpBalanceAmountRecorded: true,
    };
    const zeroPaymentChild: BudgetItemListItem = {
      ...items[0],
      id: "budget_zero_payment_child",
      parentId: zeroPaymentParent.id,
      depth: 1,
      name: "零元子項",
      breadcrumb: [zeroPaymentParent.name, "零元子項"],
      directParentName: zeroPaymentParent.name,
      plannedAmount: 0,
      rolledUpPlannedAmount: "0",
      actualAmount: 0,
      rolledUpActualAmount: "0",
      rolledUpActualAmountRecorded: true,
      depositAmount: 0,
      rolledUpDepositAmount: "0",
      rolledUpDepositAmountRecorded: true,
      balanceAmount: 0,
      rolledUpBalanceAmount: "0",
      rolledUpBalanceAmountRecorded: true,
      bookingStatus: "PAID",
      paid: true,
      paidAt: "2027-01-02T03:04:05.000Z",
    };

    const { container } = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={[zeroPaymentParent, zeroPaymentChild]}
        summary={{ ...summary, itemCount: 1, paidCount: 1, plannedTotal: "0", actualTotal: "0" }}
        canEdit={false}
      />,
    );

    selectGroupView();
    const parentRow = container
      .querySelector('[data-budget-item-id="budget_zero_payment_parent"]')
      ?.closest("article") as HTMLElement;
    const amounts = parentRow.querySelector(
      '[data-budget-mobile-row="amounts"]',
    ) as HTMLElement;

    expect(
      within(amounts).getByLabelText("含子項實付：NT$0"),
    ).toHaveTextContent("NT$0");
    expect(
      amounts.querySelector('[data-budget-ledger-column="deposit"]'),
    ).toHaveTextContent("NT$0");
    expect(
      amounts.querySelector('[data-budget-ledger-column="balance"]'),
    ).toHaveTextContent("NT$0");
    expect(within(amounts).queryByText("尚未記錄")).not.toBeInTheDocument();
    expect(within(amounts).queryByText("—")).not.toBeInTheDocument();
  });

  it("uses explicit expense and group units in summary and active-filter result counts", () => {
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={groupedItems}
        summary={{ ...summary, itemCount: 2 }}
        canEdit={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: "查看全部 2 筆花費" }),
    ).toBeVisible();
    expect(screen.getByText("已付款 1 / 2 筆花費")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "顯示已付清 1 筆花費" }),
    ).toBeVisible();
    expect(screen.getByText("顯示 0 / 2 筆花費，1 / 1 個群組")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "已付清" }));
    expect(
      screen.getByText("符合 1 / 2 筆花費、0 / 1 個群組，另顯示 1 個上層群組"),
    ).toBeVisible();
  });

  it("defaults groups to collapsed, controls only descendant rows, and persists explicit workspace state", async () => {
    const firstRender = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={groupedItems}
        summary={{ ...summary, itemCount: 2 }}
        canEdit={false}
      />,
    );

    selectGroupView();

    const groupToggle = screen.getByRole("button", {
      name: "展開群組：婚紗方案",
    });
    const controlledIds =
      groupToggle.getAttribute("aria-controls")?.split(/\s+/u) ?? [];
    expect(groupToggle).toHaveAttribute("aria-expanded", "false");
    expect(controlledIds).toHaveLength(2);
    expect(controlledIds.map((id) => document.getElementById(id))).toEqual([
      ledgerListItem("budget_venue_internal"),
      ledgerListItem("budget_host_internal"),
    ]);
    expect(controlledIds).not.toContain(
      ledgerListItem("budget_group_internal").id,
    );
    expect(
      controlledIds.every(
        (id) => document.getElementById(id)?.tagName === "LI",
      ),
    ).toBe(true);
    expect(ledgerListItem("budget_venue_internal")).toHaveAttribute("hidden");

    fireEvent.click(screen.getByRole("button", { name: "全部展開" }));
    expect(groupToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: "禮服租借" })).toBeVisible();

    await waitFor(() =>
      expect(window.localStorage.length).toBeGreaterThanOrEqual(1),
    );
    firstRender.unmount();
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={groupedItems}
        summary={{ ...summary, itemCount: 2 }}
        canEdit={false}
      />,
    );
    selectGroupView();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "收合群組：婚紗方案" }),
      ).toHaveAttribute("aria-expanded", "true"),
    );

    fireEvent.click(screen.getByRole("button", { name: "全部收合" }));
    expect(
      screen.getByRole("button", { name: "展開群組：婚紗方案" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(ledgerListItem("budget_venue_internal")).toHaveAttribute("hidden");
  });

  it("restores a valid legacy group expansion preference and migrates it to the neutral key", async () => {
    const legacyKey = "vowbook:budget-stage-groups:workspace_legacy";
    const currentKey = "vowbook:budget-group-expansion:workspace_legacy";
    window.localStorage.setItem(
      legacyKey,
      JSON.stringify({ budget_group_internal: true }),
    );

    render(
      <BudgetList
        workspaceId="workspace_legacy"
        items={groupedItems}
        summary={{ ...summary, itemCount: 2 }}
        canEdit={false}
      />,
    );
    selectGroupView();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "收合群組：婚紗方案" }),
      ).toHaveAttribute("aria-expanded", "true"),
    );
    expect(window.localStorage.getItem(currentKey)).toContain(
      '"budget_group_internal":true',
    );
    expect(window.localStorage.getItem(legacyKey)).toBeNull();
  });

  it("reloads each workspace expansion state when revisiting it in one component instance", async () => {
    const { rerender } = render(
      <BudgetList
        workspaceId="workspace_a"
        items={groupedItems}
        summary={{ ...summary, itemCount: 2 }}
        canEdit={false}
      />,
    );

    selectGroupView();

    fireEvent.click(screen.getByRole("button", { name: "全部展開" }));
    await waitFor(() =>
      expect(
        window.localStorage.getItem(
          "vowbook:budget-group-expansion:workspace_a",
        ),
      ).toContain('"budget_group_internal":true'),
    );

    rerender(
      <BudgetList
        workspaceId="workspace_b"
        items={groupedItems}
        summary={{ ...summary, itemCount: 2 }}
        canEdit={false}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "展開群組：婚紗方案" }),
      ).toHaveAttribute("aria-expanded", "false"),
    );

    rerender(
      <BudgetList
        workspaceId="workspace_a"
        items={groupedItems}
        summary={{ ...summary, itemCount: 2 }}
        canEdit={false}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "收合群組：婚紗方案" }),
      ).toHaveAttribute("aria-expanded", "true"),
    );
  });

  it("disables saved expansion actions while filters force groups open and restores the saved state", async () => {
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={groupedItems}
        summary={{ ...summary, itemCount: 2 }}
        canEdit={false}
      />,
    );

    selectGroupView();

    fireEvent.click(screen.getByRole("button", { name: "全部展開" }));
    fireEvent.click(screen.getByRole("button", { name: "全部收合" }));
    await waitFor(() =>
      expect(
        window.localStorage.getItem(
          "vowbook:budget-group-expansion:workspace_internal",
        ),
      ).toContain('"budget_group_internal":false'),
    );
    const savedState = window.localStorage.getItem(
      "vowbook:budget-group-expansion:workspace_internal",
    );

    fireEvent.change(screen.getByLabelText("搜尋花費項目"), {
      target: { value: "造型服務" },
    });

    const explanation = screen.getByText(
      "搜尋或篩選期間會暫時展開符合項目的群組；清除條件後會恢復原本的展開狀態。",
    );
    const groupToggle = screen.getByRole("button", {
      name: "收合群組：婚紗方案",
    });
    const expandAll = screen.getByRole("button", { name: "全部展開" });
    const collapseAll = screen.getByRole("button", { name: "全部收合" });
    expect(explanation).toBeVisible();
    expect(groupToggle).toBeDisabled();
    expect(expandAll).toBeDisabled();
    expect(collapseAll).toBeDisabled();
    expect(groupToggle).toHaveAttribute("aria-describedby", explanation.id);
    expect(expandAll).toHaveAttribute("aria-describedby", explanation.id);

    fireEvent.click(groupToggle);
    fireEvent.click(expandAll);
    expect(
      window.localStorage.getItem(
        "vowbook:budget-group-expansion:workspace_internal",
      ),
    ).toBe(savedState);

    fireEvent.change(screen.getByLabelText("搜尋花費項目"), {
      target: { value: "" },
    });
    expect(
      screen.getByRole("button", { name: "展開群組：婚紗方案" }),
    ).not.toBeDisabled();
    expect(ledgerListItem("budget_host_internal")).toHaveAttribute("hidden");
  });

  it("omits expansion controls for childless groups", () => {
    const { container } = render(
      <BudgetList
        workspaceId="workspace_empty_group"
        items={[emptyGroup]}
        summary={{
          ...summary,
          itemCount: 0,
          paidCount: 0,
          plannedTotal: "0",
          actualTotal: "0",
          balanceDueCount: 0,
          balanceDueTotal: "0",
        }}
        canEdit={false}
      />,
    );

    selectGroupView();

    expect(
      screen.queryByRole("button", { name: "展開群組：尚未整理的方案" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "全部展開" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "全部收合" }),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('ul[data-budget-view="group"]'),
    ).not.toBeNull();
  });

  it("temporarily reveals collapsed matches and ancestor context, then restores saved collapse state", () => {
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={groupedItems}
        summary={{ ...summary, itemCount: 2 }}
        canEdit={false}
      />,
    );

    selectGroupView();

    expect(ledgerListItem("budget_host_internal")).toHaveAttribute("hidden");
    fireEvent.change(screen.getByLabelText("搜尋花費項目"), {
      target: { value: "造型服務" },
    });
    expect(screen.getByRole("heading", { name: "婚紗方案" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "造型服務" })).toBeVisible();
    expect(screen.getByText("上層脈絡")).toBeVisible();

    fireEvent.change(screen.getByLabelText("搜尋花費項目"), {
      target: { value: "" },
    });
    expect(ledgerListItem("budget_host_internal")).toHaveAttribute("hidden");

    fireEvent.click(screen.getByRole("button", { name: "已下訂" }));
    expect(screen.getByRole("heading", { name: "婚紗方案" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "造型服務" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    expect(ledgerListItem("budget_host_internal")).toHaveAttribute("hidden");
  });

  it("maps truthful summary shortcuts to the connected status toolbar", () => {
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={groupedItems}
        summary={{
          ...summary,
          itemCount: 2,
          paidCount: 1,
          balanceDueCount: 1,
        }}
        canEdit={false}
      />,
    );

    fireEvent.change(screen.getByLabelText("搜尋花費項目"), {
      target: { value: "禮服" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "顯示已付清 1 筆花費" }),
    );
    expect(screen.getByLabelText("搜尋花費項目")).toHaveValue("");
    expect(screen.getByRole("button", { name: "已付清" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByText("符合 1 / 2 筆花費、0 / 1 個群組，另顯示 1 個上層群組"),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "婚紗方案" })).toBeVisible();

    fireEvent.change(screen.getByLabelText("搜尋花費項目"), {
      target: { value: "禮服" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "顯示待付尾款 1 筆花費" }),
    );
    expect(screen.getByLabelText("搜尋花費項目")).toHaveValue("");
    expect(screen.getByRole("button", { name: "已下訂" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("heading", { name: "造型服務" })).toBeVisible();

    fireEvent.change(screen.getByLabelText("搜尋花費項目"), {
      target: { value: "造型服務" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查看全部 2 筆花費" }));
    expect(screen.getByLabelText("搜尋花費項目")).toHaveValue("");
    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "展開群組：婚紗方案" }),
    ).toBeVisible();
    expect(ledgerListItem("budget_venue_internal")).toHaveAttribute("hidden");
    expect(ledgerListItem("budget_host_internal")).toHaveAttribute("hidden");
    expect(screen.getByText("顯示 0 / 2 筆花費，1 / 1 個群組")).toBeVisible();
    expect(screen.getByText("已記錄實付")).not.toHaveAccessibleName(/已付清/u);
  });

  it("omits summary shortcuts that would only lead to zero-result views", () => {
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={groupedItems}
        summary={{
          ...summary,
          itemCount: 2,
          paidCount: 0,
          balanceDueCount: 0,
        }}
        canEdit={false}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "顯示已付清 0 筆花費" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "顯示待付尾款 0 筆花費" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("目前沒有待付尾款")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "查看全部 2 筆花費" }),
    ).toBeVisible();
  });

  it("keeps mobile expense hierarchy and category distinct with one attachment action while GROUP stays attachment-free", () => {
    const { container } = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={groupedItems}
        summary={{ ...summary, itemCount: 2 }}
        canEdit
      />,
    );

    selectGroupView();
    fireEvent.click(screen.getByRole("button", { name: "全部展開" }));
    const expenseRow = screen
      .getByRole("heading", { name: "禮服租借" })
      .closest<HTMLElement>("[data-budget-ledger-row]");
    const rowSurface = expenseRow?.querySelector<HTMLElement>(
      "[data-budget-ledger-surface]",
    );
    expect(
      within(rowSurface!).getByText("婚紗方案 › 禮服租借", {
        selector: "[data-budget-hierarchy-breadcrumb]",
      }),
    ).toBeVisible();
    expect(
      within(rowSurface!).getByText("品項分類：禮服租借", {
        selector: "[data-budget-category-label]",
      }),
    ).toBeVisible();
    expect(within(rowSurface!).queryByText(/第 2 層/u)).not.toBeInTheDocument();
    expect(
      within(rowSurface!).queryByText(/直接上層：/u),
    ).not.toBeInTheDocument();
    const attachmentAction = within(rowSurface!).getByRole("button", {
      name: "開啟花費明細與附件：禮服租借",
    });
    expect(attachmentAction).toHaveTextContent("明細與附件 · 1");
    expect(attachmentAction).toHaveAccessibleDescription("附件 1 份");

    const groupRow = screen
      .getByRole("heading", { name: "婚紗方案" })
      .closest<HTMLElement>("[data-budget-ledger-row]");
    const groupSurface = groupRow?.querySelector<HTMLElement>(
      "[data-budget-ledger-surface]",
    );
    expect(
      within(groupSurface!).queryByText(/附件/u),
    ).not.toBeInTheDocument();
    expect(
      groupRow!.querySelector('[data-budget-mobile-row="amounts"]'),
    ).toBeNull();
    expect(within(groupRow!).getByText("來源群組")).toBeVisible();
    expect(within(groupRow!).getByText("非計價標題")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "已下訂" }));
    expect(ledgerListItem("budget_group_internal")).not.toHaveAttribute("hidden");
    expect(
      within(groupRow!).getByRole("button", { name: "管理群組：婚紗方案" }),
    ).toHaveTextContent("管理");
    expect(container.firstElementChild).toHaveAttribute(
      "data-budget-mobile-contract",
      "390",
    );
  });

  it("uses the VIEWER attachment label and preserves a dirty editor draft", () => {
    const editorRender = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={groupedItems}
        summary={{ ...summary, itemCount: 2 }}
        canEdit
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "展開群組：婚紗方案" }));
    const venueRow = screen
      .getByRole("heading", { name: "禮服租借" })
      .closest("li");
    const draft = within(venueRow!).getByLabelText("項目名稱");
    fireEvent.change(draft, { target: { value: "尚未儲存的禮服草稿" } });
    expect(within(venueRow!).getByLabelText("項目名稱")).toHaveValue(
      "尚未儲存的禮服草稿",
    );
    editorRender.unmount();

    render(
      <BudgetList
        workspaceId="workspace_viewer"
        items={[groupedItems[1]]}
        summary={{ ...summary, itemCount: 1 }}
        canEdit={false}
      />,
    );
    const viewerTrigger = screen.getByRole("button", {
      name: "查看花費明細與附件：禮服租借",
    });
    expect(viewerTrigger).toHaveTextContent("詳細與附件 · 1");
    fireEvent.click(viewerTrigger);
    expect(
      screen.queryByRole("form", { name: "上傳花費附件" }),
    ).not.toBeInTheDocument();
  });

  it("exposes editable EXPENSE attachment metadata and places attachments before cost details", () => {
    const expense = {
      ...items[0],
      attachments: [
        {
          id: "attachment_contract",
          originalName: "攝影合約.pdf",
          mediaType: "application/pdf" as const,
          byteSize: 2048,
          createdAt: "2027-01-02T03:04:05.000Z",
        },
      ],
    };
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={[expense]}
        summary={{ ...summary, itemCount: 1 }}
        canEdit
      />,
    );

    const expenseRow = screen
      .getByRole("heading", { name: expense.name })
      .closest<HTMLElement>("[data-budget-ledger-row]");
    const rowSurface = expenseRow?.querySelector<HTMLElement>(
      "[data-budget-ledger-surface]",
    );
    const trigger = within(rowSurface!).getByRole("button", {
      name: `開啟花費明細與附件：${expense.name}`,
    });
    expect(trigger).toHaveTextContent("明細與附件 · 1");
    expect(trigger).toHaveAccessibleDescription("附件 1 份");
    expect(expenseRow?.querySelector("dialog")).not.toHaveAttribute("open");

    fireEvent.click(trigger);
    const dialog = within(expenseRow!).getByRole("dialog", {
      name: expense.name,
    });
    const attachmentHeading = within(dialog).getByRole("heading", {
      name: "附件",
    });
    const attachmentSection = attachmentHeading.closest("section");
    const uploadForm = within(dialog).getByRole("form", {
      name: "上傳花費附件",
    });
    const primaryAmountLabel = within(dialog).getByText("本項直接費用");

    expect(dialog).toHaveAttribute("open");
    expect(attachmentSection?.previousElementSibling).toHaveTextContent(
      "品項分類",
    );
    expect(
      attachmentSection!.compareDocumentPosition(primaryAmountLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      uploadForm.compareDocumentPosition(primaryAmountLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("mentions attachments for read-only EXPENSE rows without exposing upload controls", () => {
    const expense = {
      ...items[0],
      attachments: [
        {
          id: "attachment_viewer",
          originalName: "攝影報價單.pdf",
          mediaType: "application/pdf" as const,
          byteSize: 4096,
          createdAt: "2027-01-02T03:04:05.000Z",
        },
      ],
    };
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={[expense]}
        summary={{ ...summary, itemCount: 1 }}
        canEdit={false}
      />,
    );

    const expenseRow = screen
      .getByRole("heading", { name: expense.name })
      .closest<HTMLElement>("[data-budget-ledger-row]");
    const rowSurface = expenseRow?.querySelector<HTMLElement>(
      "[data-budget-ledger-surface]",
    );
    const trigger = within(rowSurface!).getByRole("button", {
      name: `查看花費明細與附件：${expense.name}`,
    });
    expect(trigger).toHaveTextContent("詳細與附件 · 1");
    expect(trigger).toHaveAccessibleDescription("附件 1 份");
    fireEvent.click(trigger);

    const dialog = within(expenseRow!).getByRole("dialog", {
      name: expense.name,
    });
    expect(within(dialog).getByRole("heading", { name: "附件" })).toBeVisible();
    expect(
      within(dialog).queryByRole("form", { name: "上傳花費附件" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /^刪除附件：/u }),
    ).not.toBeInTheDocument();
  });

  it("keeps GROUP rows attachment-free and preserves their management trigger", () => {
    const group = groupedItems[0];
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={groupedItems}
        summary={{ ...summary, itemCount: 2 }}
        canEdit
      />,
    );

    selectGroupView();

    const groupRow = screen
      .getByRole("heading", { name: group.name })
      .closest<HTMLElement>("[data-budget-ledger-row]");
    const rowSurface = groupRow?.querySelector<HTMLElement>(
      "[data-budget-ledger-surface]",
    );
    expect(within(rowSurface!).queryByText(/附件/u)).not.toBeInTheDocument();
    expect(within(rowSurface!).getByText("來源群組")).toBeVisible();
    expect(within(rowSurface!).getByText("非計價標題")).toBeVisible();
    expect(
      rowSurface?.querySelector('[data-budget-mobile-row="amounts"]'),
    ).toBeNull();
    expect(
      rowSurface?.querySelector('[data-budget-ledger-column="brand"]'),
    ).toBeNull();
    expect(rowSurface).not.toHaveTextContent("NT$");
    expect(rowSurface).not.toHaveTextContent("訂金");
    expect(rowSurface).not.toHaveTextContent("尾款");
    expect(rowSurface).not.toHaveTextContent("總價");
    expect(rowSurface).not.toHaveTextContent("實付");

    const trigger = within(rowSurface!).getByRole("button", {
      name: `管理群組：${group.name}`,
    });
    expect(trigger).toHaveTextContent("管理");
    fireEvent.click(trigger);

    const dialog = within(groupRow!).getByRole("dialog", {
      name: group.name,
    });
    expect(
      within(dialog).queryByRole("heading", { name: "附件" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("form", { name: "上傳花費附件" }),
    ).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "此來源群組是非計價標題；金額只記錄在下層花費。",
    );
    expect(dialog).not.toHaveTextContent("群組預計花費");
    expect(dialog).not.toHaveTextContent("群組已記錄實付");
    expect(within(dialog).queryByText(/^NT\$/u)).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "編輯群組：婚紗方案" }),
    ).toBeInTheDocument();
    const editGroup = within(dialog).getByRole("button", {
      name: "編輯群組：婚紗方案",
    });
    const moveGroup = within(dialog).getByRole("form", {
      name: "調整階層位置：婚紗方案",
    });
    const dissolveGroup = within(dialog).getByRole("form", {
      name: "移除群組並保留項目：婚紗方案",
    });
    const subtreeDeleteGroup = within(dialog).getByRole("form", {
      name: "永久刪除群組：婚紗方案",
    });
    expect(
      within(dialog).queryByRole("form", {
        name: "移除項目：婚紗方案",
      }),
    ).not.toBeInTheDocument();
    expect(subtreeDeleteGroup).toHaveTextContent("下層 2 筆，附件 1 個");
    expect(
      editGroup.compareDocumentPosition(dissolveGroup) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      moveGroup.compareDocumentPosition(dissolveGroup) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      dissolveGroup.compareDocumentPosition(subtreeDeleteGroup) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", {
        name: "在「婚紗方案」下建立群組",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "建立群組" }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "編輯群組：婚紗方案" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("已更新群組。");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "在「婚紗方案」下建立群組",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("已建立群組。");
  });

  it("gives VIEWER no GROUP create, edit, move, or delete controls", () => {
    const group = {
      ...items[0],
      id: "budget_group_viewer",
      name: "婚紗方案",
      kind: "GROUP" as const,
      category: null,
      plannedAmount: 0,
      actualAmount: null,
    };
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={[group]}
        summary={{ ...summary, itemCount: 0 }}
        canEdit={false}
      />,
    );

    selectGroupView();

    expect(
      screen.queryByRole("button", { name: "建立群組" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "查看群組詳情：婚紗方案" }),
    );
    const dialog = screen.getByRole("dialog", { name: "婚紗方案" });
    expect(
      within(dialog).queryByRole("button", { name: "編輯群組：婚紗方案" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", {
        name: "在「婚紗方案」下建立群組",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("form", { name: "調整階層位置：婚紗方案" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("form", { name: "移除項目：婚紗方案" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("form", {
        name: "移除群組並保留項目：婚紗方案",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("form", {
        name: "永久刪除群組：婚紗方案",
      }),
    ).not.toBeInTheDocument();
  });

  it("shows an NT$0 summary and useful empty state", () => {
    const { container } = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={[]}
        summary={{
          itemCount: 0,
          paidCount: 0,
          plannedTotal: "0",
          actualTotal: "0",
          balanceDueTotal: "0",
          balanceDueCount: 0,
          balanceDueMissingAmountCount: 0,
          nearestBalanceDueDate: null,
        }}
        canEdit={false}
      />,
    );

    expect(
      container.querySelectorAll("[data-budget-summary-cell]"),
    ).toHaveLength(3);
    for (const [cellName, label] of [
      ["planned", "預計總花費"],
      ["actual", "已記錄實付"],
      ["balance-due", "待付尾款"],
    ] as const) {
      const cell = container.querySelector(
        `[data-budget-summary-cell="${cellName}"]`,
      );

      expect(cell).toHaveTextContent(label);
      expect(
        cell?.querySelector("[data-budget-summary-accessible-amount]"),
      ).toHaveClass("sr-only");
      expect(
        cell?.querySelector("[data-budget-summary-accessible-amount]"),
      ).toHaveTextContent("NT$0");
    }
    expect(
      container.querySelector("[data-budget-payment-progress]"),
    ).toHaveTextContent("已付款 0 / 0");
    expect(
      container.querySelector('[data-budget-summary-cell="balance-due"]'),
    ).toHaveTextContent("目前沒有待付尾款");
    expect(screen.getByText("從第一筆自己的婚禮花費開始")).toBeInTheDocument();
    expect(
      screen.getByText("尚無花費明細。分類仍可在新增花費時選擇。"),
    ).toBeInTheDocument();
    const emptyWorkspaceLayout = container.querySelector<HTMLElement>(
      '[data-budget-workspace-layout="taxonomy-expenses"]',
    );
    expect(emptyWorkspaceLayout).toHaveAttribute(
      "data-desktop-layout",
      "single",
    );
    expect(
      within(emptyWorkspaceLayout!).queryByRole("navigation", {
        name: "花費分類導覽",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(emptyWorkspaceLayout!).getByRole("region", {
        name: "花費工作區",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows an unknown payment time instead of unpaid copy for PAID items without paidAt", () => {
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={[{ ...items[1], paidAt: null }]}
        summary={{ ...summary, itemCount: 1 }}
        canEdit={false}
      />,
    );

    const row = screen
      .getByRole("heading", { name: "婚宴場地" })
      .closest<HTMLElement>("[data-budget-ledger-row]");

    expect(within(row!).getByText("付款時間未記錄")).toBeInTheDocument();
    expect(within(row!).queryByText("尚未付款")).not.toBeInTheDocument();
  });

  it("preserves unpaid copy for PLANNING items without paidAt", () => {
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={[items[0]]}
        summary={{ ...summary, itemCount: 1, paidCount: 0 }}
        canEdit={false}
      />,
    );

    const row = screen
      .getByRole("heading", { name: "婚禮攝影" })
      .closest<HTMLElement>("[data-budget-ledger-row]");

    expect(within(row!).getByText("尚未付款")).toBeInTheDocument();
    expect(within(row!).queryByText("付款時間未記錄")).not.toBeInTheDocument();
  });

  it("keeps the summary accessible while exposing calm responsive structure", () => {
    const { container } = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={items}
        summary={summary}
        canEdit={false}
      />,
    );

    const heading = screen.getByRole("heading", {
      name: "花費摘要",
      level: 2,
    });
    const summaryRegion = heading.closest("section");
    const layout = summaryRegion?.querySelector(
      '[data-budget-summary-layout="responsive"]',
    );

    expect(summaryRegion).not.toBeNull();
    expect(
      summaryRegion?.querySelectorAll("[data-budget-summary-cell]"),
    ).toHaveLength(3);
    expect(layout).toHaveAttribute("data-mobile-layout", "two-plus-one");
    expect(layout).toHaveAttribute("data-desktop-layout", "three-columns");
    expect(layout).toHaveClass("grid-cols-2", "sm:grid-cols-3");

    const plannedCell = container.querySelector(
      '[data-budget-summary-cell="planned"]',
    );
    const actualCell = container.querySelector(
      '[data-budget-summary-cell="actual"]',
    );
    const balanceDueCell = container.querySelector(
      '[data-budget-summary-cell="balance-due"]',
    );
    expect(plannedCell).toHaveTextContent("預計總花費");
    expect(actualCell).toHaveTextContent("已記錄實付");
    expect(balanceDueCell).toHaveTextContent("待付尾款");
    expect(balanceDueCell).toHaveTextContent("共 2 筆花費待付");
    expect(balanceDueCell).toHaveTextContent("1 筆花費未填金額");
    expect(balanceDueCell).toHaveClass(
      "col-span-2",
      "sm:col-span-1",
      "sm:border-l",
    );

    for (const [cell, formattedAmount, digits] of [
      [plannedCell, "NT$208,000", "208,000"],
      [actualCell, "NT$118,000", "118,000"],
      [balanceDueCell, "NT$90,000", "90,000"],
    ] as const) {
      const amount = cell?.querySelector("[data-budget-summary-amount]");
      const accessibleAmount = amount?.querySelector(
        "[data-budget-summary-accessible-amount]",
      );
      const currency = amount?.querySelector("[data-budget-summary-currency]");
      const numericDigits = amount?.querySelector(
        "[data-budget-summary-digits]",
      );

      expect(amount).not.toHaveAttribute("aria-label");
      expect(amount).toHaveClass(
        "inline-flex",
        "min-w-0",
        "max-w-full",
        "items-baseline",
        "gap-x-1",
      );
      expect(amount).not.toHaveClass("flex-wrap", "whitespace-nowrap");
      expect(amount).not.toHaveClass("font-serif");
      expect(accessibleAmount).toHaveClass("sr-only");
      expect(accessibleAmount).toHaveTextContent(formattedAmount);
      expect(currency).toHaveTextContent("NT$");
      expect(currency).toHaveClass(
        "shrink-0",
        "text-xs",
        "font-medium",
        "tracking-[0.06em]",
        "text-ink-faint",
      );
      expect(currency).toHaveAttribute("aria-hidden", "true");
      expect(numericDigits).toHaveTextContent(digits);
      expect(numericDigits).toHaveClass(
        "min-w-0",
        "break-words",
        "font-sans",
        "font-semibold",
        "tabular-nums",
        "tracking-[-0.02em]",
        "text-[1.35rem]",
        "text-ink",
      );
      expect(numericDigits).not.toHaveClass("font-serif", "font-bold");
      expect(numericDigits).toHaveAttribute("aria-hidden", "true");
    }

    const paymentProgress = actualCell?.querySelector(
      "[data-budget-payment-progress]",
    );
    expect(paymentProgress).toHaveTextContent("已付款 1 / 2");
    expect(paymentProgress).toHaveClass(
      "font-sans",
      "text-xs",
      "tabular-nums",
      "text-ink-faint",
    );
    expect(paymentProgress).not.toHaveClass(
      "font-serif",
      "text-lg",
      "font-bold",
    );

    const balanceDueAmount = balanceDueCell?.querySelector(
      "[data-budget-summary-amount]",
    );
    expect(balanceDueAmount).not.toHaveClass("font-serif");
    expect(
      balanceDueCell?.querySelector('time[datetime="2027-12-31"]'),
    ).toHaveTextContent("最近期限 2027-12-31");
  });

  it("keeps exact extreme summary totals in contained currency-and-digits rows", () => {
    const { container } = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={items}
        summary={{
          ...summary,
          plannedTotal: "2147483647",
          actualTotal: "4294967294",
          balanceDueTotal: "999999999999",
        }}
        canEdit={false}
      />,
    );

    for (const [cellName, formattedAmount, digits] of [
      ["planned", "NT$2,147,483,647", "2,147,483,647"],
      ["actual", "NT$4,294,967,294", "4,294,967,294"],
      ["balance-due", "NT$999,999,999,999", "999,999,999,999"],
    ] as const) {
      const cell = container.querySelector(
        `[data-budget-summary-cell="${cellName}"]`,
      );
      const amount = cell?.querySelector("[data-budget-summary-amount]");
      const accessibleAmount = amount?.querySelector(
        "[data-budget-summary-accessible-amount]",
      );
      const currency = amount?.querySelector("[data-budget-summary-currency]");
      const numericDigits = amount?.querySelector(
        "[data-budget-summary-digits]",
      );

      expect(amount).toHaveClass("inline-flex", "min-w-0", "max-w-full");
      expect(amount).not.toHaveClass("whitespace-nowrap", "flex-wrap");
      expect(accessibleAmount).toHaveClass("sr-only");
      expect(accessibleAmount).toHaveTextContent(formattedAmount);
      expect(currency).toHaveClass("shrink-0");
      expect(currency).toHaveTextContent("NT$");
      expect(numericDigits).toHaveClass("min-w-0", "break-words");
      expect(numericDigits).toHaveTextContent(digits);
    }
  });

  it("renders compact scan-critical rows and keeps rich content in native dialogs for VIEWER", () => {
    const longName = "這是一筆需要在窄畫面完整換行的花費項目".repeat(8);
    const longNotes = "這段備註也必須安全換行".repeat(20);
    const { container } = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={[
          ...items,
          {
            ...items[0],
            id: "budget_long_internal",
            name: longName,
            category: "OTHER_PENDING",
            notes: longNotes,
          },
        ]}
        summary={{ ...summary, itemCount: 3 }}
        canEdit={false}
      />,
    );

    expect(
      container.querySelector(
        '[data-budget-summary-cell="planned"] [data-budget-summary-accessible-amount]',
      ),
    ).toHaveTextContent("NT$208,000");
    expect(screen.getAllByText("NT$118,000").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("已付款 1 / 3 筆花費")).toBeInTheDocument();
    expect(screen.getByText("期限 2028-02-29")).toHaveAttribute(
      "datetime",
      "2028-02-29",
    );
    expect(
      container.querySelector('time[datetime="2027-03-01T08:09:10.000Z"]'),
    ).toBeInTheDocument();
    // 沒設期限就不印：用一整行文字宣告「沒有資料」只是雜訊。
    expect(screen.queryAllByText("未設期限")).toHaveLength(0);
    expect(screen.getAllByText("規劃中").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("已付清").length).toBeGreaterThanOrEqual(1);
    const paidDetails = screen
      .getByRole("heading", { name: "婚宴場地" })
      .closest<HTMLElement>("[data-budget-ledger-row]");
    expect(paidDetails).not.toBeNull();
    expect(paidDetails?.querySelector("dialog")).not.toHaveAttribute("open");
    expect(
      within(paidDetails!)
        .getByText(/付款於/)
        .closest("summary"),
    ).toBeNull();
    expect(screen.getByRole("heading", { name: longName })).toHaveClass(
      "break-words",
    );
    expect(
      screen.getAllByText("分類狀態：待重新分類").length,
    ).toBeGreaterThan(0);
    const notes = screen.getByText(longNotes);
    expect(notes).toHaveClass("break-words");
    expect(notes.closest<HTMLElement>("[data-budget-ledger-row]")).toBe(
      screen
        .getByRole("heading", { name: longName })
        .closest<HTMLElement>("[data-budget-ledger-row]"),
    );
    expect(
      screen.queryByRole("form", { name: /^編輯 / }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: /^移除項目：/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: /^更新狀態 / }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "管理花費項目" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("編輯項目")).not.toBeInTheDocument();
    expect(screen.queryByText("移除項目")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("workspace_internal");
    expect(container).not.toHaveTextContent("budget_paid_internal");
    const workspaceLayout = container.querySelector<HTMLElement>(
      '[data-budget-workspace-layout="taxonomy-expenses"]',
    );
    expect(workspaceLayout).toHaveAttribute("data-desktop-layout", "single");
    expect(workspaceLayout).toHaveAttribute("data-mobile-layout", "stacked");
    expect(
      within(workspaceLayout!).queryByRole("navigation", {
        name: "花費分類導覽",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(workspaceLayout!).getByRole("region", { name: "花費工作區" }),
    ).toHaveAttribute("data-budget-layout-panel", "expenses");
    expect(
      container.querySelectorAll('[data-budget-scan-layout="expense-row"]'),
    ).toHaveLength(3);
  });

  it("uses a responsive taxonomy and expense workspace with an attachment-aware detail trigger", () => {
    const { container } = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={items}
        summary={summary}
        canEdit={false}
      />,
    );

    const workspaceLayout = container.querySelector<HTMLElement>(
      '[data-budget-workspace-layout="taxonomy-expenses"]',
    );
    expect(workspaceLayout).toHaveAttribute("data-desktop-layout", "single");
    expect(workspaceLayout).toHaveAttribute("data-mobile-layout", "stacked");
    expect(
      within(workspaceLayout!).queryByRole("navigation", {
        name: "花費分類導覽",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(workspaceLayout!).getByRole("region", { name: "花費工作區" }),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-budget-scan-layout="desktop-columns"]'),
    ).not.toBeInTheDocument();

    const rowSurfaces = container.querySelectorAll<HTMLElement>(
      "[data-budget-ledger-row] > [data-budget-ledger-surface]",
    );
    expect(rowSurfaces).toHaveLength(items.length);
    expect(
      container.querySelectorAll("[data-budget-ledger-row] > summary"),
    ).toHaveLength(0);

    for (const rowSurface of rowSurfaces) {
      expect(rowSurface).toHaveAttribute(
        "data-budget-row-layout",
        "hierarchy-ledger",
      );
      expect(rowSurface).not.toHaveClass("cursor-pointer", "list-none");

      const expenseRow = rowSurface.querySelector(
        '[data-budget-scan-layout="expense-row"]',
      );
      expect(expenseRow).toHaveClass(
        "grid",
        "grid-cols-1",
        "md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.72fr)_minmax(9rem,auto)]",
      );

      const hint = rowSurface.querySelector<HTMLElement>(
        '[data-budget-disclosure-hint="true"]',
      );
      expect(hint?.tagName).toBe("BUTTON");
      expect(hint).toHaveClass(
        "inline-flex",
        "min-h-11",
        "max-w-full",
        "rounded-xl",
        "text-xs",
        "font-semibold",
        "text-clay",
        "underline",
        "decoration-line-strong",
        "underline-offset-4",
      );
      expect(hint).not.toHaveClass("shrink-0", "whitespace-nowrap");
      expect(hint).not.toHaveClass("text-[0.6875rem]", "text-ink-faint");
      // 附件為 0 時不印數字，實際份數留在無障礙描述裡。
      expect(hint).toHaveTextContent("詳細與附件");
      expect(hint).not.toHaveTextContent("· 0");
      expect(hint).toHaveAccessibleName(/查看花費明細與附件/);
      expect(hint).toHaveAccessibleDescription("尚無附件");
    }
  });

  it("hides empty or non-Notion source hierarchy paths", () => {
    const { container } = render(
      <BudgetList
        workspaceId="workspace_source_path_guard"
        items={[
          {
            ...items[0],
            id: "manual_source_path_guard",
            name: "手動建立的合成花費",
            breadcrumb: ["手動建立的合成花費"],
            sourceHierarchyPath: ["不應顯示的路徑"],
          },
          {
            ...items[1],
            id: "empty_notion_source_path_guard",
            name: "空路徑的合成匯入花費",
            breadcrumb: ["空路徑的合成匯入花費"],
            source: "NOTION",
            sourceHierarchyPath: [],
          },
        ]}
        summary={summary}
        canEdit={false}
      />,
    );

    expect(
      container.querySelector("[data-budget-notion-source-path]"),
    ).toBeNull();
    expect(container).not.toHaveTextContent("Notion 原始路徑");
    expect(container).not.toHaveTextContent("不應顯示的路徑");
  });

  it("shows a wedding-shoes expense as a pre-wedding-photo extension exactly once", async () => {
    const photoStage: BudgetItemListItem = {
      ...groupedItems[0],
      id: "stage_photo",
      name: "籌備第1-2月",
      systemTaxonomyKey: "STAGE_PREPARATION_1_2_MONTHS",
      depth: 0,
      parentId: null,
      breadcrumb: ["籌備第1-2月"],
      directParentName: null,
      directChildren: [
        {
          id: "item_photo",
          name: "婚紗照拍攝",
          hasChildren: false,
        },
      ],
      directChildCount: 1,
      descendantCount: 1,
      rolledUpPlannedAmount: "30000",
      rolledUpActualAmount: "0",
      rolledUpDepositAmount: "0",
      rolledUpBalanceAmount: "0",
    };
    const photoItem: BudgetItemListItem = {
      ...groupedItems[0],
      id: "item_photo",
      name: "婚紗照拍攝",
      systemTaxonomyKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
      depth: 1,
      parentId: photoStage.id,
      breadcrumb: ["籌備第1-2月", "婚紗照拍攝"],
      directParentName: photoStage.name,
      hasChildren: false,
      directChildren: [],
      directChildCount: 0,
      descendantCount: 0,
      rolledUpPlannedAmount: "30000",
      rolledUpActualAmount: "0",
      rolledUpDepositAmount: "0",
      rolledUpBalanceAmount: "0",
    };
    const shoesStage: BudgetItemListItem = {
      ...groupedItems[0],
      id: "stage_shoes",
      name: "籌備婚禮第4個月",
      systemTaxonomyKey: "STAGE_PREPARATION_4_MONTH",
      depth: 0,
      parentId: null,
      breadcrumb: ["籌備婚禮第4個月"],
      directParentName: null,
      directChildren: [
        { id: "item_shoes", name: "婚鞋", hasChildren: true },
      ],
      directChildCount: 1,
      descendantCount: 2,
      rolledUpPlannedAmount: "3200",
      rolledUpActualAmount: "0",
      rolledUpDepositAmount: "0",
      rolledUpBalanceAmount: "0",
    };
    const shoesItem: BudgetItemListItem = {
      ...groupedItems[0],
      id: "item_shoes",
      name: "婚鞋",
      systemTaxonomyKey: "ITEM_WEDDING_SHOES",
      depth: 1,
      parentId: shoesStage.id,
      breadcrumb: ["籌備婚禮第4個月", "婚鞋"],
      directParentName: shoesStage.name,
      hasChildren: true,
      directChildren: [
        {
          id: "expense_white_shoes",
          name: "合成姓名的小白鞋",
          hasChildren: false,
        },
      ],
      directChildCount: 1,
      descendantCount: 1,
      rolledUpPlannedAmount: "3200",
      rolledUpActualAmount: "0",
      rolledUpDepositAmount: "0",
      rolledUpBalanceAmount: "0",
    };
    const whiteShoes: BudgetItemListItem = {
      ...items[0],
      id: "expense_white_shoes",
      name: "合成姓名的小白鞋",
      parentId: shoesItem.id,
      depth: 2,
      breadcrumb: ["籌備婚禮第4個月", "婚鞋", "合成姓名的小白鞋"],
      directParentName: shoesItem.name,
      category: "ATTIRE_STYLING",
      relatedTaxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
      source: "NOTION",
      sourceHierarchyPath: [
        "婚紗拍攝",
        "其他",
        "合成姓名的小白鞋",
      ],
      plannedAmount: 3200,
      rolledUpPlannedAmount: "3200",
      depositAmount: 1000,
      balanceAmount: 2200,
      confirmedVendor: "合成鞋履品牌",
      bookingStatus: "PAID",
      notes: "婚紗拍攝穿著",
    };
    const expansionStorageKey =
      "vowbook:budget-group-expansion:workspace_photo_shoes";
    const storedExpansion = JSON.stringify({
      stage_photo: true,
      item_photo: false,
      stage_shoes: false,
      item_shoes: false,
    });
    window.localStorage.setItem(expansionStorageKey, storedExpansion);

    const { container } = render(
      <BudgetList
        workspaceId="workspace_photo_shoes"
        items={[photoStage, photoItem, shoesStage, shoesItem, whiteShoes]}
        summary={{
          ...summary,
          itemCount: 1,
          paidCount: 1,
          plannedTotal: "3200",
          actualTotal: "0",
        }}
        canEdit={true}
      />,
    );

    const taxonomyNavigation = screen.getByRole("navigation", {
      name: "花費分類導覽",
    });
    expect(taxonomyNavigation).toHaveClass(
      "max-h-[calc(100vh-3rem)]",
      "overflow-y-auto",
    );
    expect(
      taxonomyNavigation.querySelectorAll('[aria-current="location"]'),
    ).toHaveLength(0);
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "展開品項分類：婚紗照拍攝",
        }),
      ).toHaveAttribute("aria-expanded", "false"),
    );
    const hydratedExpansion = window.localStorage.getItem(expansionStorageKey);
    expect(hydratedExpansion).not.toBeNull();
    expect(JSON.parse(hydratedExpansion ?? "{}")).toEqual(
      JSON.parse(storedExpansion),
    );
    const photographyNavigationLink = within(taxonomyNavigation).getByRole(
      "link",
      {
        name: /婚紗照拍攝/u,
      },
    );
    expect(photographyNavigationLink).toHaveAccessibleName(
      "婚紗照拍攝，0 筆主分類花費，另有 1 筆延伸",
    );
    fireEvent.click(photographyNavigationLink);
    expect(photographyNavigationLink).toHaveAttribute(
      "aria-current",
      "location",
    );
    const selectionContext = container.querySelector<HTMLElement>(
      '[data-budget-selection-context="true"]',
    );
    expect(
      within(selectionContext!).getByRole("heading", {
        name: "婚紗照拍攝",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", {
        name: "合成姓名的小白鞋",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", {
        name: "婚紗照拍攝的關聯延伸費用",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "籌備第1-2月" }),
    ).not.toBeInTheDocument();
    for (const controller of Array.from(
      container.querySelectorAll<HTMLElement>("[aria-controls]"),
    )) {
      for (const controlledId of
        controller.getAttribute("aria-controls")?.split(/\s+/u) ?? []) {
        expect(document.getElementById(controlledId)).not.toBeNull();
      }
    }
    // 契約是「選分類不會改變展開偏好」；JSON 的鍵順序跟著目前顯示的列走，沒有語意。
    expect(
      JSON.parse(window.localStorage.getItem(expansionStorageKey) ?? "{}"),
    ).toEqual(JSON.parse(hydratedExpansion ?? "{}"));

    const createExpenseSummary = within(selectionContext!).getByText(
      "在此分類新增花費",
      { selector: "summary" },
    );
    fireEvent.click(createExpenseSummary);
    expect(
      within(selectionContext!).getByRole("form", {
        name: "在婚紗照拍攝下新增花費表單",
      }),
    ).toHaveAttribute("data-parent-id", photoItem.id);
    const createGroupSummary = within(selectionContext!).getByText(
      "在此分類建立群組（選用）",
      { selector: "summary" },
    );
    fireEvent.click(createGroupSummary);
    expect(
      within(selectionContext!).getByRole("button", {
        name: "在「婚紗照拍攝」下建立群組",
      }),
    ).toBeVisible();

    fireEvent.click(
      within(selectionContext!).getByRole("button", {
        name: "顯示全部分類",
      }),
    );
    expect(photographyNavigationLink).not.toHaveAttribute("aria-current");
    await waitFor(() =>
      expect(
        within(selectionContext!).getByRole("heading", { name: "全部花費" }),
      ).toHaveFocus(),
    );
    expect(
      JSON.parse(window.localStorage.getItem(expansionStorageKey) ?? "{}"),
    ).toEqual(JSON.parse(hydratedExpansion ?? "{}"));

    fireEvent.click(photographyNavigationLink);
    expect(photographyNavigationLink).toHaveAttribute(
      "aria-current",
      "location",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "顯示已付清 1 筆花費" }),
    );
    expect(photographyNavigationLink).not.toHaveAttribute("aria-current");
    expect(
      within(selectionContext!).getByRole("heading", { name: "全部花費" }),
    ).toBeVisible();
    expect(
      JSON.parse(window.localStorage.getItem(expansionStorageKey) ?? "{}"),
    ).toEqual(JSON.parse(hydratedExpansion ?? "{}"));
    fireEvent.click(
      screen.getByRole("button", { name: "查看全部 1 筆花費" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "全部展開" }));
    const shoeRow = container.querySelector<HTMLElement>(
      '[data-budget-item-id="expense_white_shoes"]',
    );
    expect(shoeRow).not.toBeNull();
    expect(
      within(shoeRow!).getByText("品項分類：婚鞋", {
        selector: "[data-budget-category-label]",
      }),
    ).toBeVisible();
    expect(
      shoeRow!.querySelector('[data-budget-ledger-primary-category="true"]'),
    ).toHaveTextContent("婚鞋");
    expect(
      shoeRow!.querySelector('[data-budget-ledger-content-name="true"]'),
    ).toHaveTextContent("合成姓名的小白鞋");
    expect(within(shoeRow!).getByText("拍攝延伸")).toBeVisible();
    expect(within(shoeRow!).getByText("用途：婚紗照拍攝")).toBeVisible();
    const sourcePathText =
      "Notion 原始路徑：婚紗拍攝 › 其他 › 合成姓名的小白鞋";
    const shoeLedgerSurface = shoeRow!.querySelector<HTMLElement>(
      "[data-budget-ledger-surface]",
    );
    expect(within(shoeLedgerSurface!).getByText(sourcePathText)).toBeVisible();
    const brandColumn = shoeRow!.querySelector<HTMLElement>(
      '[data-budget-ledger-column="brand"]',
    );
    const depositColumn = shoeRow!.querySelector<HTMLElement>(
      '[data-budget-ledger-column="deposit"]',
    );
    const balanceColumn = shoeRow!.querySelector<HTMLElement>(
      '[data-budget-ledger-column="balance"]',
    );
    expect(within(brandColumn!).getByText(/合成鞋履品牌/u)).toBeVisible();
    expect(within(depositColumn!).getByText("NT$1,000")).toBeVisible();
    expect(within(balanceColumn!).getByText("NT$2,200")).toBeVisible();

    const relatedRegion = screen.getByRole("region", {
      name: "婚紗照拍攝的關聯延伸費用",
    });
    expect(relatedRegion).toHaveTextContent("合成姓名的小白鞋");
    expect(relatedRegion).toHaveTextContent("歸屬：婚鞋");
    expect(relatedRegion).toHaveTextContent("不計入本分類小計");
    expect(within(relatedRegion).getByText(sourcePathText)).toBeVisible();
    expect(
      within(relatedRegion).getAllByText("合成姓名的小白鞋"),
    ).toHaveLength(1);

    fireEvent.click(
      within(shoeRow!).getByRole("button", {
        name: "開啟花費明細與附件：合成姓名的小白鞋",
      }),
    );
    const shoeDialog = within(shoeRow!).getByRole("dialog", {
      name: "合成姓名的小白鞋",
    });
    const sourcePathDetailLabel = within(shoeDialog).getByText(
      "Notion 原始路徑",
    );
    expect(sourcePathDetailLabel.nextElementSibling).toHaveTextContent(
      "婚紗拍攝 › 其他 › 合成姓名的小白鞋",
    );
    fireEvent.click(
      within(shoeDialog).getByRole("button", {
        name: "關閉管理：合成姓名的小白鞋",
      }),
    );

    fireEvent.change(screen.getByLabelText("搜尋花費項目"), {
      target: { value: "其他" },
    });
    expect(ledgerListItem(whiteShoes.id)).not.toHaveAttribute("hidden");
    expect(
      screen.getByRole("heading", { name: "合成姓名的小白鞋" }),
    ).toBeVisible();
  });

  it("opens editor management in a modal dialog, keeps nested mutations, and restores focus", () => {
    const { container } = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={items}
        summary={summary}
        canEdit
      />,
    );

    const photographyDisclosure = screen
      .getByRole("heading", { name: "婚禮攝影" })
      .closest<HTMLElement>("[data-budget-ledger-row]");
    const hint = photographyDisclosure?.querySelector<HTMLElement>(
      '[data-budget-disclosure-hint="true"]',
    );

    expect(photographyDisclosure?.querySelector("dialog")).not.toHaveAttribute(
      "open",
    );
    expect(hint).toHaveClass(
      "inline-flex",
      "min-h-11",
      "rounded-xl",
      "border",
      "text-xs",
      "font-semibold",
      "text-clay",
      "underline",
      "decoration-line-strong",
      "underline-offset-4",
    );
    expect(within(hint!).getByText("明細與附件")).toBeInTheDocument();
    expect(within(hint!).queryByText("管理")).not.toBeInTheDocument();

    fireEvent.click(hint!);
    const managementDialog = within(photographyDisclosure!).getByRole(
      "dialog",
      { name: "婚禮攝影" },
    ) as HTMLDialogElement;

    expect(managementDialog).toHaveAttribute("open");
    expect(managementDialog).toHaveClass(
      "max-h-[calc(100dvh-2rem)]",
      "overflow-y-auto",
    );
    expect(within(managementDialog).getAllByText("管理花費項目")).toHaveLength(
      2,
    );
    expect(
      within(managementDialog).getByRole("button", {
        name: "編輯項目：婚禮攝影",
      }),
    ).toHaveTextContent("編輯項目");
    expect(
      within(managementDialog).getByRole("button", {
        name: "更新狀態 婚禮攝影",
      }),
    ).toBeInTheDocument();
    expect(
      within(managementDialog).getByRole("button", {
        name: "移除項目：婚禮攝影",
      }),
    ).toHaveTextContent("移除項目");
    expect(
      within(managementDialog).getByRole("form", {
        name: "編輯 婚禮攝影",
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(managementDialog).getByRole("button", {
        name: "關閉管理：婚禮攝影",
      }),
    );
    expect(managementDialog).not.toHaveAttribute("open");
    expect(hint).toHaveFocus();

    fireEvent.click(hint!);
    const escapeEvent = new Event("cancel", { cancelable: true });
    expect(managementDialog.dispatchEvent(escapeEvent)).toBe(true);
    managementDialog.close();
    expect(managementDialog).not.toHaveAttribute("open");
    expect(hint).toHaveFocus();

    expect(
      container.querySelectorAll('[data-budget-disclosure-hint="true"]'),
    ).toHaveLength(items.length);
    const editorTriggers = container.querySelectorAll<HTMLButtonElement>(
      "[data-budget-ledger-row] [data-budget-disclosure-hint]",
    );
    expect(editorTriggers).toHaveLength(items.length);
    for (const editorTrigger of editorTriggers) {
      expect(editorTrigger).toHaveAccessibleName(/開啟花費明細與附件/);
    }
  });

  it("closes a filtered-out management dialog and moves focus to the ledger heading", () => {
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={items}
        summary={summary}
        canEdit
      />,
    );

    const planningRow = screen
      .getByRole("heading", { name: "婚禮攝影" })
      .closest<HTMLElement>("[data-budget-ledger-row]");
    const trigger = planningRow?.querySelector<HTMLButtonElement>(
      '[data-budget-disclosure-hint="true"]',
    );
    fireEvent.click(trigger!);
    const dialog = within(planningRow!).getByRole("dialog", {
      name: "婚禮攝影",
    });
    expect(dialog).toHaveAttribute("open");

    fireEvent.click(
      within(
        screen.getByRole("group", { name: "依下訂與付款狀態篩選" }),
      ).getByRole("button", { name: "已付清" }),
    );

    expect(planningRow?.closest("li")).toHaveAttribute("hidden");
    expect(dialog).not.toHaveAttribute("open");
    expect(screen.getByRole("heading", { name: "花費明細" })).toHaveFocus();
  });

  it("locks the management dialog while an embedded mutation is pending", () => {
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={items}
        summary={summary}
        canEdit
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "開啟花費明細與附件：婚禮攝影",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "婚禮攝影",
    }) as HTMLDialogElement;
    expect(
      within(dialog).getByRole("heading", { name: "婚禮攝影" }),
    ).toHaveFocus();
    const closeButton = screen.getByRole("button", {
      name: "關閉管理：婚禮攝影",
    });
    const content = screen.getByRole("region", {
      name: "婚禮攝影 花費完整資料",
    });

    fireEvent.click(screen.getByRole("button", { name: "模擬狀態處理中" }));
    expect(closeButton).toBeDisabled();
    expect(content).toHaveAttribute("aria-busy", "true");
    expect(content).toHaveAttribute("inert");

    const cancelEvent = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(dialog).toHaveAttribute("open");

    fireEvent.click(screen.getByRole("button", { name: "結束狀態處理" }));
    expect(closeButton).toBeEnabled();
    fireEvent.click(closeButton);
    expect(dialog).not.toHaveAttribute("open");
  });

  it("keeps delete feedback after the removed row unmounts and focuses the list heading", async () => {
    const { rerender } = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={items}
        summary={summary}
        canEdit
      />,
    );
    const removed = items[0];
    fireEvent.click(
      screen.getByRole("button", {
        name: `開啟花費明細與附件：${removed.name}`,
      }),
    );
    const dialog = screen.getByRole("dialog", { name: removed.name });
    const removeButton = within(dialog).getByRole("button", {
      name: `移除項目：${removed.name}`,
    });
    removeButton.focus();
    fireEvent.click(removeButton);
    expect(screen.getByRole("status")).toHaveTextContent(
      `已移除花費項目「${removed.name}」。`,
    );

    rerender(
      <BudgetList
        workspaceId="workspace_internal"
        items={items.slice(1)}
        summary={{ ...summary, itemCount: summary.itemCount - 1 }}
        canEdit
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      `已移除花費項目「${removed.name}」。`,
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "花費明細" })).toHaveFocus(),
    );
  });

  it("keeps dissolve feedback in BudgetList after the GROUP row unmounts and uses its direct-child snapshot", async () => {
    const { rerender } = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={groupedItems}
        summary={summary}
        canEdit
      />,
    );
    selectGroupView();
    fireEvent.click(
      screen.getByRole("button", {
        name: "管理群組：婚紗方案",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "婚紗方案" });
    expect(
      within(dialog).getByText("2 個直接子項會移到最上層。"),
    ).toBeInTheDocument();
    const dissolveButton = within(dialog).getByRole("button", {
      name: "移除群組並保留項目：婚紗方案",
    });
    dissolveButton.focus();
    fireEvent.click(dissolveButton);
    expect(screen.getByRole("status")).toHaveTextContent(
      "已移除群組並保留其中項目。",
    );

    rerender(
      <BudgetList
        workspaceId="workspace_internal"
        items={groupedItems.slice(1).map((item) => ({
          ...item,
          parentId: null,
          depth: 0,
          breadcrumb: [item.name],
          directParentName: null,
          version: item.version + 1,
        }))}
        summary={summary}
        canEdit
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "已移除群組並保留其中項目。",
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "花費明細" })).toHaveFocus(),
    );
  });

  it("explains the fixed stage and item taxonomy without importing sample values", () => {
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={items}
        summary={summary}
        canEdit={false}
      />,
    );

    fireEvent.click(screen.getByText("籌備階段與品項分類怎麼用？"));
    expect(screen.getByText(/籌備階段 → 品項分類 → 實際花費/)).toBeVisible();
    expect(
      screen.getByText(/固定階段與品項無法重新命名、移動或刪除/),
    ).toBeVisible();
    expect(
      screen.getByText(/文件中的品牌、金額與數量只是範例/),
    ).toBeVisible();
  });

  it("renders untrusted text only as text nodes", () => {
    const malicious = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={[
          {
            ...items[0],
            name: malicious,
            notes: `<script>${malicious}</script>`,
          },
        ]}
        summary={{
          itemCount: 1,
          paidCount: 0,
          plannedTotal: "88000",
          actualTotal: "0",
          balanceDueTotal: "0",
          balanceDueCount: 0,
          balanceDueMissingAmountCount: 0,
          nearestBalanceDueDate: null,
        }}
        canEdit={false}
      />,
    );

    expect(
      screen.getByRole("heading", { name: malicious }),
    ).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("shows ordinary groups as non-priced headings while preserving leaf semantics", () => {
    const { container } = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={[
          {
            ...items[0],
            id: "budget_parent_internal",
            name: "婚紗方案",
            kind: "GROUP",
            category: null,
            directParentName: null,
            parentId: null,
            hasChildren: true,
            breadcrumb: ["婚紗方案"],
            directChildren: [
              {
                id: "budget_child_internal",
                name: "拍攝組合",
                hasChildren: true,
              },
            ],
            directChildCount: 1,
            descendantCount: 2,
            plannedAmount: 0,
            rolledUpPlannedAmount: "76000",
            actualAmount: null,
            rolledUpActualAmount: "43000",
            rolledUpDepositAmount: "0",
            rolledUpBalanceAmount: "0",
          },
          {
            ...items[1],
            id: "budget_child_internal",
            name: "拍攝組合",
            kind: "GROUP",
            category: null,
            directParentName: "婚紗方案",
            parentId: "budget_parent_internal",
            depth: 1,
            hasChildren: true,
            breadcrumb: ["婚紗方案", "拍攝組合"],
            directChildren: [
              {
                id: "budget_depth_three_internal",
                name: "精修加購",
                hasChildren: false,
              },
            ],
            directChildCount: 1,
            descendantCount: 1,
            plannedAmount: 0,
            rolledUpPlannedAmount: "26000",
            actualAmount: null,
            rolledUpActualAmount: "23000",
            rolledUpDepositAmount: "0",
            rolledUpBalanceAmount: "0",
          },
          {
            ...items[1],
            id: "budget_depth_three_internal",
            name: "精修加購",
            parentId: "budget_child_internal",
            directParentName: "拍攝組合",
            depth: 2,
            breadcrumb: ["婚紗方案", "拍攝組合", "精修加購"],
            directChildren: [],
            directChildCount: 0,
            descendantCount: 0,
            plannedAmount: 1000,
            rolledUpPlannedAmount: "1000",
            actualAmount: null,
            rolledUpActualAmount: "0",
            rolledUpDepositAmount: "0",
            rolledUpBalanceAmount: "0",
          },
        ]}
        summary={summary}
        canEdit={false}
      />,
    );

    selectGroupView();
    fireEvent.click(screen.getByRole("button", { name: "全部展開" }));

    const parentToggle = screen.getByRole("button", {
      name: "收合群組：婚紗方案",
    });
    const childToggle = screen.getByRole("button", {
      name: "收合群組：拍攝組合",
    });
    expect(parentToggle.getAttribute("aria-controls")?.split(/\s+/u)).toEqual([
      ledgerListItem("budget_child_internal").id,
    ]);
    expect(childToggle.getAttribute("aria-controls")?.split(/\s+/u)).toEqual([
      ledgerListItem("budget_depth_three_internal").id,
    ]);

    const parentSummary = screen
      .getByRole("heading", { name: "婚紗方案" })
      .closest<HTMLElement>("[data-budget-ledger-surface]");
    expect(parentSummary).not.toBeNull();
    expect(parentSummary?.closest("[data-budget-ledger-row]")).toHaveAttribute(
      "data-budget-row-kind",
      "group",
    );
    expect(parentSummary?.closest("[data-budget-ledger-row]")).toHaveAttribute(
      "data-budget-ledger-row",
      "group",
    );
    expect(parentSummary).toHaveAttribute(
      "data-budget-ledger-surface",
      "group-band",
    );
    expect(parentSummary).toHaveAttribute(
      "data-budget-scan-alignment",
      "shared",
    );
    expect(
      within(parentSummary!).getByText("婚紗方案", {
        selector: "[data-budget-hierarchy-breadcrumb]",
      }),
    ).toBeVisible();
    expect(
      within(parentSummary!).queryByText(/第 1 層/u),
    ).not.toBeInTheDocument();
    expect(
      within(parentSummary!).getByText("1 個直接項目"),
    ).toBeInTheDocument();
    expect(within(parentSummary!).getByText("共 2 個下層項目")).toHaveAttribute(
      "data-budget-descendant-count",
      "2",
    );
    expect(within(parentSummary!).getByText("來源群組")).toBeVisible();
    expect(within(parentSummary!).getByText("非計價標題")).toBeVisible();
    expect(
      parentSummary?.querySelector('[data-budget-mobile-row="amounts"]'),
    ).toBeNull();
    expect(
      parentSummary?.querySelector('[data-budget-ledger-column="brand"]'),
    ).toBeNull();
    expect(parentSummary).not.toHaveTextContent("NT$");
    fireEvent.click(
      within(parentSummary!).getByRole("button", {
        name: "查看群組詳情：婚紗方案",
      }),
    );
    const hierarchyDialog = screen.getByRole("dialog", {
      name: "婚紗方案",
    });
    expect(
      within(hierarchyDialog).getByRole("navigation", {
        name: "群組層級路徑",
      }),
    ).toHaveTextContent("婚紗方案");
    expect(hierarchyDialog).toHaveTextContent("直接子項 1 項");
    expect(hierarchyDialog).toHaveTextContent("全部下層 2 項");
    expect(hierarchyDialog).toHaveTextContent(
      "此來源群組是非計價標題；金額只記錄在下層花費。",
    );
    expect(hierarchyDialog).not.toHaveTextContent("群組預計花費");
    expect(hierarchyDialog).not.toHaveTextContent("群組已記錄實付");
    expect(hierarchyDialog).not.toHaveTextContent("NT$");
    expect(
      within(hierarchyDialog).getByRole("heading", { name: "直接子項" }),
    ).toBeInTheDocument();
    expect(hierarchyDialog).toHaveTextContent("拍攝組合");
    expect(hierarchyDialog).toHaveTextContent("還有下一層");

    const childSummary = screen
      .getByRole("heading", { name: "拍攝組合" })
      .closest<HTMLElement>("[data-budget-ledger-surface]");
    expect(childSummary).not.toBeNull();
    expect(childSummary?.closest("[data-budget-ledger-row]")).toHaveAttribute(
      "data-budget-row-kind",
      "group",
    );
    expect(childSummary?.closest("[data-budget-ledger-row]")).toHaveAttribute(
      "data-budget-ledger-row",
      "group",
    );
    expect(childSummary).toHaveAttribute(
      "data-budget-ledger-surface",
      "group-band",
    );
    expect(childSummary).toHaveAttribute(
      "data-budget-scan-alignment",
      "shared",
    );
    expect(within(childSummary!).getByText("來源群組")).toBeVisible();
    expect(within(childSummary!).getByText("非計價標題")).toBeVisible();
    expect(
      childSummary?.querySelector('[data-budget-mobile-row="amounts"]'),
    ).toBeNull();
    expect(
      within(childSummary!).getByText("婚紗方案 › 拍攝組合", {
        selector: "[data-budget-hierarchy-breadcrumb]",
      }),
    ).toBeVisible();
    expect(
      within(childSummary!).queryByText(/第 2 層/u),
    ).not.toBeInTheDocument();
    expect(childSummary).toHaveTextContent("1 個直接項目");
    expect(childSummary).toHaveTextContent("共 1 個下層項目");
    expect(childSummary).not.toHaveTextContent("↳");
    expect(childSummary?.closest("[data-budget-ledger-row]")).toHaveAttribute(
      "data-budget-branch",
      "nested",
    );
    const childMobileLayout = childSummary?.querySelector(
      '[data-budget-scan-layout="source-group-header"]',
    );
    expect(
      childMobileLayout?.querySelectorAll('[data-budget-mobile-row="primary"]'),
    ).toHaveLength(2);
    expect(
      childMobileLayout?.querySelectorAll(
        '[data-budget-mobile-row="metadata"]',
      ),
    ).toHaveLength(1);
    expect(
      childMobileLayout?.querySelectorAll('[data-budget-mobile-row="amounts"]'),
    ).toHaveLength(0);

    const deepDetails = screen
      .getByRole("heading", { name: "精修加購" })
      .closest<HTMLElement>("[data-budget-ledger-row]");
    expect(deepDetails).toHaveAttribute("data-budget-depth", "2");
    expect(deepDetails).not.toHaveClass("border-l");
    expect(deepDetails).not.toHaveClass("pl-2");
    expect(deepDetails?.style.marginInlineStart).toBe("");
    expect(deepDetails?.style.paddingInlineStart).toBe("");
    expect(
      deepDetails?.querySelector("[data-budget-ledger-surface]"),
    ).toHaveAttribute("data-budget-scan-alignment", "shared");
    expect(container).not.toHaveTextContent("↳");
  });

  it("keeps hierarchy counts visible when an EXPENSE is also a parent", () => {
    const expenseParent = {
      ...items[0],
      id: "budget_expense_parent_internal",
      name: "婚宴主合約",
      kind: "EXPENSE" as const,
      breadcrumb: ["婚宴主合約"],
      directChildren: [
        {
          id: "budget_expense_child_internal",
          name: "婚宴主合約追加項",
          hasChildren: false,
        },
      ],
      directChildCount: 1,
      descendantCount: 1,
      hasChildren: true,
      rolledUpPlannedAmount: "96000",
      rolledUpActualAmount: "0",
      rolledUpDepositAmount: "0",
      rolledUpBalanceAmount: "0",
    };
    const expenseChild = {
      ...items[1],
      id: "budget_expense_child_internal",
      name: "婚宴主合約追加項",
      parentId: expenseParent.id,
      directParentName: expenseParent.name,
      depth: 1,
      breadcrumb: [expenseParent.name, "婚宴主合約追加項"],
      directChildren: [],
      directChildCount: 0,
      descendantCount: 0,
      hasChildren: false,
    };
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={[expenseParent, expenseChild]}
        summary={{ ...summary, itemCount: 2 }}
        canEdit={false}
      />,
    );

    const parentSurface = screen
      .getByRole("heading", { name: "婚宴主合約" })
      .closest<HTMLElement>("[data-budget-ledger-surface]");
    expect(parentSurface).not.toBeNull();
    expect(within(parentSurface!).getByText("1 個直接項目")).toBeVisible();
    expect(within(parentSurface!).getByText("共 1 個下層項目")).toBeVisible();
  });


  it("stops rendering a Notion pass-through node as a priced expense row", () => {
    // Notion 匯入把每一列都標成 EXPENSE，包含只用來分層的節點。
    // 這種節點自己沒有金額，畫成有價的一列會讓同一筆錢在畫面上出現兩次。
    const passThrough: BudgetItemListItem = {
      ...items[0],
      id: "budget_source_layer",
      name: "婚禮攝影廠商",
      source: "NOTION",
      sourceHierarchyPath: ["宴客", "婚禮攝影廠商"],
      hasChildren: true,
      directChildren: [{ id: "budget_leaf", name: "平面", hasChildren: false }],
      directChildCount: 1,
      descendantCount: 1,
      plannedAmount: 0,
      rolledUpPlannedAmount: "25800",
      actualAmount: null,
      rolledUpActualAmount: "10000",
      rolledUpDepositAmount: "10000",
      rolledUpBalanceAmount: "15800",
      depositAmount: null,
      balanceAmount: null,
      additionalAmount: null,
      bookingStatus: "PLANNING",
    };
    const leaf: BudgetItemListItem = {
      ...items[0],
      id: "budget_leaf",
      parentId: passThrough.id,
      depth: 1,
      name: "平面",
      source: "NOTION",
      sourceHierarchyPath: ["宴客", "婚禮攝影廠商", "平面"],
      breadcrumb: [passThrough.name, "平面"],
      directParentName: passThrough.name,
      plannedAmount: 25800,
      rolledUpPlannedAmount: "25800",
      actualAmount: 10000,
      rolledUpActualAmount: "10000",
      rolledUpDepositAmount: "10000",
      rolledUpBalanceAmount: "15800",
      depositAmount: 10000,
      balanceAmount: 15800,
      bookingStatus: "BOOKED_BALANCE_DUE",
    };

    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={[passThrough, leaf]}
        summary={{ ...summary, itemCount: 2 }}
        canEdit={false}
      />,
    );

    const passThroughRow = screen
      .getByRole("heading", { name: "婚禮攝影廠商" })
      .closest<HTMLElement>("[data-budget-ledger-surface]");
    expect(
      passThroughRow!.querySelector('[data-budget-pass-through="true"]'),
    ).toHaveTextContent("來源分層，金額都記在下層項目");
    expect(
      passThroughRow!.querySelector('[data-budget-ledger-column="deposit"]'),
    ).toBeNull();
    expect(
      passThroughRow!.querySelector('[data-budget-ledger-column="balance"]'),
    ).toBeNull();

    // 真正有錢的那一列不受影響。
    const leafRow = screen
      .getByRole("heading", { name: "平面" })
      .closest<HTMLElement>("[data-budget-ledger-surface]");
    expect(
      leafRow!.querySelector('[data-budget-ledger-column="deposit"]'),
    ).toHaveTextContent("NT$10,000");

    // 來源路徑和樹狀位置一致時不再重複印在列上（明細與附件面板裡仍然有）。
    expect(
      leafRow!.querySelector('[data-budget-notion-source-path="true"]'),
    ).toBeNull();
  });

  it("keeps create disclosure and item editor forms mounted in closed dialogs", () => {
    const { container } = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={items}
        summary={summary}
        canEdit
      />,
    );

    const createDisclosure = screen
      .getByText("新增花費", { selector: "summary" })
      .closest("details");
    expect(createDisclosure).not.toBeNull();
    expect(createDisclosure).not.toHaveAttribute("open");
    expect(
      within(createDisclosure!).getByRole("form", { name: "新增花費表單" }),
    ).toBeInTheDocument();

    const photographyDisclosure = screen
      .getByRole("heading", { name: "婚禮攝影" })
      .closest<HTMLElement>("[data-budget-ledger-row]");
    expect(photographyDisclosure).not.toBeNull();
    expect(photographyDisclosure?.querySelector("dialog")).not.toHaveAttribute(
      "open",
    );
    expect(
      photographyDisclosure?.querySelector(
        'dialog form[aria-label="編輯 婚禮攝影"]',
      ),
    ).toBeInTheDocument();
    expect(
      photographyDisclosure?.querySelector(
        'dialog form[aria-label="更新狀態 婚禮攝影"]',
      ),
    ).toBeInTheDocument();
    expect(
      photographyDisclosure?.querySelector(
        'dialog form[aria-label="移除項目：婚禮攝影"]',
      ),
    ).toBeInTheDocument();
    expect(
      photographyDisclosure?.querySelector("[data-budget-ledger-surface] form"),
    ).not.toBeInTheDocument();
    for (const summaryElement of container.querySelectorAll("summary")) {
      expect(
        summaryElement.querySelector(
          "button, a, input, select, textarea, form, [aria-expanded]",
        ),
      ).toBeNull();
    }
  });

  it("searches names and vendor text and filters booking status", () => {
    const { container } = render(
      <BudgetList
        workspaceId="workspace_internal"
        items={[
          ...items,
          {
            ...items[0],
            id: "budget_booked_internal",
            name: "婚禮樂團",
            breadcrumb: ["婚禮樂團"],
            category: "PEOPLE_SERVICES",
            bookingStatus: "BOOKED_BALANCE_DUE",
            confirmedVendor: "月光音樂工作室",
          },
        ]}
        summary={{ ...summary, itemCount: 3 }}
        canEdit={false}
      />,
    );

    expect(screen.getByText("顯示 3 / 3 筆花費")).toBeInTheDocument();
    const toolbar = container.querySelector("[data-budget-toolbar]");
    expect(toolbar).toContainElement(screen.getByLabelText("搜尋花費項目"));
    expect(toolbar).toContainElement(
      screen.getByRole("group", { name: "依下訂與付款狀態篩選" }),
    );
    expect(toolbar).toContainElement(screen.getByText("顯示 3 / 3 筆花費"));
    expect(screen.getByText("顯示 3 / 3 筆花費")).toHaveAttribute(
      "aria-live",
      "polite",
    );

    fireEvent.change(screen.getByLabelText("搜尋花費項目"), {
      target: { value: "攝影" },
    });
    expect(
      screen.getByRole("heading", { name: "婚禮攝影" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "婚宴場地" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("符合 1 / 3 筆花費")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("搜尋花費項目"), {
      target: { value: "月光音樂" },
    });
    expect(
      screen.getByRole("heading", { name: "婚禮樂團" }),
    ).toBeInTheDocument();
    const bookedSummary = screen
      .getByRole("heading", { name: "婚禮樂團" })
      .closest<HTMLElement>("[data-budget-ledger-surface]");
    expect(
      within(bookedSummary!).getByText("已下訂", { selector: "span" }),
    ).toHaveAttribute("aria-hidden", "true");
    expect(
      within(bookedSummary!).getByText("已下訂，尾款未清", {
        selector: "span",
      }),
    ).toHaveClass("sr-only");

    fireEvent.change(screen.getByLabelText("搜尋花費項目"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "已下訂" }));
    expect(
      screen.getByRole("heading", { name: "婚禮樂團" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "婚禮攝影" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已下訂" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("符合 1 / 3 筆花費")).toBeInTheDocument();
  });

  it("keeps unmatched ancestors as labeled context without counting them as matches", () => {
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={[
          {
            ...items[0],
            id: "budget_context_parent",
            name: "婚宴主分類",
            kind: "GROUP",
            category: null,
            hasChildren: true,
          },
          {
            ...items[1],
            id: "budget_context_child",
            name: "目標細項",
            parentId: "budget_context_parent",
            depth: 1,
            directParentName: "婚宴主分類",
          },
          {
            ...items[0],
            id: "budget_other_root",
            name: "其他分類",
          },
        ]}
        summary={{ ...summary, itemCount: 2 }}
        canEdit={false}
      />,
    );

    selectGroupView();

    fireEvent.change(screen.getByLabelText("搜尋花費項目"), {
      target: { value: "目標細項" },
    });

    const contextRow = screen
      .getByRole("heading", { name: "婚宴主分類" })
      .closest<HTMLElement>("[data-budget-ledger-row]");
    expect(contextRow).toHaveAttribute("data-budget-context", "true");
    expect(within(contextRow!).getByText("上層脈絡")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "目標細項" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "其他分類" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("符合 1 / 2 筆花費、0 / 1 個群組，另顯示 1 個上層群組"),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("搜尋花費項目"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "已付清" }));
    expect(
      screen.getByRole("heading", { name: "婚宴主分類" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "目標細項" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("符合 1 / 2 筆花費、0 / 1 個群組，另顯示 1 個上層群組"),
    ).toBeInTheDocument();
  });

  it("keeps an unsaved edit draft mounted but inaccessible while filters hide its row", () => {
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={items}
        summary={summary}
        canEdit
      />,
    );

    const photographyRow = screen
      .getByRole("heading", { name: "婚禮攝影" })
      .closest("li");
    const draftName = within(photographyRow!).getByLabelText("項目名稱");
    fireEvent.change(draftName, { target: { value: "尚未儲存的攝影草稿" } });

    fireEvent.change(screen.getByLabelText("搜尋花費項目"), {
      target: { value: "婚宴場地" },
    });
    expect(photographyRow).toHaveAttribute("hidden");
    expect(
      screen.queryByRole("heading", { name: "婚禮攝影" }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("搜尋花費項目"), {
      target: { value: "" },
    });
    expect(photographyRow).not.toHaveAttribute("hidden");
    expect(within(photographyRow!).getByLabelText("項目名稱")).toHaveValue(
      "尚未儲存的攝影草稿",
    );
  });

  it("shows a useful zero-result state without replacing the original data set", () => {
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={items}
        summary={summary}
        canEdit={false}
      />,
    );

    fireEvent.change(screen.getByLabelText("搜尋花費項目"), {
      target: { value: "不存在的廠商" },
    });

    expect(screen.getByText("符合 0 / 2 筆花費")).toBeInTheDocument();
    expect(screen.getByText(/找不到符合條件的花費項目/)).toBeInTheDocument();
    expect(screen.queryByText(/尚未建立花費項目/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除篩選" }));
    expect(screen.getByText("顯示 2 / 2 筆花費")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "婚禮攝影" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "婚宴場地" }),
    ).toBeInTheDocument();
  });

  it("distinguishes pending preparation suggestions from ordinary planning expenses", () => {
    const preparation = {
      ...items[0],
      id: "budget_preparation",
      name: "婚戒（求婚戒與對戒）",
      suggestionKey: "PREPARATION_PROPOSAL_WEDDING_RINGS",
      bookingStatus: "PLANNING" as const,
    };
    const ordinary = {
      ...items[0],
      id: "budget_ordinary",
      name: "一般規劃花費",
      suggestionKey: null,
      bookingStatus: "PLANNING" as const,
    };
    const booked = {
      ...preparation,
      id: "budget_preparation_booked",
      name: "已下訂的常見項目",
      bookingStatus: "BOOKED_BALANCE_DUE" as const,
    };
    render(
      <BudgetList
        workspaceId="workspace_internal"
        items={[preparation, ordinary, booked]}
        summary={{ ...summary, itemCount: 3 }}
        canEdit={false}
      />,
    );

    const preparationRow = ledgerListItem(preparation.id);
    const ordinaryRow = ledgerListItem(ordinary.id);
    const bookedRow = ledgerListItem(booked.id);
    expect(
      preparationRow.querySelector("[data-budget-preparation-status]"),
    ).toHaveAttribute("data-budget-preparation-status", "pending");
    expect(within(preparationRow).getByText("待準備")).toBeVisible();
    expect(preparationRow).toHaveTextContent(
      "常見婚禮項目待準備，目前狀態為規劃中",
    );
    expect(
      ordinaryRow.querySelector("[data-budget-preparation-status]"),
    ).not.toBeInTheDocument();
    expect(within(ordinaryRow).queryByText("待準備")).not.toBeInTheDocument();
    expect(
      bookedRow.querySelector("[data-budget-preparation-status]"),
    ).not.toBeInTheDocument();
    expect(within(bookedRow).queryByText("待準備")).not.toBeInTheDocument();
  });

  it("shows Budget rebuild only to an OWNER with ordinary rows", () => {
    const resetSnapshot = {
      token: "a".repeat(64),
      itemCount: 2,
      notionItemCount: 1,
      manualItemCount: 1,
      attachmentCount: 0,
    };
    const { rerender } = render(
      <BudgetList
        workspaceId="workspace_internal"
        workspaceName="我們的婚宴"
        items={items}
        summary={summary}
        canEdit
        canResetBudget
        resetSnapshot={resetSnapshot}
      />,
    );
    expect(screen.getByRole("region", { name: "資料重建" })).toHaveTextContent(
      "OWNER 重建 我們的婚宴 2",
    );

    rerender(
      <BudgetList
        workspaceId="workspace_internal"
        workspaceName="我們的婚宴"
        items={items}
        summary={summary}
        canEdit
        canResetBudget={false}
        resetSnapshot={resetSnapshot}
      />,
    );
    expect(
      screen.queryByRole("region", { name: "資料重建" }),
    ).not.toBeInTheDocument();

    rerender(
      <BudgetList
        workspaceId="workspace_internal"
        workspaceName="我們的婚宴"
        items={items}
        summary={summary}
        canEdit
        canResetBudget
        resetSnapshot={{ ...resetSnapshot, itemCount: 0 }}
      />,
    );
    expect(
      screen.queryByRole("region", { name: "資料重建" }),
    ).not.toBeInTheDocument();
  });
});
