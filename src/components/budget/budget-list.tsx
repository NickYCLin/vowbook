"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  CalendarBlank,
  CaretDown,
  Eye,
  MagnifyingGlass,
  Plus,
} from "@phosphor-icons/react";
import {
  BUDGET_BOOKING_STATUS_LABELS,
  BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
  BUDGET_INTERNAL_UNCLASSIFIED_STAGE_KEY,
  BUDGET_PRIMARY_CONTACT_LABELS,
  BUDGET_TAXONOMY_ITEM_KEYS,
  BUDGET_TAXONOMY_NODE_BY_KEY,
  BUDGET_TAXONOMY_STAGES,
  formatTwdAmount,
  type BudgetCostCategory,
  type BudgetTaxonomyItemKey,
  type BudgetTaxonomyNodeKey,
} from "@/domain/budget-item";
import { coveredBudgetPreparationSuggestionKeys } from "@/domain/budget-preparation-preset";
import { containDialogFocus } from "@/lib/dialog-focus-containment";
import type { BudgetItemListItem, BudgetSummary } from "@/lib/budget-list";
import { BudgetAttachments } from "./budget-attachments";
import { BudgetEngagementPreset } from "./budget-engagement-preset";
import { BudgetPreparationPreset } from "./budget-preparation-preset";
import {
  CreateBudgetGroupDialog,
  DeleteBudgetGroupSubtreeDialog,
  DissolveBudgetGroupForm,
  EditBudgetGroupDialog,
} from "./budget-group-forms";
import {
  ChangeBudgetItemBookingStatusForm,
  CreateBudgetItemForm,
  DeleteBudgetItemForm,
  EditBudgetItemForm,
  MoveBudgetItemForm,
  ResetBudgetDataForm,
  type BudgetMoveTarget,
} from "./budget-forms";
import type { BudgetResetSnapshot } from "@/lib/budget-reset-snapshot";

type BudgetStatusFilter = "ALL" | "PLANNING" | "BOOKED_BALANCE_DUE" | "PAID";

type GroupExpansionState = {
  workspaceId: string | null;
  expanded: Record<string, boolean>;
};

type TaxonomySelectionState = {
  workspaceId: string | null;
  itemId: string | null;
};

type BudgetTaxonomyNavigationStage = {
  stage: BudgetItemListItem;
  items: BudgetItemListItem[];
};

type BudgetKindCounts = {
  expenses: number;
  groups: number;
};

type TaxonomyAwareBudgetItem = BudgetItemListItem & {
  systemTaxonomyKey?: string | null;
  suggestionKey?: string | null;
};


type RelatedBudgetExpense = {
  id: string;
  name: string;
  primaryTaxonomyItemLabel: string;
  plannedAmount: number;
  sourceHierarchyPath: string[];
};
const BUDGET_TAXONOMY_ITEM_KEY_SET: ReadonlySet<string> = new Set(
  BUDGET_TAXONOMY_ITEM_KEYS,
);
const BUDGET_TAXONOMY_STAGE_KEY_SET: ReadonlySet<string> = new Set(
  BUDGET_TAXONOMY_STAGES.map((stage) => stage.key),
);
const LEGACY_UNCLASSIFIED_HEADING = "待重新分類的既有資料";

function systemTaxonomyKeyOf(
  item: BudgetItemListItem,
): string | null | undefined {
  return (item as TaxonomyAwareBudgetItem).systemTaxonomyKey;
}

function suggestionKeyOf(item: BudgetItemListItem): string | null | undefined {
  return (item as TaxonomyAwareBudgetItem).suggestionKey;
}

function isTaxonomyItemKey(value: unknown): value is BudgetTaxonomyItemKey {
  return typeof value === "string" && BUDGET_TAXONOMY_ITEM_KEY_SET.has(value);
}

function taxonomyNodeLabel(value: string | null | undefined): string | null {
  if (
    typeof value !== "string" ||
    (!BUDGET_TAXONOMY_ITEM_KEY_SET.has(value) &&
      !BUDGET_TAXONOMY_STAGE_KEY_SET.has(value))
  ) {
    return null;
  }
  return BUDGET_TAXONOMY_NODE_BY_KEY[value as BudgetTaxonomyNodeKey].label;
}

function notionSourceHierarchyPathOf(item: BudgetItemListItem): string[] {
  const sourceHierarchyPath = item.sourceHierarchyPath ?? [];
  if (
    item.source !== "NOTION" ||
    !Array.isArray(sourceHierarchyPath) ||
    sourceHierarchyPath.length === 0 ||
    sourceHierarchyPath.length > 4 ||
    sourceHierarchyPath.some(
      (segment) => typeof segment !== "string" || segment.trim().length === 0,
    )
  ) {
    return [];
  }
  return sourceHierarchyPath.map((segment) => segment.trim());
}

function pruneEmptyFixedTaxonomyNodes(
  driveItems: BudgetItemListItem[],
  allItems: BudgetItemListItem[],
): BudgetItemListItem[] {
  const relatedItemKeys = new Set<BudgetTaxonomyItemKey>();
  for (const item of allItems) {
    if (
      item.kind === "EXPENSE" &&
      isTaxonomyItemKey(item.relatedTaxonomyItemKey)
    ) {
      relatedItemKeys.add(item.relatedTaxonomyItemKey);
    }
  }

  const fixedItemByKey = new Map<
    BudgetTaxonomyItemKey,
    BudgetItemListItem
  >();
  const visibleItemKeys = new Set<BudgetTaxonomyItemKey>();
  for (const item of driveItems) {
    const key = systemTaxonomyKeyOf(item);
    if (!isTaxonomyItemKey(key)) continue;
    fixedItemByKey.set(key, item);
    if (item.descendantCount > 0 || relatedItemKeys.has(key)) {
      visibleItemKeys.add(key);
    }
  }

  const visibleStageKeys = new Set<string>();
  for (const stage of BUDGET_TAXONOMY_STAGES) {
    if (stage.items.some((item) => visibleItemKeys.has(item.key))) {
      visibleStageKeys.add(stage.key);
    }
  }

  return driveItems.flatMap((item) => {
    const key = systemTaxonomyKeyOf(item);
    if (isTaxonomyItemKey(key)) {
      return visibleItemKeys.has(key) ? [item] : [];
    }
    if (
      typeof key !== "string" ||
      !BUDGET_TAXONOMY_STAGE_KEY_SET.has(key)
    ) {
      return [item];
    }
    if (!visibleStageKeys.has(key)) {
      return [];
    }

    const stage = BUDGET_TAXONOMY_STAGES.find(
      (candidate) => candidate.key === key,
    );
    if (!stage) return [];
    const visibleChildren = stage.items
      .filter((definition) => visibleItemKeys.has(definition.key))
      .map((definition) => fixedItemByKey.get(definition.key))
      .filter((child): child is BudgetItemListItem => child !== undefined);
    const visibleChildIds = new Set(visibleChildren.map((child) => child.id));

    return [
      {
        ...item,
        hasChildren: visibleChildren.length > 0,
        directChildren: item.directChildren.filter((child) =>
          visibleChildIds.has(child.id),
        ),
        directChildCount: visibleChildren.length,
        descendantCount: visibleChildren.reduce(
          (count, child) => count + child.descendantCount + 1,
          0,
        ),
      },
    ];
  });
}

function prepareBudgetDisplayItems(items: BudgetItemListItem[]): {
  driveItems: BudgetItemListItem[];
  legacyItems: BudgetItemListItem[];
  displayItems: BudgetItemListItem[];
} {
  const internalItem = items.find(
    (item) =>
      systemTaxonomyKeyOf(item) === BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
  );
  const internalWrapperIds = new Set(
    items
      .filter((item) => {
        const key = systemTaxonomyKeyOf(item);
        return (
          key === BUDGET_INTERNAL_UNCLASSIFIED_STAGE_KEY ||
          key === BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY
        );
      })
      .map((item) => item.id),
  );

  let unfilteredDriveItems: BudgetItemListItem[];
  let legacyItems: BudgetItemListItem[];

  if (!internalItem) {
    unfilteredDriveItems = items.filter(
      (item) => !internalWrapperIds.has(item.id),
    );
    legacyItems = [];
  } else {
    const itemById = new Map(items.map((item) => [item.id, item]));
    const isLegacyDescendant = (item: BudgetItemListItem): boolean => {
      const visited = new Set<string>();
      let parentId = item.parentId;
      while (parentId !== null && !visited.has(parentId)) {
        if (parentId === internalItem.id) return true;
        visited.add(parentId);
        parentId = itemById.get(parentId)?.parentId ?? null;
      }
      return false;
    };
    const legacyOriginalItems = items.filter(
      (item) => !internalWrapperIds.has(item.id) && isLegacyDescendant(item),
    );
    const legacyIds = new Set(legacyOriginalItems.map((item) => item.id));
    unfilteredDriveItems = items.filter(
      (item) => !internalWrapperIds.has(item.id) && !legacyIds.has(item.id),
    );
    const breadcrumbOffset = internalItem.breadcrumb.length;
    const depthOffset = internalItem.depth + 1;
    legacyItems = legacyOriginalItems.map((item) => ({
      ...item,
      depth: Math.max(0, item.depth - depthOffset),
      breadcrumb:
        item.breadcrumb.slice(breadcrumbOffset).length > 0
          ? item.breadcrumb.slice(breadcrumbOffset)
          : [item.name],
      directParentName:
        item.parentId === internalItem.id
          ? LEGACY_UNCLASSIFIED_HEADING
          : item.directParentName,
    }));
  }

  const driveItems = pruneEmptyFixedTaxonomyNodes(
    unfilteredDriveItems,
    items,
  );
  return {
    driveItems,
    legacyItems,
    displayItems: [...driveItems, ...legacyItems],
  };
}

function collapseStorageKey(workspaceId: string): string {
  return "vowbook:budget-group-expansion:" + workspaceId;
}

function legacyCollapseStorageKey(workspaceId: string): string {
  return "vowbook:budget-stage-groups:" + workspaceId;
}

function budgetRowDomId(itemId: string): string {
  return "budget-item-row-" + encodeURIComponent(itemId);
}

function budgetRelatedExpensesDomId(itemId: string): string {
  return budgetRowDomId(itemId) + "-related-expenses";
}

function groupDirectChildRowIds(
  items: BudgetItemListItem[],
): Map<string, string> {
  const controlledRows = new Map<string, string>();

  items.forEach((item, itemIndex) => {
    if (item.kind !== "GROUP") {
      return;
    }

    const directChildIds: string[] = [];
    for (
      let descendantIndex = itemIndex + 1;
      descendantIndex < items.length &&
      items[descendantIndex].depth > item.depth;
      descendantIndex += 1
    ) {
      if (items[descendantIndex].depth === item.depth + 1) {
        directChildIds.push(budgetRowDomId(items[descendantIndex].id));
      }
    }
    if (directChildIds.length > 0) {
      controlledRows.set(item.id, directChildIds.join(" "));
    }
  });

  return controlledRows;
}

function countBudgetKinds(
  items: BudgetItemListItem[],
  isIncluded: (item: BudgetItemListItem, itemIndex: number) => boolean,
): BudgetKindCounts {
  return items.reduce<BudgetKindCounts>(
    (counts, item, itemIndex) => {
      if (!isIncluded(item, itemIndex)) {
        return counts;
      }
      if (item.kind === "EXPENSE") {
        counts.expenses += 1;
      } else {
        counts.groups += 1;
      }
      return counts;
    },
    { expenses: 0, groups: 0 },
  );
}

const STATUS_FILTERS: Array<{
  value: BudgetStatusFilter;
  label: string;
}> = [
  { value: "ALL", label: "全部" },
  { value: "PLANNING", label: "規劃中" },
  { value: "BOOKED_BALANCE_DUE", label: "已下訂" },
  { value: "PAID", label: "已付清" },
];

const STATUS_SCAN_LABELS: Record<BudgetItemListItem["bookingStatus"], string> =
  {
    PLANNING: "規劃中",
    BOOKED_BALANCE_DUE: "已下訂",
    PAID: "已付清",
  };

function paidAtLabel(value: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

/**
 * Notion 匯入把每一列都標成 EXPENSE（scripts/notion-budget-import.mjs），
 * 包含那些只是用來分層的節點。這種節點自己一毛錢都沒有，金額全部來自子項，
 * 畫成有價的一列就會讓同一筆錢在畫面上出現兩次。
 */
function isPassThroughSourceNode(item: BudgetItemListItem): boolean {
  return (
    item.kind === "EXPENSE" &&
    item.source === "NOTION" &&
    item.hasChildren &&
    item.plannedAmount === 0 &&
    item.actualAmount === null &&
    item.depositAmount === null &&
    item.balanceAmount === null &&
    item.additionalAmount === null
  );
}

function statusTagClass(status: BudgetItemListItem["bookingStatus"]): string {
  if (status === "PAID") {
    return "border-positive bg-positive-soft text-positive";
  }

  if (status === "BOOKED_BALANCE_DUE") {
    return "border-line-strong bg-clay-soft text-clay-strong";
  }

  return "border-line bg-surface-sunken text-ink-soft";
}

function BudgetSummaryAmount({ amount }: { amount: string }) {
  const formattedAmount = formatTwdAmount(amount);
  const currencyPrefix = "NT$";
  const digits = formattedAmount.slice(currencyPrefix.length);

  return (
    <span
      data-budget-summary-amount="true"
      className="inline-flex min-w-0 max-w-full items-baseline gap-x-1"
    >
      <span data-budget-summary-accessible-amount="true" className="sr-only">
        {formattedAmount}
      </span>
      <span
        aria-hidden="true"
        data-budget-summary-currency="true"
        className="shrink-0 text-xs font-medium tracking-[0.06em] text-ink-faint"
      >
        {currencyPrefix}
      </span>
      <span
        aria-hidden="true"
        data-budget-summary-digits="true"
        className="min-w-0 break-words font-sans text-[1.35rem] font-semibold tabular-nums tracking-[-0.02em] text-ink"
      >
        {digits}
      </span>
    </span>
  );
}

function BudgetSummaryView({
  summary,
  onShowAll,
  onShowPaid,
  onShowBalanceDue,
}: {
  summary: BudgetSummary;
  onShowAll: () => void;
  onShowPaid: () => void;
  onShowBalanceDue: () => void;
}) {
  return (
    <section aria-labelledby="budget-summary-heading" className="min-w-0">
      <h2 id="budget-summary-heading" className="sr-only">
        花費摘要
      </h2>
      {summary.itemCount === 0 ? (
        <div
          data-budget-empty-onboarding="true"
          className="border-y border-line-strong bg-clay-soft px-4 py-5 sm:px-6"
        >
          <p className="font-serif text-lg font-semibold text-ink">
            從第一筆自己的婚禮花費開始
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">
            籌備階段與品項分類已經準備好；新增花費時選擇品項，再填入自己的預計或實際金額即可。
          </p>
        </div>
      ) : null}
      <dl
        data-budget-summary-layout="responsive"
        data-mobile-layout="two-plus-one"
        data-desktop-layout="three-columns"
        className="grid min-w-0 grid-cols-2 overflow-hidden rounded-card border border-line bg-surface shadow-card sm:grid-cols-3"
      >
        <div
          data-budget-summary-cell="planned"
          className="min-w-0 border-r border-line px-3 py-2.5 sm:px-5 sm:py-4"
        >
          <dt className="text-xs text-ink-faint">預計總花費</dt>
          <dd className="mt-1 min-w-0">
            <BudgetSummaryAmount amount={summary.plannedTotal} />
            {summary.itemCount > 0 && (
              <button
                type="button"
                onClick={onShowAll}
                className="mt-1 block min-h-11 max-w-full break-words text-left text-xs font-semibold text-clay underline decoration-line-strong underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay"
              >
                查看全部 {summary.itemCount} 筆花費
              </button>
            )}
          </dd>
        </div>
        <div
          data-budget-summary-cell="actual"
          className="min-w-0 px-3 py-2.5 sm:px-5 sm:py-4"
        >
          <dt className="text-xs text-ink-faint">已記錄實付</dt>
          <dd className="mt-1 min-w-0">
            <BudgetSummaryAmount amount={summary.actualTotal} />
            <span
              data-budget-payment-progress="true"
              className="mt-1 block font-sans text-xs tabular-nums text-ink-faint"
            >
              已付款 {summary.paidCount} / {summary.itemCount} 筆花費
            </span>
            {summary.paidCount > 0 && (
              <button
                type="button"
                onClick={onShowPaid}
                className="mt-1 block min-h-11 max-w-full break-words text-left text-xs font-semibold text-clay underline decoration-line-strong underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay"
              >
                顯示已付清 {summary.paidCount} 筆花費
              </button>
            )}
          </dd>
        </div>
        <div
          data-budget-summary-cell="balance-due"
          className="col-span-2 min-w-0 border-t border-line px-3 py-2.5 sm:col-span-1 sm:border-t-0 sm:border-l sm:px-5 sm:py-4"
        >
          <dt className="text-xs text-ink-faint">待付尾款</dt>
          <dd className="mt-1 min-w-0">
            <BudgetSummaryAmount amount={summary.balanceDueTotal} />
            {summary.balanceDueCount === 0 ? (
              <span className="mt-1 block text-xs text-ink-faint">
                目前沒有待付尾款
              </span>
            ) : (
              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-faint">
                <span>共 {summary.balanceDueCount} 筆花費待付</span>
                {summary.nearestBalanceDueDate !== null && (
                  <time dateTime={summary.nearestBalanceDueDate}>
                    最近期限 {summary.nearestBalanceDueDate}
                  </time>
                )}
                {summary.balanceDueMissingAmountCount > 0 && (
                  <span>
                    {summary.balanceDueMissingAmountCount} 筆花費未填金額
                  </span>
                )}
              </span>
            )}
            {summary.balanceDueCount > 0 && (
              <button
                type="button"
                onClick={onShowBalanceDue}
                className="mt-1 block min-h-11 max-w-full break-words text-left text-xs font-semibold text-clay underline decoration-line-strong underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay"
              >
                顯示待付尾款 {summary.balanceDueCount} 筆花費
              </button>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function BudgetHierarchyGuide() {
  return (
    <details
      data-budget-hierarchy-guide="true"
      className="rounded-card border border-line bg-surface-sunken/60 px-4"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center py-3 text-sm font-semibold text-clay-strong outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
        籌備階段與品項分類怎麼用？
      </summary>
      <div className="space-y-3 border-t border-line py-4 text-sm leading-6 text-ink-soft">
        <p>
          分類依照文件整理為 6 個籌備階段與 20 個品項，使用方式是「籌備階段
          → 品項分類 → 實際花費」。固定階段與品項無法重新命名、移動或刪除。
        </p>
        <p>
          文件中的品牌、金額與數量只是範例，不會成為分類或預設花費；請填入自己的資料。如需整理廠商方案，仍可在品項分類下建立自訂群組。
        </p>
      </div>
    </details>
  );
}

function BudgetTaxonomyNavigator({
  stages,
  selectedItemId,
  expenseCountByGroupId,
  relatedExpenseCountByTaxonomyItemId,
  onSelect,
}: {
  stages: BudgetTaxonomyNavigationStage[];
  selectedItemId: string | null;
  expenseCountByGroupId: ReadonlyMap<string, number>;
  relatedExpenseCountByTaxonomyItemId: ReadonlyMap<string, number>;
  onSelect: (stageId: string, itemId: string) => void;
}) {
  return (
    <nav
      aria-label="花費分類導覽"
      data-budget-layout-panel="taxonomy"
      className="sticky top-6 max-h-[calc(100vh-3rem)] min-w-0 overflow-y-auto overscroll-contain border-r border-line pr-5"
    >
      <div className="border-b border-line pb-4">
        <p className="text-xs font-semibold tracking-[0.12em] text-clay-strong">
          花費分類
        </p>
        <h3 className="mt-1 font-serif text-lg font-semibold text-ink">
          籌備階段與品項分類
        </h3>
        <p className="mt-2 text-xs leading-5 text-ink-soft">
          依照 Drive 架構快速前往每個花費區段。
        </p>
      </div>
      <ul className="divide-y divide-line">
        {stages.map(({ stage, items }) => (
          <li key={stage.id} className="py-4">
            <div className="flex min-w-0 items-start gap-3">
              <CalendarBlank
                aria-hidden="true"
                size={20}
                weight="regular"
                className="mt-0.5 shrink-0 text-clay-strong"
              />
              <div className="min-w-0 flex-1">
                <p className="break-words font-serif text-base font-semibold text-ink">
                  {stage.name}
                </p>
                <p className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-xs text-ink-soft">
                  <span>{expenseCountByGroupId.get(stage.id) ?? 0} 筆花費</span>
                  <span className="font-sans tabular-nums text-ink-soft">
                    {formatTwdAmount(stage.rolledUpPlannedAmount)}
                  </span>
                </p>
              </div>
            </div>
            <ul className="mt-3 border-l border-line-strong pl-3">
              {items.map((item) => {
                const selected = selectedItemId === item.id;
                const expenseCount = expenseCountByGroupId.get(item.id) ?? 0;
                const relatedExpenseCount =
                  relatedExpenseCountByTaxonomyItemId.get(item.id) ?? 0;
                const countLabel =
                  `${expenseCount} 筆主分類花費` +
                  (relatedExpenseCount > 0
                    ? `，另有 ${relatedExpenseCount} 筆延伸`
                    : "");
                return (
                  <li key={item.id}>
                    <a
                      href={`#${budgetRowDomId(item.id)}`}
                      aria-label={`${item.name}，${countLabel}`}
                      aria-current={selected ? "location" : undefined}
                      onClick={(event) => {
                        event.preventDefault();
                        onSelect(stage.id, item.id);
                      }}
                      className={[
                        "-ml-px flex min-h-11 min-w-0 items-center justify-between gap-3 border-l-[3px] px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-inset",
                        selected
                          ? "border-clay-strong bg-surface-sunken font-semibold text-clay-strong"
                          : "border-transparent text-ink-soft hover:bg-surface hover:text-ink",
                      ].join(" ")}
                    >
                      <span className="min-w-0 break-words">{item.name}</span>
                      <span className="shrink-0 text-right font-sans text-xs tabular-nums text-ink-soft">
                        <span className="block">{expenseCount} 筆</span>
                        {relatedExpenseCount > 0 && (
                          <span className="block text-[0.65rem] text-clay">
                            +{relatedExpenseCount} 延伸
                          </span>
                        )}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function BudgetItemRow({
  workspaceId,
  item,
  moveTargets,
  canEdit,
  hierarchyCategory,
  hierarchyTaxonomyItemKey,
  onDeleteSuccess,
  onDissolveSuccess,
  visualDepth,
  rowId,
  groupExpanded,
  groupControlsIds,
  groupToggleDisabled,
  groupToggleDescriptionId,
  onToggleGroup,
  hasActiveFilter,
  relatedExpenses = [],
  onNavigateToRelatedExpense,
  isLegacyUnclassified = false,
  isContext = false,
  isHidden = false,
}: {
  workspaceId: string;
  item: BudgetItemListItem;
  moveTargets: BudgetMoveTarget[];
  canEdit: boolean;
  hierarchyCategory: BudgetCostCategory;
  hierarchyTaxonomyItemKey?: BudgetTaxonomyItemKey;
  onDeleteSuccess: () => void;
  onDissolveSuccess: (message: string) => void;
  visualDepth: number;
  rowId: string;
  groupExpanded: boolean;
  groupControlsIds: string | null;
  groupToggleDisabled: boolean;
  groupToggleDescriptionId?: string;
  onToggleGroup: () => void;
  hasActiveFilter: boolean;
  relatedExpenses?: RelatedBudgetExpense[];
  onNavigateToRelatedExpense: (expenseId: string) => void;
  isLegacyUnclassified?: boolean;
  isContext?: boolean;
  isHidden?: boolean;
}) {
  const dialogTitleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogTitleRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [statusPending, setStatusPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [childCreatePending, setChildCreatePending] = useState(false);
  const [groupMutationPending, setGroupMutationPending] = useState(false);
  const [movePending, setMovePending] = useState(false);
  const [dissolvePending, setDissolvePending] = useState(false);
  const [attachmentPending, setAttachmentPending] = useState(false);
  const managePending =
    statusPending ||
    deletePending ||
    childCreatePending ||
    groupMutationPending ||
    movePending ||
    dissolvePending ||
    attachmentPending;
  const sourceBreadcrumb = item.breadcrumb ?? [item.name];
  const breadcrumb = [...sourceBreadcrumb.slice(0, -1), item.name];
  const directChildren = item.directChildren ?? [];
  const directChildCount = item.directChildCount ?? directChildren.length;
  const descendantCount = item.descendantCount ?? 0;
  const isGroup = item.kind === "GROUP";
  const systemTaxonomyKey = systemTaxonomyKeyOf(item);
  const isFixedStage =
    isGroup &&
    typeof systemTaxonomyKey === "string" &&
    BUDGET_TAXONOMY_STAGE_KEY_SET.has(systemTaxonomyKey);
  const isFixedItem = isGroup && isTaxonomyItemKey(systemTaxonomyKey);
  const isFixedGroup = isFixedStage || isFixedItem;
  const isSourceGroupHeading = isGroup && !isFixedGroup;
  const isPassThrough = isPassThroughSourceNode(item);
  const suggestionKey = suggestionKeyOf(item);
  const isPendingPreparationSuggestion =
    !isGroup &&
    item.bookingStatus === "PLANNING" &&
    typeof suggestionKey === "string" &&
    suggestionKey.startsWith("PREPARATION_");
  const hierarchyLevel = isFixedStage
    ? "parent"
    : isFixedItem
      ? "child"
      : undefined;
  const hierarchyGroupLabel = isFixedStage
    ? "籌備階段"
    : isFixedItem
      ? "品項分類"
      : "群組";
  const RowHeading =
    visualDepth <= 0
      ? "h3"
      : visualDepth === 1
        ? "h4"
        : visualDepth === 2
          ? "h5"
          : "h6";
  /*
    visualDepth 原本只拿來決定標題階層，畫面上看不出父子關係。
    一般花費列在「階段 › 品項分類」底下是第 2 層，再深就是子項，往右縮排。
  */
  const nestedDepth = Math.min(Math.max(visualDepth - 2, 0), 3);
  const attachmentSourceKey = (item.attachments ?? [])
    .map((attachment) => attachment.id)
    .join(",");
  const initialAttachmentCount = item.attachments?.length ?? 0;
  const [localAttachmentCount, setLocalAttachmentCount] = useState({
    sourceKey: attachmentSourceKey,
    count: initialAttachmentCount,
  });
  const attachmentCount =
    localAttachmentCount.sourceKey === attachmentSourceKey
      ? localAttachmentCount.count
      : initialAttachmentCount;
  const updateAttachmentCount = useCallback(
    (count: number) => {
      setLocalAttachmentCount({ sourceKey: attachmentSourceKey, count });
    },
    [attachmentSourceKey],
  );
  const taxonomyItemLabel =
    taxonomyNodeLabel(hierarchyTaxonomyItemKey) ?? "待重新分類";
  const relatedTaxonomyItemLabel = taxonomyNodeLabel(
    item.relatedTaxonomyItemKey,
  );
  const notionSourceHierarchyPath = notionSourceHierarchyPathOf(item);
  const notionSourceHierarchyPathLabel = notionSourceHierarchyPath.join(" › ");
  /*
    來源路徑在「明細與附件」面板裡本來就有一份。
    只有當這一列的樹狀位置和來源不一致時（關聯費用、拍攝延伸，
    或直接上層名稱對不上來源路徑的倒數第二段），列上那份才有資訊量。
  */
  const sourcePathMatchesTreePosition =
    notionSourceHierarchyPath.length >= 2 &&
    notionSourceHierarchyPath[notionSourceHierarchyPath.length - 2] ===
      item.directParentName;
  const isPhotographyExtension =
    item.relatedTaxonomyItemKey === "ITEM_PRE_WEDDING_PHOTOGRAPHY";
  const relatedPlannedTotal = relatedExpenses
    .reduce((total, relatedExpense) => total + BigInt(relatedExpense.plannedAmount), BigInt(0))
    .toString();
  const needsReclassification =
    isLegacyUnclassified || hierarchyTaxonomyItemKey === undefined;
  const disclosureLabel = isGroup
    ? canEdit
      ? "管理" + hierarchyGroupLabel
      : "查看" + hierarchyGroupLabel + "詳情"
    : canEdit
      ? "開啟花費明細與附件"
      : "查看花費明細與附件";
  const disclosureText = isGroup
    ? canEdit
      ? "管理"
      : "詳細"
    : canEdit
      ? "明細與附件"
      : "詳細與附件";
  // 「· 0」在每一列都印一次，等於用數字宣告「什麼都沒有」。
  const disclosureActionText =
    isGroup || attachmentCount === 0
      ? disclosureText
      : disclosureText + " · " + attachmentCount;
  const attachmentDescriptionId = rowId + "-attachment-count";
  const attachmentDescription =
    attachmentCount === 0 ? "尚無附件" : `附件 ${attachmentCount} 份`;
  const [childCreateNotice, setChildCreateNotice] = useState<string | null>(
    null,
  );
  const restoreDialogFocus = useCallback(() => {
    const trigger = triggerRef.current;
    if (trigger?.isConnected && trigger.closest("[hidden]") === null) {
      trigger.focus();
      return;
    }
    document.getElementById("budget-items-heading")?.focus();
  }, []);

  useEffect(() => {
    if (isHidden && dialogRef.current?.open) {
      dialogRef.current.close();
    }
  }, [isHidden]);

  useEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      if (dialog?.open) {
        document.getElementById("budget-items-heading")?.focus();
      }
    };
  }, []);

  const richDetails: Array<[string, string]> = [];

  if (item.estimatedRange) {
    richDetails.push(["預估費用範圍", item.estimatedRange]);
  }
  if (item.candidateVendors) {
    richDetails.push(["候選廠商或工作人員", item.candidateVendors]);
  }
  if (item.confirmedVendor) {
    richDetails.push(["確定廠商", item.confirmedVendor]);
  }
  if (item.vendorContact) {
    richDetails.push(["廠商聯絡人", item.vendorContact]);
  }
  if (item.primaryContact) {
    richDetails.push([
      "主要負責人",
      BUDGET_PRIMARY_CONTACT_LABELS[item.primaryContact],
    ]);
  }

  if (relatedTaxonomyItemLabel) {
    richDetails.push(["用途關聯", relatedTaxonomyItemLabel]);
  }
  if (notionSourceHierarchyPathLabel) {
    richDetails.push(["Notion 原始路徑", notionSourceHierarchyPathLabel]);
  }
  /*
    預計總價／實付／訂金／尾款四個數字一律同一個範圍。
    之前只有預計總價含子項，其餘三個算本項，結果「預計 25,800、實付尚未記錄」
    這種列會讓人以為一毛沒付，其實子項已經付掉一部分。
  */
  /*
    分類名稱通常就是正上方那一列的品項分類標題，重複印一次只是雜訊。
    但「關聯費用／拍攝延伸」會被搬到別的分類底下顯示，那時祖先標題不在畫面上，
    分類小標是唯一的線索，必須留著。
  */
  const categoryEyebrowIsRedundant =
    !needsReclassification &&
    !relatedTaxonomyItemLabel &&
    breadcrumb.includes(taxonomyItemLabel);
  const amountsIncludeChildren = isGroup || item.hasChildren;
  const scanPlannedLabel = isGroup
    ? hierarchyGroupLabel + "預計花費"
    : amountsIncludeChildren
      ? "含子項預計花費"
      : "本項預計花費";
  const scanPlannedAmount = formatTwdAmount(
    amountsIncludeChildren ? item.rolledUpPlannedAmount : item.plannedAmount,
  );
  const scanActualLabel = amountsIncludeChildren ? "含子項實付" : "本項實付";
  const scanActualAmount = amountsIncludeChildren
    ? !(item.rolledUpActualAmountRecorded ?? item.rolledUpActualAmount !== "0")
      ? "尚未記錄"
      : formatTwdAmount(item.rolledUpActualAmount)
    : item.actualAmount === null
      ? "尚未記錄"
      : formatTwdAmount(item.actualAmount);
  const ledgerBrand = item.confirmedVendor ?? item.candidateVendors;
  const ledgerDepositAmount = amountsIncludeChildren
    ? !(item.rolledUpDepositAmountRecorded ?? item.rolledUpDepositAmount !== "0")
      ? "—"
      : formatTwdAmount(item.rolledUpDepositAmount)
    : item.depositAmount !== null
      ? formatTwdAmount(item.depositAmount)
      : "—";
  const ledgerBalanceAmount = amountsIncludeChildren
    ? !(item.rolledUpBalanceAmountRecorded ?? item.rolledUpBalanceAmount !== "0")
      ? "—"
      : formatTwdAmount(item.rolledUpBalanceAmount)
    : item.balanceAmount !== null
      ? formatTwdAmount(item.balanceAmount)
      : "—";
  const rollupScopeDescriptionId = rowId + "-rollup-scope";

  const groupToggle = isGroup && groupControlsIds !== null ? (
    <button
      type="button"
      aria-expanded={groupExpanded}
      aria-controls={groupControlsIds}
      aria-describedby={groupToggleDescriptionId}
      aria-label={
        (groupExpanded ? "收合" : "展開") +
        hierarchyGroupLabel +
        "：" +
        item.name
      }
      disabled={groupToggleDisabled}
      onClick={onToggleGroup}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-surface text-clay-strong transition hover:border-line-strong hover:bg-clay-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 motion-reduce:transition-none disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-surface-sunken disabled:text-ink-faint"
    >
      <CaretDown
        aria-hidden="true"
        size={18}
        weight="bold"
        className={[
          "transition-transform motion-reduce:transition-none",
          groupExpanded ? "rotate-180" : "",
        ].join(" ")}
      />
    </button>
  ) : null;

  const disclosureButton = (
    <button
      ref={triggerRef}
      type="button"
      data-budget-disclosure-hint="true"
      data-budget-attachment-affordance={!isGroup ? "true" : undefined}
      aria-label={disclosureLabel + "：" + item.name}
      aria-describedby={!isGroup ? attachmentDescriptionId : undefined}
      onClick={() => {
        dialogRef.current?.showModal();
        dialogTitleRef.current?.focus();
      }}
      className="inline-flex min-h-11 min-w-11 max-w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold leading-4 text-clay underline decoration-line-strong underline-offset-4 transition hover:border-line-strong hover:bg-clay-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2"
    >
      <Eye aria-hidden="true" size={17} weight="regular" />
      <span className="min-w-0 whitespace-normal break-words">
        {disclosureActionText}
      </span>
    </button>
  );

  return (
    <li
      id={rowId}
      className="min-w-0"
      hidden={isHidden}
    >
      <article
        tabIndex={-1}
        hidden={isHidden}
        data-budget-item-id={item.id}
        data-budget-depth={visualDepth}
        data-budget-item-kind={item.kind}
        data-budget-taxonomy-kind={
          isFixedStage ? "stage" : isFixedItem ? "item" : undefined
        }
        data-budget-hierarchy-level={hierarchyLevel}
        data-budget-context={isContext ? "true" : undefined}
        data-budget-preparation-status={
          isPendingPreparationSuggestion ? "pending" : undefined
        }
        data-budget-row-kind={isGroup ? "group" : "item"}
        data-budget-ledger-row={isGroup ? "group" : "leaf"}
        data-budget-branch={visualDepth > 0 ? "nested" : "root"}
        data-budget-browse-view="group"
        className="min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-inset"
      >
        <div
          data-budget-ledger-surface={
            isFixedStage
              ? "stage-chapter"
              : isFixedItem
                ? "taxonomy-child"
                : isGroup
                  ? "group-band"
                  : "leaf-line"
          }
          data-budget-scan-alignment="shared"
          data-budget-row-layout="hierarchy-ledger"
          className="relative min-w-0 transition-colors motion-reduce:transition-none"
        >
          {isFixedStage ? (
            <div
              data-budget-scan-layout="stage-header"
              className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-y border-line-strong bg-clay-soft px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:px-4"
            >
              <span data-budget-mobile-row="primary">{groupToggle}</span>
              <div data-budget-mobile-row="primary" className="min-w-0">
                <span
                  data-budget-ledger-column="item-level"
                  className="text-[0.68rem] font-semibold tracking-[0.12em] text-clay"
                >
                  籌備階段
                </span>
                <RowHeading className="mt-0.5 break-words font-serif text-xl font-semibold leading-7 text-ink">
                  {item.name}
                </RowHeading>
                <p className="mt-1 text-xs text-ink-soft">
                  {directChildCount} 個品項分類 · 共 {descendantCount} 個下層項目
                </p>
              </div>
              <p
                data-budget-mobile-row="amounts"
                className="col-span-2 flex min-w-0 items-baseline justify-between gap-3 border-t border-line pt-2 text-xs text-ink-soft sm:col-span-1 sm:border-t-0 sm:pt-0 sm:text-right"
              >
                <span>階段小計</span>
                <span
                  role="group"
                  aria-label={scanPlannedLabel + "：" + scanPlannedAmount}
                  className="shrink-0 font-sans text-base font-semibold tabular-nums text-ink"
                >
                  {scanPlannedAmount}
                </span>
              </p>
              <span
                data-budget-mobile-row="action"
                className="col-span-2 justify-self-end sm:col-span-1"
              >
                {disclosureButton}
              </span>
            </div>
          ) : isFixedItem ? (
            <div
              data-budget-scan-layout="taxonomy-header"
              className="grid min-w-0 grid-cols-1 items-center gap-x-5 gap-y-2 border-b border-line border-l-[3px] border-l-clay bg-surface px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.72fr)_minmax(9rem,auto)]"
            >
              {/* 三個欄位軌道與花費列一致，品項小計才會和下面的預計總價對齊。 */}
              <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                data-budget-hierarchy-connector="true"
                className="h-full min-h-11 w-px shrink-0 border-l border-line-strong"
              />
              <span data-budget-mobile-row="primary" className="shrink-0">{groupToggle}</span>
              <div data-budget-mobile-row="primary" className="min-w-0">
                <p className="hidden text-xs text-ink-soft xl:block">
                  {item.directParentName ? `${item.directParentName} ›` : "品項分類"}
                </p>
                <span
                  data-budget-ledger-column="item-level"
                  className="text-[0.68rem] font-semibold tracking-[0.12em] text-clay xl:hidden"
                >
                  品項分類
                </span>
                <RowHeading className="mt-0.5 break-words font-serif text-lg font-semibold leading-6 text-ink sm:text-xl xl:text-2xl xl:leading-8">
                  {item.name}
                </RowHeading>
                <p className="mt-1 text-xs text-ink-soft">
                  {directChildCount} 個直接項目 · 共 {descendantCount} 個下層項目
                </p>
              </div>
              </div>
              <p
                data-budget-mobile-row="amounts"
                className="flex min-w-0 items-baseline justify-between gap-3 border-t border-line pt-2 text-xs text-ink-soft md:block md:border-t-0 md:pt-0"
              >
                <span className="md:block">品項小計</span>
                <span
                  role="group"
                  aria-label={scanPlannedLabel + "：" + scanPlannedAmount}
                  className="shrink-0 font-sans text-base font-semibold tabular-nums text-ink md:mt-0.5 md:block md:text-lg"
                >
                  {scanPlannedAmount}
                </span>
              </p>
              <span
                data-budget-mobile-row="action"
                className="justify-self-end md:justify-self-start"
              >
                {disclosureButton}
              </span>
            </div>
          ) : isSourceGroupHeading ? (
            <div
              data-budget-scan-layout="source-group-header"
              className="mx-3 my-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-y border-line bg-clay-soft px-3 py-3 sm:mx-5 sm:px-4"
            >
              <span data-budget-mobile-row="primary">{groupToggle}</span>
              <div
                data-budget-mobile-row="primary"
                data-budget-ledger-content-name="true"
                className="min-w-0"
              >
                <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.68rem] font-semibold tracking-[0.1em] text-clay">
                  <span data-budget-ledger-column="item-level">來源群組</span>
                  <span aria-hidden="true" className="text-line-strong">/</span>
                  <span className="tracking-normal text-ink-soft">非計價標題</span>
                </p>
                <RowHeading className="mt-1 break-words font-serif text-base font-semibold leading-6 text-ink sm:text-lg">
                  {item.name}
                </RowHeading>
                <p
                  data-budget-mobile-row="metadata"
                  className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 break-words text-xs leading-5 text-ink-soft"
                >
                  <span
                    data-budget-hierarchy-breadcrumb="true"
                    className="min-w-0 break-words"
                  >
                    {breadcrumb.join(" › ")}
                  </span>
                  <span>{directChildCount} 個直接項目</span>
                  <span data-budget-descendant-count={descendantCount}>
                    共 {descendantCount} 個下層項目
                  </span>
                  {notionSourceHierarchyPathLabel && (
                    <span data-budget-notion-source-path="true">
                      Notion 原始路徑：{notionSourceHierarchyPathLabel}
                    </span>
                  )}
                  {isContext && <span>上層脈絡</span>}
                </p>
              </div>
              <span data-budget-mobile-row="action">{disclosureButton}</span>
            </div>
          ) : (
            <div
              data-budget-scan-layout="expense-row"
              data-budget-nested-level={nestedDepth > 0 ? nestedDepth : undefined}
              style={
                nestedDepth > 0
                  ? ({ "--budget-indent": nestedDepth * 1.25 + "rem" } as CSSProperties)
                  : undefined
              }
              className={
                "grid min-w-0 grid-cols-1 gap-3 border-b border-line border-l-[3px] bg-white py-4 pr-4 pl-[calc(1rem+var(--budget-indent,0px))] hover:bg-surface md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.72fr)_minmax(9rem,auto)] md:items-center md:gap-5" +
                (nestedDepth > 0
                  ? " border-l-line-strong"
                  : " border-l-transparent")
              }
            >
              <div
                data-budget-mobile-row="primary"
                data-budget-ledger-content-name="true"
                className="min-w-0"
              >
                {categoryEyebrowIsRedundant ? null : (
                  <p
                    data-budget-ledger-primary-category="true"
                    className="text-[0.68rem] font-semibold tracking-[0.08em] text-clay"
                  >
                    {needsReclassification ? "待重新分類" : taxonomyItemLabel}
                  </p>
                )}
                <RowHeading className="mt-1 break-words font-serif text-lg font-semibold leading-6 text-ink">
                  {item.name}
                </RowHeading>
                <p
                  data-budget-ledger-column="brand"
                  className="mt-1 min-w-0 whitespace-pre-wrap break-words text-xs leading-5 text-ink-soft"
                >
                  {ledgerBrand ? `廠商：${ledgerBrand}` : "尚未設定廠商"}
                </p>
                <p
                  data-budget-mobile-row="metadata"
                  className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 break-words text-xs leading-5 text-ink-soft"
                >
                  <span data-budget-hierarchy-breadcrumb="true" className="sr-only">
                    {breadcrumb.join(" › ")}
                  </span>
                  <span data-budget-category-label="true" className="sr-only">
                    {needsReclassification
                      ? "分類狀態：待重新分類"
                      : `品項分類：${taxonomyItemLabel}`}
                  </span>
                  {relatedTaxonomyItemLabel && (
                    <>
                      <span
                        data-budget-relation-badge="true"
                        className="inline-flex w-fit shrink-0 rounded-full border border-line-strong bg-surface px-2 py-0.5 font-semibold text-clay-strong"
                      >
                        {isPhotographyExtension ? "拍攝延伸" : "關聯費用"}
                      </span>
                      <span
                        data-budget-related-purpose="true"
                        className="font-medium text-clay-strong"
                      >
                        用途：{relatedTaxonomyItemLabel}
                      </span>
                    </>
                  )}
                  {notionSourceHierarchyPathLabel &&
                    !sourcePathMatchesTreePosition && (
                      <span
                        data-budget-notion-source-path="true"
                        className="min-w-0 break-words"
                      >
                        Notion 原始路徑：{notionSourceHierarchyPathLabel}
                      </span>
                    )}
                  {item.hasChildren && (
                    <span
                      data-budget-rollup-marker="true"
                    >
                      <span>{directChildCount} 個直接項目</span>
                      <span aria-hidden="true"> · </span>
                      <span data-budget-descendant-count={descendantCount}>
                        共 {descendantCount} 個下層項目
                      </span>
                    </span>
                  )}
                  {isContext && (
                    <span className="rounded-full border border-line-strong bg-surface-sunken px-2 py-0.5 font-semibold text-ink-soft">
                      上層脈絡
                    </span>
                  )}
                </p>
                {(item.notes || item.additionalAmount !== null) && (
                  <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-ink-soft">
                    {item.notes ? `備註：${item.notes}` : null}
                    {item.notes && item.additionalAmount !== null ? " · " : null}
                    {item.additionalAmount !== null
                      ? `追加：${formatTwdAmount(item.additionalAmount)}`
                      : null}
                  </p>
                )}
              </div>

              {isPassThrough ? (
                <p
                  data-budget-mobile-row="amounts"
                  data-budget-pass-through="true"
                  className="min-w-0 border-y border-line py-3 text-xs leading-5 text-ink-faint md:border-y-0 md:border-l md:border-line md:py-0 md:pl-5"
                >
                  來源分層，金額都記在下層項目
                </p>
              ) : (
              <dl
                data-budget-mobile-row="amounts"
                className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 border-y border-line py-3 md:border-y-0 md:border-l md:border-line md:py-0 md:pl-5"
              >
                {amountsIncludeChildren && (
                  <div
                    data-budget-amount-scope="rolled-up"
                    className="col-span-2 flex flex-wrap items-center gap-x-2 gap-y-1"
                  >
                    <span className="inline-flex rounded-full border border-clay/30 bg-clay-soft px-2 py-0.5 text-eyebrow font-semibold text-clay-strong">
                      含子項
                    </span>
                  </div>
                )}
                <div data-budget-ledger-column="total" className="col-span-2">
                  <dt className="text-xs text-ink-soft">預計總價</dt>
                  <dd className="mt-0.5 font-sans text-lg font-semibold tabular-nums text-ink">
                    <span
                      role="group"
                      aria-label={scanPlannedLabel + "：" + scanPlannedAmount}
                      aria-describedby={
                        amountsIncludeChildren && hasActiveFilter
                          ? rollupScopeDescriptionId
                          : undefined
                      }
                    >
                      {scanPlannedAmount}
                    </span>

                  </dd>
                  {amountsIncludeChildren && hasActiveFilter && (
                    <p
                      id={rollupScopeDescriptionId}
                      className="mt-1 text-[0.68rem] leading-4 text-ink-soft"
                    >
                      包含完整下層，即使部分項目因篩選未顯示
                    </p>
                  )}
                </div>
                <div>
                  <dt className="text-xs text-ink-soft">實付</dt>
                  <dd className="mt-0.5 font-sans text-sm font-semibold tabular-nums text-ink">
                    <span
                      role="group"
                      aria-label={scanActualLabel + "：" + scanActualAmount}
                    >
                      {scanActualAmount}
                    </span>

                  </dd>
                </div>
                <div data-budget-ledger-column="deposit">
                  <dt className="text-xs text-ink-soft">訂金</dt>
                  <dd className="mt-0.5 font-sans text-sm font-medium tabular-nums text-ink-soft">
                    {ledgerDepositAmount}
                  </dd>
                </div>
                <div data-budget-ledger-column="balance">
                  <dt className="text-xs text-ink-soft">尾款</dt>
                  <dd className="mt-0.5 font-sans text-sm font-medium tabular-nums text-ink-soft">
                    {ledgerBalanceAmount}
                  </dd>
                </div>
              </dl>
              )}

              <span
                data-budget-mobile-row="action"
                className="flex min-w-0 flex-row flex-wrap items-center justify-between gap-2 md:flex-col md:items-end md:justify-center"
              >
                <span
                  className={[
                    "inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold",
                    isPendingPreparationSuggestion
                      ? "border-positive bg-positive-soft text-positive"
                      : statusTagClass(item.bookingStatus),
                  ].join(" ")}
                >
                  <span aria-hidden="true">
                    {isPendingPreparationSuggestion
                      ? "待準備"
                      : STATUS_SCAN_LABELS[item.bookingStatus]}
                  </span>
                  <span className="sr-only">
                    {isPendingPreparationSuggestion
                      ? "常見婚禮項目待準備，目前狀態為規劃中"
                      : BUDGET_BOOKING_STATUS_LABELS[item.bookingStatus]}
                  </span>
                </span>
                {/* 期限跟狀態是同一組資訊，貼著徽章走；沒設期限就不佔一行。 */}
                {item.dueDate ? (
                  <span
                    data-budget-ledger-column="due-date"
                    className="text-xs text-ink-soft md:-mt-1"
                  >
                    <time dateTime={item.dueDate}>期限 {item.dueDate}</time>
                  </span>
                ) : null}
                <span id={attachmentDescriptionId} className="sr-only">
                  {attachmentDescription}
                </span>
                {disclosureButton}
              </span>
            </div>
          )}
        </div>

        {isFixedItem && relatedExpenses.length > 0 && (
          <section
            hidden={!groupExpanded}
            id={budgetRelatedExpensesDomId(item.id)}
            aria-label={`${item.name}的關聯延伸費用`}
            data-budget-related-expenses={systemTaxonomyKey}
            data-budget-related-accounting="reference-only"
            className="mx-3 mb-3 border-y border-line bg-surface sm:mx-5"
          >
            <div className="border-b border-line bg-clay-soft px-4 py-3 lg:grid lg:grid-cols-[32%_minmax(0,1fr)] lg:items-center">
              <h5 className="text-sm font-semibold text-clay-strong">
                關聯延伸費用 · {relatedExpenses.length} 筆
              </h5>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-ink-soft lg:mt-0">
                下列費用保留原本主分類，只在此顯示拍攝用途；不計入本分類小計，總額只計一次。
              </p>
            </div>
            <ul>
              {relatedExpenses.map((relatedExpense) => (
                <li
                  key={relatedExpense.id}
                  className="flex min-w-0 flex-col gap-1 border-t border-line px-4 py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0">
                    <a
                      href={`#${budgetRowDomId(relatedExpense.id)}`}
                      aria-label={`前往原始花費：${relatedExpense.name}`}
                      onClick={(event) => {
                        event.preventDefault();
                        onNavigateToRelatedExpense(relatedExpense.id);
                      }}
                      className="inline-flex min-h-11 max-w-full items-center break-words font-semibold text-clay-strong underline decoration-line-strong underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay"
                    >
                      {relatedExpense.name}
                    </a>
                    <p
                      data-budget-related-classification="true"
                      className="break-words text-xs text-ink-soft"
                    >
                      歸屬：{relatedExpense.primaryTaxonomyItemLabel}；用途：{item.name}
                    </p>
                    {relatedExpense.sourceHierarchyPath.length > 0 && (
                      <p
                        data-budget-related-notion-source-path="true"
                        className="break-words text-xs leading-5 text-ink-soft"
                      >
                        Notion 原始路徑：
                        {relatedExpense.sourceHierarchyPath.join(" › ")}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                    預計 {formatTwdAmount(relatedExpense.plannedAmount)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 border-t border-line bg-surface px-4 py-3 text-xs font-semibold text-ink-soft">
              <span>關聯預計費用小計（不計入本分類）</span>
              <span className="text-sm tabular-nums text-ink">
                {formatTwdAmount(relatedPlannedTotal)}
              </span>
            </p>
          </section>
        )}

        <dialog
          ref={dialogRef}
          aria-labelledby={dialogTitleId}
          onKeyDown={(event) => containDialogFocus(event, event.currentTarget)}
          onCancel={(event) => {
            if (managePending) event.preventDefault();
          }}
          onClose={restoreDialogFocus}
          className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-0 text-left text-ink shadow-[0_12px_32px_rgba(69,49,38,0.16)] backdrop:bg-ink/35 backdrop:backdrop-blur-[1px]"
        >
          <header className="sticky top-0 z-20 flex min-w-0 items-start justify-between gap-4 border-b border-line bg-surface px-5 py-5 sm:px-7">
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-[0.14em] text-clay-strong">
                {isFixedStage
                  ? "籌備階段"
                  : isFixedItem
                    ? "品項分類"
                    : isGroup
                      ? canEdit
                        ? "管理群組"
                        : "群組完整資料"
                      : canEdit
                        ? "管理花費項目"
                        : "花費完整資料"}
              </p>
              <h2
                id={dialogTitleId}
                ref={dialogTitleRef}
                tabIndex={-1}
                className="mt-1 break-words font-serif text-2xl font-semibold text-ink"
              >
                {item.name}
              </h2>
              <nav
                aria-label={
                  isGroup ? hierarchyGroupLabel + "層級路徑" : "花費層級路徑"
                }
                className="mt-2 min-w-0 break-words text-sm leading-6 text-ink-soft"
              >
                {breadcrumb.map((name, index) => (
                  <span key={`${index}-${name}`}>
                    {index > 0 ? " › " : ""}
                    {name}
                  </span>
                ))}
              </nav>
              <p className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 break-words text-xs text-ink-faint">
                <span>第 {item.depth + 1} 層</span>
                <span>直接上層：{item.directParentName ?? "無（最上層）"}</span>
                <span>直接子項 {directChildCount} 項</span>
                <span>全部下層 {descendantCount} 項</span>
              </p>
            </div>
            <button
              type="button"
              aria-label={`關閉${canEdit ? "管理" : "詳細"}：${item.name}`}
              disabled={managePending}
              onClick={() => dialogRef.current?.close()}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-line text-2xl leading-none text-ink-soft transition hover:bg-clay-soft disabled:cursor-wait disabled:opacity-50"
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>

          <section
            aria-label={`${item.name} ${
              isGroup
                ? hierarchyGroupLabel + "完整資料"
                : "花費完整資料"
            }`}
            aria-busy={managePending}
            inert={managePending ? true : undefined}
            className="min-w-0 bg-surface/70 px-5 py-6 sm:px-7"
          >
            <p
              className={[
                "inline-flex rounded-full border border-line-strong bg-clay-soft px-3 py-1 text-xs font-semibold text-clay",
                isGroup ? "mb-5" : "",
              ].join(" ")}
            >
              {isFixedStage
                ? "固定籌備階段"
                : isFixedItem
                  ? "固定品項分類"
                  : isGroup
                    ? "群組"
                    : needsReclassification
                      ? "分類狀態：待重新分類"
                      : `品項分類：${taxonomyItemLabel}`}
            </p>

            {!isGroup && (
              <BudgetAttachments
                key={`${item.id}:${(item.attachments ?? [])
                  .map((attachment) => attachment.id)
                  .join(",")}`}
                workspaceId={workspaceId}
                budgetItemId={item.id}
                initialAttachments={item.attachments ?? []}
                canEdit={canEdit}
                onPendingChange={setAttachmentPending}
                onAttachmentCountChange={updateAttachmentCount}
              />
            )}

            {directChildren.length > 0 && (
              <section
                aria-labelledby={`${dialogTitleId}-children`}
                className="mt-5 border-y border-line py-4"
              >
                <h3
                  id={`${dialogTitleId}-children`}
                  className="text-sm font-semibold text-ink"
                >
                  直接子項
                </h3>
                <ul className="mt-2 space-y-2 text-sm text-ink">
                  {directChildren.map((child) => (
                    <li key={child.id} className="flex flex-wrap gap-x-2">
                      <span className="break-words">{child.name}</span>
                      {child.hasChildren && (
                        <span className="font-semibold text-clay">
                          還有下一層
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {isSourceGroupHeading ? (
              <div
                data-budget-non-priced-heading="true"
                className="border-y border-line-strong bg-clay-soft px-4 py-4"
              >
                <p className="text-xs font-semibold tracking-[0.08em] text-clay-strong">
                  來源群組 · 非計價標題
                </p>
                <p className="mt-2 text-sm leading-6 text-ink-soft">
                  此來源群組是非計價標題；金額只記錄在下層花費。
                </p>
              </div>
            ) : isGroup ? (
              <dl className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-xs tracking-[0.08em] text-ink-soft">
                    群組預計花費
                  </dt>
                  <dd className="mt-1 break-words font-semibold text-ink">
                    {formatTwdAmount(item.rolledUpPlannedAmount)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs tracking-[0.08em] text-ink-soft">
                    群組已記錄實付
                  </dt>
                  <dd className="mt-1 break-words font-semibold text-ink">
                    {formatTwdAmount(item.rolledUpActualAmount)}
                  </dd>
                </div>
              </dl>
            ) : (
              <>
                <dl className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="min-w-0">
                    <dt className="text-xs tracking-[0.08em] text-ink-soft">
                      本項直接費用
                    </dt>
                    <dd className="mt-1 break-words font-semibold text-ink">
                      {formatTwdAmount(item.plannedAmount)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs tracking-[0.08em] text-ink-soft">
                      本項直接實付
                    </dt>
                    <dd className="mt-1 break-words font-semibold text-ink">
                      {item.actualAmount === null
                        ? "尚未記錄"
                        : formatTwdAmount(item.actualAmount)}
                    </dd>
                  </div>
                  {item.hasChildren && (
                    <>
                      <div className="min-w-0">
                        <dt className="text-xs tracking-[0.08em] text-ink-soft">
                          含子項總計
                        </dt>
                        <dd className="mt-1 break-words font-semibold text-ink">
                          {formatTwdAmount(item.rolledUpPlannedAmount)}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-xs tracking-[0.08em] text-ink-soft">
                          含子項實付
                        </dt>
                        <dd className="mt-1 break-words font-semibold text-ink">
                          {formatTwdAmount(item.rolledUpActualAmount)}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>

                <dl className="mt-5 grid min-w-0 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="min-w-0">
                    <dt className="text-xs tracking-[0.08em] text-ink-soft">
                      付款期限
                    </dt>
                    <dd className="mt-1 break-words text-sm text-ink-soft">
                      {item.dueDate ? (
                        <time dateTime={item.dueDate}>{item.dueDate}</time>
                      ) : (
                        "未設定"
                      )}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs tracking-[0.08em] text-ink-soft">
                      付款時間
                    </dt>
                    <dd className="mt-1 break-words text-sm text-ink-soft">
                      {item.paidAt ? (
                        <time dateTime={item.paidAt}>
                          付款於 {paidAtLabel(item.paidAt)}
                        </time>
                      ) : item.bookingStatus === "PAID" ? (
                        "付款時間未記錄"
                      ) : (
                        "尚未付款"
                      )}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs tracking-[0.08em] text-ink-soft">
                      訂金
                    </dt>
                    <dd className="mt-1 break-words text-sm text-ink-soft">
                      {item.depositAmount === null
                        ? "未記錄"
                        : formatTwdAmount(item.depositAmount)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs tracking-[0.08em] text-ink-soft">
                      尾款
                    </dt>
                    <dd className="mt-1 break-words text-sm text-ink-soft">
                      {item.balanceAmount === null
                        ? "未記錄"
                        : formatTwdAmount(item.balanceAmount)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs tracking-[0.08em] text-ink-soft">
                      加購
                    </dt>
                    <dd className="mt-1 break-words text-sm text-ink-soft">
                      {item.additionalAmount === null
                        ? "未記錄"
                        : formatTwdAmount(item.additionalAmount)}
                    </dd>
                  </div>
                </dl>

                {richDetails.length > 0 && (
                  <dl className="mt-5 grid min-w-0 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-2">
                    {richDetails.map(([label, value]) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-xs tracking-[0.08em] text-ink-soft">
                          {label}
                        </dt>
                        <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-ink-soft">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </>
            )}

            {item.notes && (
              <div className="mt-5 min-w-0 border-t border-line pt-5">
                <p className="text-xs tracking-[0.08em] text-ink-soft">備註</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-ink-soft">
                  {item.notes}
                </p>
              </div>
            )}

            {item.source === "NOTION" && (
              <p className="mt-5 border-t border-line pt-4 text-xs text-ink-faint">
                資料來源：Notion 單次匯入
              </p>
            )}

            {canEdit && (
              <div className="mt-6 min-w-0 border-t border-line-strong pt-5">
                <h4 className="text-sm font-semibold tracking-[0.08em] text-clay-strong">
                  {isFixedStage
                    ? "固定籌備階段"
                    : isFixedItem
                      ? "固定品項分類"
                      : isGroup
                        ? "管理群組"
                        : "管理花費項目"}
                </h4>
                {childCreateNotice && (
                  <p
                    role="status"
                    className="mt-4 break-words border-l-2 border-sage bg-positive-soft px-4 py-3 text-sm text-positive"
                  >
                    {childCreateNotice}
                  </p>
                )}
                {isFixedStage ? (
                  <p className="mt-3 text-sm leading-6 text-ink-soft">
                    此籌備階段的名稱與位置固定。請展開階段後，在所需的品項分類新增花費。
                  </p>
                ) : isFixedItem ? (
                  <p className="mt-3 text-sm leading-6 text-ink-soft">
                    此品項分類的名稱與位置固定；你仍可在下方新增花費或自訂子群組。
                  </p>
                ) : null}
                {isGroup && !isFixedGroup && (
                  <EditBudgetGroupDialog
                    workspaceId={workspaceId}
                    itemId={item.id}
                    name={item.name}
                    expectedVersion={item.version}
                    breadcrumb={breadcrumb}
                    onSuccess={setChildCreateNotice}
                    onPendingChange={setGroupMutationPending}
                  />
                )}
                {!isFixedGroup && !isLegacyUnclassified ? (
                  <details className="mt-4 min-w-0 border-y border-dashed border-line-strong py-2">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center py-2 text-sm font-semibold text-clay-strong [&::-webkit-details-marker]:hidden">
                      調整所在位置
                    </summary>
                    <div className="min-w-0 pb-3">
                      <MoveBudgetItemForm
                        key={`${item.parentId ?? "root"}:${item.version}`}
                        workspaceId={workspaceId}
                        itemId={item.id}
                        itemName={item.name}
                        currentParentId={item.parentId}
                        expectedVersion={item.version}
                        targets={moveTargets}
                        onPendingChange={setMovePending}
                      />
                    </div>
                  </details>
                ) : null}
                {!isFixedStage && !isLegacyUnclassified ? (
                  <details className="mt-4 min-w-0 border-y border-dashed border-line-strong py-2">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center py-2 text-sm font-semibold text-clay-strong [&::-webkit-details-marker]:hidden">
                      在此項下新增花費
                    </summary>
                    <div className="min-w-0 pb-3">
                      <CreateBudgetItemForm
                        workspaceId={workspaceId}
                        parentId={item.id}
                        parentBreadcrumb={breadcrumb}
                        parentCategory={hierarchyCategory}
                        parentTaxonomyItemKey={hierarchyTaxonomyItemKey}
                        onSuccess={setChildCreateNotice}
                        onPendingChange={setChildCreatePending}
                      />
                    </div>
                  </details>
                ) : null}
                {isGroup && !isFixedStage && !isLegacyUnclassified && (
                  <div className="mt-4 min-w-0 border-y border-dashed border-line-strong py-4">
                    <CreateBudgetGroupDialog
                      workspaceId={workspaceId}
                      parentId={item.id}
                      parentBreadcrumb={breadcrumb}
                      onSuccess={setChildCreateNotice}
                      onPendingChange={setGroupMutationPending}
                    />
                  </div>
                )}
                {!isGroup && item.category !== null && (
                  <>
                    <EditBudgetItemForm
                      workspaceId={workspaceId}
                      itemId={item.id}
                      name={item.name}
                      category={item.category}
                      taxonomyItemKey={hierarchyTaxonomyItemKey}
                      relatedTaxonomyItemKey={item.relatedTaxonomyItemKey}
                      plannedAmount={item.plannedAmount}
                      actualAmount={item.actualAmount}
                      bookingStatus={item.bookingStatus}
                      dueDate={item.dueDate}
                      depositAmount={item.depositAmount}
                      balanceAmount={item.balanceAmount}
                      additionalAmount={item.additionalAmount}
                      estimatedRange={item.estimatedRange}
                      candidateVendors={item.candidateVendors}
                      confirmedVendor={item.confirmedVendor}
                      vendorContact={item.vendorContact}
                      primaryContact={item.primaryContact}
                      notes={item.notes}
                      expectedVersion={item.version}
                      breadcrumb={breadcrumb}
                      depth={item.depth}
                      directParentName={item.directParentName}
                      directChildCount={directChildCount}
                      descendantCount={descendantCount}
                    />
                    <div className="mt-4 min-w-0 border-t border-dashed border-line-strong pt-4">
                      <ChangeBudgetItemBookingStatusForm
                        workspaceId={workspaceId}
                        itemId={item.id}
                        bookingStatus={item.bookingStatus}
                        itemName={item.name}
                        expectedVersion={item.version}
                        onPendingChange={setStatusPending}
                      />
                    </div>
                  </>
                )}
                {isGroup && !isFixedGroup && directChildCount > 0 && (
                  <DissolveBudgetGroupForm
                    workspaceId={workspaceId}
                    itemId={item.id}
                    name={item.name}
                    expectedVersion={item.version}
                    expectedDirectChildSetHash={item.directChildSetHash}
                    directChildCount={directChildCount}
                    directParentName={item.directParentName}
                    onPendingChange={setDissolvePending}
                    onSuccess={onDissolveSuccess}
                  />
                )}
                {isGroup &&
                !isFixedGroup &&
                descendantCount > 0 &&
                item.subtreeDeleteSnapshot ? (
                  <DeleteBudgetGroupSubtreeDialog
                    workspaceId={workspaceId}
                    itemId={item.id}
                    name={item.name}
                    expectedVersion={item.version}
                    expectedSubtreeSnapshotToken={
                      item.subtreeDeleteSnapshot.token
                    }
                    descendantCount={descendantCount}
                    attachmentCount={
                      item.subtreeDeleteSnapshot.attachmentCount
                    }
                    onSuccess={onDissolveSuccess}
                  />
                ) : null}
                {!isFixedGroup && descendantCount === 0 ? (
                  <DeleteBudgetItemForm
                    workspaceId={workspaceId}
                    itemId={item.id}
                    name={item.name}
                    expectedVersion={item.version}
                    onPendingChange={setDeletePending}
                    onSuccess={onDeleteSuccess}
                  />
                ) : null}
              </div>
            )}
          </section>
        </dialog>
      </article>
    </li>
  );
}

function matchesSearch(item: BudgetItemListItem, search: string): boolean {
  const normalizedSearch = search.trim().toLocaleLowerCase("zh-TW");
  if (!normalizedSearch) {
    return true;
  }

  const notionSourceHierarchyPath = notionSourceHierarchyPathOf(item);

  return [
    item.name,
    item.kind === "GROUP" ? "群組" : null,
    ...item.breadcrumb,
    taxonomyNodeLabel(item.relatedTaxonomyItemKey),
    item.relatedTaxonomyItemKey ? "用途 用途關聯" : null,
    item.relatedTaxonomyItemKey === "ITEM_PRE_WEDDING_PHOTOGRAPHY"
      ? "拍攝延伸"
      : item.relatedTaxonomyItemKey
        ? "關聯費用"
        : null,
    item.candidateVendors,
    item.confirmedVendor,
    item.vendorContact,
    notionSourceHierarchyPath.length > 0 ? "Notion 原始路徑" : null,
    notionSourceHierarchyPath.join(" › "),
    ...notionSourceHierarchyPath,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) =>
      value.toLocaleLowerCase("zh-TW").includes(normalizedSearch),
    );
}

function hierarchyCategoryForItem(
  items: BudgetItemListItem[],
  itemIndex: number,
): BudgetCostCategory {
  let rootIndex = itemIndex;
  while (rootIndex > 0 && items[rootIndex].depth > 0) rootIndex -= 1;
  const rootDepth = items[rootIndex]?.depth ?? 0;
  for (let index = rootIndex; index < items.length; index += 1) {
    if (index > rootIndex && items[index].depth <= rootDepth) break;
    const category = items[index].category;
    if (category !== null) return category;
  }
  return items[itemIndex].category ?? "OTHER_PENDING";
}

function fallbackTaxonomyItemKeyForCategory(
  category: BudgetCostCategory,
): BudgetTaxonomyItemKey | undefined {
  const matchingItems = BUDGET_TAXONOMY_STAGES.flatMap((stage) =>
    stage.items.filter((item) => item.defaultCategory === category),
  );
  return matchingItems.length === 1 ? matchingItems[0].key : undefined;
}

function taxonomyItemKeyForItem(
  items: BudgetItemListItem[],
  itemIndex: number,
): BudgetTaxonomyItemKey | undefined {
  let ancestorDepth = items[itemIndex]?.depth ?? 0;
  for (let index = itemIndex; index >= 0; index -= 1) {
    const candidate = items[index];
    if (index !== itemIndex && candidate.depth >= ancestorDepth) continue;
    ancestorDepth = candidate.depth;
    const key = systemTaxonomyKeyOf(candidate);
    if (isTaxonomyItemKey(key)) return key;
    if (candidate.depth === 0) break;
  }

  const hasTaxonomyShape = items.some(
    (item) => systemTaxonomyKeyOf(item) !== undefined,
  );
  if (hasTaxonomyShape) return undefined;
  for (const stage of BUDGET_TAXONOMY_STAGES) {
    const exactNameMatch = stage.items.find(
      (item) => item.label === items[itemIndex]?.name,
    );
    if (exactNameMatch) return exactNameMatch.key;
  }
  return fallbackTaxonomyItemKeyForCategory(
    hierarchyCategoryForItem(items, itemIndex),
  );
}

function moveTargetsForItem(
  items: BudgetItemListItem[],
  itemIndex: number,
): BudgetMoveTarget[] {
  const item = items[itemIndex];
  const hierarchyCategory = hierarchyCategoryForItem(items, itemIndex);
  const hierarchyTaxonomyItemKey = taxonomyItemKeyForItem(items, itemIndex);
  let afterDescendants = itemIndex + 1;
  while (
    afterDescendants < items.length &&
    items[afterDescendants].depth > item.depth
  ) {
    afterDescendants += 1;
  }
  return items
    .filter(
      (_candidate, candidateIndex) =>
        (candidateIndex < itemIndex || candidateIndex >= afterDescendants) &&
        (hierarchyTaxonomyItemKey
          ? taxonomyItemKeyForItem(items, candidateIndex) ===
            hierarchyTaxonomyItemKey
          : hierarchyCategoryForItem(items, candidateIndex) ===
            hierarchyCategory),
    )
    .map((candidate) => ({
      id: candidate.id,
      label: candidate.breadcrumb.join(" › "),
    }));
}

function filterBudgetItems(
  items: BudgetItemListItem[],
  search: string,
  statusFilter: BudgetStatusFilter,
): {
  entries: Array<{
    item: BudgetItemListItem;
    isMatch: boolean;
    isContext: boolean;
    isVisible: boolean;
  }>;
  matchCounts: BudgetKindCounts;
  contextCounts: BudgetKindCounts;
} {
  const directMatches = items.map(
    (item) =>
      matchesSearch(item, search) &&
      (statusFilter === "ALL" ||
        (item.kind === "EXPENSE" &&
          !isPassThroughSourceNode(item) &&
          item.bookingStatus === statusFilter)),
  );
  const includedIndexes = new Set<number>();
  const contextIndexes = new Set<number>();
  const ancestorIndexes: number[] = [];

  items.forEach((item, index) => {
    ancestorIndexes.length = Math.min(item.depth, ancestorIndexes.length);

    if (directMatches[index]) {
      includedIndexes.add(index);
      for (const ancestorIndex of ancestorIndexes) {
        includedIndexes.add(ancestorIndex);
        if (!directMatches[ancestorIndex]) {
          contextIndexes.add(ancestorIndex);
        }
      }
    }

    ancestorIndexes[item.depth] = index;
    ancestorIndexes.length = item.depth + 1;
  });

  return {
    entries: items.map((item, index) => ({
      item,
      isMatch: directMatches[index],
      isContext: contextIndexes.has(index),
      isVisible: includedIndexes.has(index),
    })),
    matchCounts: countBudgetKinds(
      items,
      (_item, itemIndex) => directMatches[itemIndex],
    ),
    contextCounts: countBudgetKinds(items, (_item, itemIndex) =>
      contextIndexes.has(itemIndex),
    ),
  };
}

function allItemVisibility(
  items: BudgetItemListItem[],
  expandedGroups: Record<string, boolean>,
  expandableGroupIds: ReadonlySet<string>,
): boolean[] {
  const hiddenBranchAtDepth: boolean[] = [];

  return items.map((item) => {
    hiddenBranchAtDepth.length = item.depth;
    const hiddenByAncestor = hiddenBranchAtDepth.some(Boolean);
    hiddenBranchAtDepth[item.depth] =
      hiddenByAncestor ||
      (item.kind === "GROUP" &&
        expandableGroupIds.has(item.id) &&
        expandedGroups[item.id] !== true);
    return !hiddenByAncestor;
  });
}

export function BudgetList({
  workspaceId,
  workspaceName = "",
  items,
  summary,
  canEdit,
  canResetBudget = false,
  resetSnapshot = null,
}: {
  workspaceId: string;
  workspaceName?: string;
  items: BudgetItemListItem[];
  summary: BudgetSummary;
  canEdit: boolean;
  canResetBudget?: boolean;
  resetSnapshot?: BudgetResetSnapshot | null;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<BudgetStatusFilter>("ALL");
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingRelatedNavigationId, setPendingRelatedNavigationId] = useState<
    string | null
  >(null);
  const [taxonomySelection, setTaxonomySelection] =
    useState<TaxonomySelectionState>({
      workspaceId: null,
      itemId: null,
    });
  const [groupExpansion, setGroupExpansion] = useState<GroupExpansionState>({
    workspaceId: null,
    expanded: {},
  });
  const selectionHeadingRef = useRef<HTMLHeadingElement>(null);
  const expansionTouchedWorkspaceRef = useRef<string | null>(null);
  const forcedExpansionDescriptionId = useId();
  const { driveItems, legacyItems, displayItems } = useMemo(
    () => prepareBudgetDisplayItems(items),
    [items],
  );
  const existingSuggestionKeys = useMemo(
    () =>
      new Set(
        items.flatMap((item) => {
          const suggestionKey = suggestionKeyOf(item);
          return typeof suggestionKey === "string" ? [suggestionKey] : [];
        }),
      ),
    [items],
  );
  const coveredPreparationSuggestionKeys = useMemo(
    () =>
      coveredBudgetPreparationSuggestionKeys(
        items.flatMap((item, itemIndex) => {
          if (item.kind !== "EXPENSE") return [];
          const taxonomyItemKey = taxonomyItemKeyForItem(items, itemIndex);
          return taxonomyItemKey
            ? [{ taxonomyItemKey, name: item.name }]
            : [];
        }),
      ),
    [items],
  );
  const expenseCountByGroupId = useMemo(() => {
    const counts = new Map<string, number>();
    const ancestorGroupIds: string[] = [];

    driveItems.forEach((item) => {
      ancestorGroupIds.length = item.depth;
      if (item.kind === "EXPENSE") {
        ancestorGroupIds.forEach((groupId) => {
          counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
        });
      }
      if (item.kind === "GROUP") {
        ancestorGroupIds[item.depth] = item.id;
      }
      ancestorGroupIds.length = item.depth + 1;
    });

    return counts;
  }, [driveItems]);
  const taxonomyNavigationStages = useMemo<
    BudgetTaxonomyNavigationStage[]
  >(() => {
    const taxonomyItemsByParentId = new Map<string, BudgetItemListItem[]>();
    driveItems.forEach((item) => {
      if (!isTaxonomyItemKey(systemTaxonomyKeyOf(item)) || item.parentId === null) {
        return;
      }
      const siblings = taxonomyItemsByParentId.get(item.parentId) ?? [];
      siblings.push(item);
      taxonomyItemsByParentId.set(item.parentId, siblings);
    });

    return driveItems.flatMap((stage) => {
      const key = systemTaxonomyKeyOf(stage);
      if (typeof key !== "string" || !BUDGET_TAXONOMY_STAGE_KEY_SET.has(key)) {
        return [];
      }
      return [{
        stage,
        items: taxonomyItemsByParentId.get(stage.id) ?? [],
      }];
    });
  }, [driveItems]);
  const selectedTaxonomyItemId = useMemo(() => {
    if (
      taxonomySelection.workspaceId !== workspaceId ||
      taxonomySelection.itemId === null
    ) {
      return null;
    }
    const selectedStillExists = taxonomyNavigationStages.some((stage) =>
      stage.items.some((item) => item.id === taxonomySelection.itemId),
    );
    return selectedStillExists ? taxonomySelection.itemId : null;
  }, [taxonomyNavigationStages, taxonomySelection, workspaceId]);
  const relatedExpensesByTaxonomy = useMemo(() => {
    const relatedByTaxonomy = new Map<
      BudgetTaxonomyItemKey,
      RelatedBudgetExpense[]
    >();
    displayItems.forEach((item, itemIndex) => {
      if (item.kind !== "EXPENSE" || item.relatedTaxonomyItemKey === null) {
        return;
      }
      const primaryTaxonomyItemKey = taxonomyItemKeyForItem(
        displayItems,
        itemIndex,
      );
      const primaryTaxonomyItemLabel =
        taxonomyNodeLabel(primaryTaxonomyItemKey) ?? "待重新分類";
      const relatedExpenses =
        relatedByTaxonomy.get(item.relatedTaxonomyItemKey) ?? [];
      relatedExpenses.push({
        id: item.id,
        name: item.name,
        primaryTaxonomyItemLabel,
        plannedAmount: item.plannedAmount,
        sourceHierarchyPath: notionSourceHierarchyPathOf(item),
      });
      relatedByTaxonomy.set(item.relatedTaxonomyItemKey, relatedExpenses);
    });
    return relatedByTaxonomy;
  }, [displayItems]);
  const relatedExpenseCountByTaxonomyItemId = useMemo(() => {
    const counts = new Map<string, number>();
    taxonomyNavigationStages.forEach(({ items: taxonomyItems }) => {
      taxonomyItems.forEach((taxonomyItem) => {
        const taxonomyKey = systemTaxonomyKeyOf(taxonomyItem);
        if (!isTaxonomyItemKey(taxonomyKey)) {
          return;
        }
        const relatedExpenseCount =
          relatedExpensesByTaxonomy.get(taxonomyKey)?.length ?? 0;
        if (relatedExpenseCount > 0) {
          counts.set(taxonomyItem.id, relatedExpenseCount);
        }
      });
    });
    return counts;
  }, [relatedExpensesByTaxonomy, taxonomyNavigationStages]);
  const selectedTaxonomyContext =
    taxonomyNavigationStages
      .flatMap(({ stage, items: taxonomyItems }) =>
        taxonomyItems.map((item) => ({ stage, item })),
      )
      .find(({ item }) => item.id === selectedTaxonomyItemId) ?? null;
  const selectedTaxonomyItemKey = (() => {
    const key = selectedTaxonomyContext
      ? systemTaxonomyKeyOf(selectedTaxonomyContext.item)
      : null;
    return isTaxonomyItemKey(key) ? key : undefined;
  })();
  const groupControlsById = useMemo(() => {
    const controlledRows = groupDirectChildRowIds(displayItems);
    displayItems.forEach((item) => {
      const taxonomyKey = systemTaxonomyKeyOf(item);
      if (
        item.kind !== "GROUP" ||
        !isTaxonomyItemKey(taxonomyKey) ||
        !relatedExpensesByTaxonomy.has(taxonomyKey)
      ) {
        return;
      }
      const relatedControlsId = budgetRelatedExpensesDomId(item.id);
      const directControlsIds = controlledRows.get(item.id);
      controlledRows.set(
        item.id,
        directControlsIds
          ? directControlsIds + " " + relatedControlsId
          : relatedControlsId,
      );
    });
    return controlledRows;
  }, [displayItems, relatedExpensesByTaxonomy]);
  const expandableGroupIds = useMemo(
    () => Array.from(groupControlsById.keys()),
    [groupControlsById],
  );
  const expandableGroupIdSet = useMemo(
    () => new Set(expandableGroupIds),
    [expandableGroupIds],
  );
  const expandedGroups = useMemo(
    () =>
      groupExpansion.workspaceId === workspaceId ? groupExpansion.expanded : {},
    [groupExpansion, workspaceId],
  );

  useEffect(() => {
    expansionTouchedWorkspaceRef.current = null;
    const timer = window.setTimeout(() => {
      if (expansionTouchedWorkspaceRef.current === workspaceId) {
        return;
      }
      const expanded: Record<string, boolean> = {};
      try {
        const currentKey = collapseStorageKey(workspaceId);
        const legacyKey = legacyCollapseStorageKey(workspaceId);
        let rawValue = window.localStorage.getItem(currentKey);
        let loadedFromLegacy = false;
        if (rawValue === null) {
          rawValue = window.localStorage.getItem(legacyKey);
          loadedFromLegacy = rawValue !== null;
        }
        const parsed: unknown = rawValue === null ? null : JSON.parse(rawValue);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const groupId of expandableGroupIds) {
            const value = (parsed as Record<string, unknown>)[groupId];
            if (typeof value === "boolean") {
              expanded[groupId] = value;
            }
          }
          if (loadedFromLegacy) {
            window.localStorage.setItem(currentKey, JSON.stringify(expanded));
            window.localStorage.removeItem(legacyKey);
          }
        }
      } catch {
        // Browser storage is optional; the deterministic collapsed default remains usable.
      }
      setGroupExpansion({ workspaceId, expanded });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [expandableGroupIds, workspaceId]);

  useEffect(() => {
    if (groupExpansion.workspaceId !== workspaceId) {
      return;
    }
    try {
      window.localStorage.setItem(
        collapseStorageKey(workspaceId),
        JSON.stringify(groupExpansion.expanded),
      );
    } catch {
      // Storage failures must not block the browse experience.
    }
  }, [groupExpansion, workspaceId]);

  const filteredItems = useMemo(
    () => filterBudgetItems(displayItems, search, statusFilter),
    [displayItems, search, statusFilter],
  );
  const allVisibility = useMemo(
    () =>
      allItemVisibility(
        displayItems,
        expandedGroups,
        expandableGroupIdSet,
      ),
    [displayItems, expandableGroupIdSet, expandedGroups],
  );

  useEffect(() => {
    if (pendingRelatedNavigationId === null) {
      return;
    }
    const row = document.getElementById(
      budgetRowDomId(pendingRelatedNavigationId),
    );
    if (!row || row.closest("[hidden]")) {
      return;
    }
    const focusTarget = row.querySelector<HTMLElement>("article") ?? row;
    focusTarget.focus({ preventScroll: true });
    row.scrollIntoView?.({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => {
      setPendingRelatedNavigationId(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [allVisibility, pendingRelatedNavigationId]);

  const selectedTaxonomyItemIds = (() => {
    if (selectedTaxonomyContext === null) {
      return null;
    }
    const selectedItemIndex = displayItems.findIndex(
      (item) => item.id === selectedTaxonomyContext.item.id,
    );
    if (selectedItemIndex < 0) {
      return null;
    }
    const selectedIds = new Set<string>();
    const selectedDepth = displayItems[selectedItemIndex].depth;
    for (
      let itemIndex = selectedItemIndex;
      itemIndex < displayItems.length;
      itemIndex += 1
    ) {
      const item = displayItems[itemIndex];
      if (itemIndex > selectedItemIndex && item.depth <= selectedDepth) {
        break;
      }
      selectedIds.add(item.id);
    }
    return selectedIds;
  })();
  const hasActiveFilter = search.trim().length > 0 || statusFilter !== "ALL";
  const groupForcedExpansion = hasActiveFilter;
  const selectionForcedExpansion = selectedTaxonomyItemIds !== null;
  const anyForcedExpansion = groupForcedExpansion || selectionForcedExpansion;
  const totalCounts = useMemo(
    () => countBudgetKinds(displayItems, () => true),
    [displayItems],
  );
  const viewTotalCounts =
    selectedTaxonomyItemIds === null
      ? totalCounts
      : countBudgetKinds(displayItems, (item) =>
          selectedTaxonomyItemIds.has(item.id),
        );
  const groupVisibleCounts = countBudgetKinds(
    displayItems,
    (item, itemIndex) =>
      Boolean(selectionForcedExpansion || allVisibility[itemIndex]) &&
      (selectedTaxonomyItemIds === null ||
        selectedTaxonomyItemIds.has(item.id)),
  );
  const activeMatchCount = hasActiveFilter
    ? filteredItems.matchCounts.expenses + filteredItems.matchCounts.groups
    : groupVisibleCounts.expenses + groupVisibleCounts.groups;
  const groupResultLabel =
    (hasActiveFilter
      ? filteredItems.matchCounts.expenses
      : groupVisibleCounts.expenses) +
    " / " +
    viewTotalCounts.expenses +
    " 筆花費" +
    (viewTotalCounts.groups > 0
      ? (hasActiveFilter ? "、" : "，") +
        (hasActiveFilter
          ? filteredItems.matchCounts.groups
          : groupVisibleCounts.groups) +
        " / " +
        viewTotalCounts.groups +
        " 個群組"
      : "");
  const contextLabels = [
    filteredItems.contextCounts.expenses > 0
      ? filteredItems.contextCounts.expenses + " 筆上層花費"
      : null,
    filteredItems.contextCounts.groups > 0
      ? filteredItems.contextCounts.groups + " 個上層群組"
      : null,
  ].filter((label): label is string => label !== null);
  const resultLabel =
    (hasActiveFilter ? "符合 " : "顯示 ") +
    groupResultLabel +
    (hasActiveFilter && contextLabels.length > 0
      ? "，另顯示 " + contextLabels.join("、")
      : "");
  const driveDisplayEntries = useMemo(
    () => driveItems.map((_item, itemIndex) => ({ itemIndex })),
    [driveItems],
  );
  const visibleDriveDisplayEntries =
    selectedTaxonomyItemIds === null
      ? driveDisplayEntries
      : driveDisplayEntries.filter(({ itemIndex }) =>
          selectedTaxonomyItemIds.has(displayItems[itemIndex].id),
        );
  const legacyDisplayEntries = useMemo(
    () =>
      legacyItems.map((_item, legacyIndex) => ({
        itemIndex: driveItems.length + legacyIndex,
      })),
    [driveItems.length, legacyItems],
  );

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("ALL");
    setTaxonomySelection({ workspaceId, itemId: null });
  };
  const applyAllGroupExpansion = (expanded: boolean) => {
    expansionTouchedWorkspaceRef.current = workspaceId;
    setGroupExpansion({
      workspaceId,
      expanded: Object.fromEntries(
        expandableGroupIds.map((groupId) => [groupId, expanded]),
      ),
    });
  };
  const setAllGroupsExpanded = (expanded: boolean) => {
    if (anyForcedExpansion) {
      return;
    }
    applyAllGroupExpansion(expanded);
  };
  const setOneGroupExpanded = (groupId: string, expanded: boolean) => {
    if (anyForcedExpansion || !expandableGroupIdSet.has(groupId)) {
      return;
    }
    expansionTouchedWorkspaceRef.current = workspaceId;
    setGroupExpansion((current) => ({
      workspaceId,
      expanded: {
        ...(current.workspaceId === workspaceId ? current.expanded : {}),
        [groupId]: expanded,
      },
    }));
  };
  const selectTaxonomyItem = (_stageId: string, itemId: string) => {
    resetFilters();
    setTaxonomySelection({ workspaceId, itemId });
    setPendingRelatedNavigationId(itemId);
  };
  const navigateToRelatedExpense = (expenseId: string) => {
    const itemById = new Map(
      displayItems.map((item) => [item.id, item] as const),
    );
    const sourceItem = itemById.get(expenseId);
    if (!sourceItem) {
      return;
    }
    const ancestorGroupIds: string[] = [];
    const visitedIds = new Set<string>();
    let parentId = sourceItem.parentId;
    while (parentId && !visitedIds.has(parentId)) {
      visitedIds.add(parentId);
      const parent = itemById.get(parentId);
      if (!parent) {
        break;
      }
      if (expandableGroupIdSet.has(parent.id)) {
        ancestorGroupIds.push(parent.id);
      }
      parentId = parent.parentId;
    }
    expansionTouchedWorkspaceRef.current = workspaceId;
    setGroupExpansion((current) => {
      const expanded = {
        ...(current.workspaceId === workspaceId ? current.expanded : {}),
      };
      ancestorGroupIds.forEach((groupId) => {
        expanded[groupId] = true;
      });
      return { workspaceId, expanded };
    });
    resetFilters();
    setPendingRelatedNavigationId(expenseId);
    setNotice(`已展開原始花費「${sourceItem.name}」。`);
  };

  const showAllSummaryItems = () => {
    resetFilters();
  };
  const showSummaryStatus = (status: BudgetStatusFilter) => {
    setSearch("");
    setStatusFilter(status);
    setTaxonomySelection({ workspaceId, itemId: null });
  };
  const showAllTaxonomyItems = () => {
    resetFilters();
    window.setTimeout(() => selectionHeadingRef.current?.focus(), 0);
  };
  const renderBudgetItemEntry = (
    itemIndex: number,
    isLegacyUnclassified: boolean,
  ) => {
    const item = displayItems[itemIndex];
    const systemTaxonomyKey = systemTaxonomyKeyOf(item);
    const relatedExpenses = isTaxonomyItemKey(systemTaxonomyKey)
      ? relatedExpensesByTaxonomy.get(systemTaxonomyKey)
      : undefined;
    const filteredEntry = filteredItems.entries[itemIndex];
    const savedExpanded = expandedGroups[item.id] === true;
    const effectiveExpanded =
      groupForcedExpansion ||
      (selectedTaxonomyItemIds?.has(item.id) ?? false)
        ? true
        : savedExpanded;
    const isHidden =
      !filteredEntry.isVisible ||
      (!hasActiveFilter &&
        !selectionForcedExpansion &&
        !allVisibility[itemIndex]);

    return (
      <BudgetItemRow
        key={item.id}
        workspaceId={workspaceId}
        hierarchyCategory={hierarchyCategoryForItem(displayItems, itemIndex)}
        hierarchyTaxonomyItemKey={taxonomyItemKeyForItem(
          displayItems,
          itemIndex,
        )}
        item={item}
        moveTargets={
          isLegacyUnclassified
            ? []
            : moveTargetsForItem(displayItems, itemIndex)
        }
        canEdit={canEdit}
        visualDepth={item.depth}
        rowId={budgetRowDomId(item.id)}
        groupExpanded={effectiveExpanded}
        groupControlsIds={groupControlsById.get(item.id) ?? null}
        groupToggleDisabled={anyForcedExpansion}
        groupToggleDescriptionId={
          anyForcedExpansion ? forcedExpansionDescriptionId : undefined
        }
        onToggleGroup={() =>
          setOneGroupExpanded(item.id, !effectiveExpanded)
        }
        hasActiveFilter={hasActiveFilter}
        relatedExpenses={relatedExpenses}
        onNavigateToRelatedExpense={navigateToRelatedExpense}
        onDeleteSuccess={() =>
          setNotice("已移除花費項目「" + item.name + "」。")
        }
        onDissolveSuccess={setNotice}
        isLegacyUnclassified={isLegacyUnclassified}
        isContext={filteredEntry.isContext}
        isHidden={isHidden}
      />
    );
  };

  return (
    <div
      data-budget-mobile-contract="390"
      className="mt-4 min-w-0 space-y-4 sm:mt-6 sm:space-y-6"
    >
      <BudgetSummaryView
        summary={summary}
        onShowAll={showAllSummaryItems}
        onShowPaid={() => showSummaryStatus("PAID")}
        onShowBalanceDue={() => showSummaryStatus("BOOKED_BALANCE_DUE")}
      />
      <div className="xl:hidden">
        <BudgetHierarchyGuide />
      </div>

      <section aria-labelledby="budget-items-heading" className="min-w-0">
        <h2 id="budget-items-heading" tabIndex={-1} className="sr-only">
          花費明細
        </h2>
        <p className="sr-only">
          左側依 Drive 分類定位，右側保留 Notion 來源分組與實際付款資訊。
        </p>
        {notice ? (
          <p
            role="status"
            className="border-b border-positive/40 bg-positive-soft px-4 py-3 text-sm text-positive"
          >
            {notice}
          </p>
        ) : null}

        <div
          data-budget-workspace-layout="taxonomy-expenses"
          data-desktop-layout={
            taxonomyNavigationStages.length > 0 ? "split" : "single"
          }
          data-mobile-layout="stacked"
          className={[
            "mt-4 min-w-0",
            taxonomyNavigationStages.length > 0
              ? "xl:grid xl:grid-cols-[15rem_minmax(0,1fr)] xl:items-start xl:gap-6"
              : "",
          ].join(" ")}
        >
          {taxonomyNavigationStages.length > 0 && (
            <aside className="hidden min-w-0 xl:block">
              <BudgetTaxonomyNavigator
                stages={taxonomyNavigationStages}
                selectedItemId={selectedTaxonomyItemId}
                expenseCountByGroupId={expenseCountByGroupId}
                relatedExpenseCountByTaxonomyItemId={
                  relatedExpenseCountByTaxonomyItemId
                }
                onSelect={selectTaxonomyItem}
              />
            </aside>
          )}

          <section
            aria-label="花費工作區"
            data-budget-layout-panel="expenses"
            className="min-w-0 overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-[0_14px_36px_rgba(69,49,38,0.07)]"
          >
            <div
              data-budget-selection-context="true"
              className="grid min-w-0 gap-4 border-b border-line bg-surface px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
            >
              <div className="min-w-0">
                <p className="break-words text-xs font-semibold tracking-[0.08em] text-clay">
                  {selectedTaxonomyContext
                    ? `${selectedTaxonomyContext.stage.name} ›`
                    : "全部分類"}
                </p>
                <h3
                  ref={selectionHeadingRef}
                  tabIndex={-1}
                  className="mt-1 break-words font-serif text-xl font-semibold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-clay"
                >
                  {selectedTaxonomyContext
                    ? selectedTaxonomyContext.item.name
                    : "全部花費"}
                </h3>
                <p className="mt-1 break-words text-xs leading-5 text-ink-soft">
                  {selectedTaxonomyContext
                    ? `${expenseCountByGroupId.get(selectedTaxonomyContext.item.id) ?? 0} 筆主分類花費` +
                      ((relatedExpenseCountByTaxonomyItemId.get(
                        selectedTaxonomyContext.item.id,
                      ) ?? 0) > 0
                        ? ` · ${relatedExpenseCountByTaxonomyItemId.get(
                            selectedTaxonomyContext.item.id,
                          )} 筆延伸`
                        : "")
                    : `${totalCounts.expenses} 筆花費，依 Drive 分類瀏覽`}
                </p>
                {selectedTaxonomyContext && (
                  <button
                    type="button"
                    onClick={showAllTaxonomyItems}
                    className="mt-2 min-h-11 text-xs font-semibold text-clay-strong underline decoration-line-strong underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay"
                  >
                    顯示全部分類
                  </button>
                )}
              </div>
              {canEdit && (
                <div
                  data-budget-actions-toolbar="true"
                  className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start lg:justify-end"
                >
                  <details
                  data-budget-primary-action="true"
                  className="group min-w-0"
                >
                  <summary className="flex min-h-12 w-fit max-w-full cursor-pointer list-none items-center gap-2 rounded-full bg-clay-strong px-5 py-3 text-sm font-semibold text-white outline-none transition hover:bg-clay-strong focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
                    <Plus
                      aria-hidden="true"
                      size={18}
                      weight="bold"
                      className="transition-transform group-open:rotate-45"
                    />
                    {selectedTaxonomyContext
                      ? "在此分類新增花費"
                      : "新增花費"}
                  </summary>
                  <div className="min-w-0 pb-5 lg:min-w-[32rem]">
                    <CreateBudgetItemForm
                      key={selectedTaxonomyContext?.item.id ?? "all"}
                      workspaceId={workspaceId}
                      parentId={selectedTaxonomyContext?.item.id ?? null}
                      parentBreadcrumb={
                        selectedTaxonomyContext?.item.breadcrumb ?? []
                      }
                      parentCategory={
                        selectedTaxonomyContext?.item.category ?? undefined
                      }
                      parentTaxonomyItemKey={selectedTaxonomyItemKey}
                    />
                  </div>
                </details>
                <details className="group min-w-0">
                  <summary
                    aria-label={
                      selectedTaxonomyContext
                        ? "在此分類建立群組（選用）"
                        : "建立群組（選用）"
                    }
                    className="flex min-h-11 w-fit max-w-full cursor-pointer list-none items-center gap-2 rounded-full border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink-soft outline-none transition hover:bg-clay-soft focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden"
                  >
                    <Plus
                      aria-hidden="true"
                      size={17}
                      weight="bold"
                      className="transition-transform group-open:rotate-45"
                    />
                    {selectedTaxonomyContext
                      ? "在此分類建立群組（選用）"
                      : "建立群組（選用）"}
                  </summary>
                  <div className="min-w-0 space-y-3 pb-5 pt-3 lg:min-w-[30rem]">
                    <p className="max-w-xl text-sm leading-6 text-ink-soft">
                      {selectedTaxonomyContext
                        ? `會建立在「${selectedTaxonomyContext.item.name}」內；只有方案或真正父子關係需要彙總時才建立群組。`
                        : "先選擇品項分類；只有方案或真正父子關係需要彙總時才建立群組。"}
                    </p>
                    <CreateBudgetGroupDialog
                      key={selectedTaxonomyContext?.item.id ?? "all"}
                      workspaceId={workspaceId}
                      parentId={selectedTaxonomyContext?.item.id ?? null}
                      parentBreadcrumb={
                        selectedTaxonomyContext?.item.breadcrumb ?? []
                      }
                      onSuccess={setNotice}
                    />
                  </div>
                  </details>
                  <BudgetEngagementPreset
                    workspaceId={workspaceId}
                    existingSuggestionKeys={existingSuggestionKeys}
                    onSuccess={setNotice}
                  />
                  <BudgetPreparationPreset
                    workspaceId={workspaceId}
                    existingSuggestionKeys={existingSuggestionKeys}
                    coveredSuggestionKeys={coveredPreparationSuggestionKeys}
                    onSuccess={setNotice}
                  />
                </div>
              )}
            </div>

            {displayItems.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-sm leading-6 text-ink-soft">
                  尚無花費明細。分類仍可在新增花費時選擇。
                </p>
              </div>
            ) : (
              <>
                <div className="flex min-w-0 flex-col gap-2 border-b border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs leading-5 text-ink-soft">
                    選擇左側分類可直接展開並定位；手機版則依階段向下瀏覽。
                  </p>
                  {expandableGroupIds.length > 0 && (
                    <div className="flex min-w-0 flex-col gap-1 sm:items-end">
                      <div className="flex min-w-0 flex-wrap gap-1">
                        <button
                          type="button"
                          aria-describedby={
                            anyForcedExpansion
                              ? forcedExpansionDescriptionId
                              : undefined
                          }
                          disabled={anyForcedExpansion}
                          onClick={() => setAllGroupsExpanded(true)}
                          className="min-h-11 rounded-full px-3 py-2 text-xs font-semibold text-clay-strong underline decoration-line-strong underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay disabled:cursor-not-allowed disabled:text-ink-faint disabled:no-underline"
                        >
                          全部展開
                        </button>
                        <button
                          type="button"
                          aria-describedby={
                            anyForcedExpansion
                              ? forcedExpansionDescriptionId
                              : undefined
                          }
                          disabled={anyForcedExpansion}
                          onClick={() => setAllGroupsExpanded(false)}
                          className="min-h-11 rounded-full px-3 py-2 text-xs font-semibold text-clay-strong underline decoration-line-strong underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay disabled:cursor-not-allowed disabled:text-ink-faint disabled:no-underline"
                        >
                          全部收合
                        </button>
                      </div>
                      {anyForcedExpansion && (
                        <p
                          id={forcedExpansionDescriptionId}
                          role="status"
                          className="max-w-md text-xs leading-5 text-ink-soft"
                        >
                          {selectionForcedExpansion
                            ? "查看單一分類時會暫時展開其中的群組；顯示全部分類後會恢復原本狀態。"
                            : "搜尋或篩選期間會暫時展開符合項目的群組；清除條件後會恢復原本的展開狀態。"}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div
                  data-budget-toolbar="true"
                  className="grid min-w-0 grid-cols-1 gap-3 border-b border-line bg-surface-sunken/70 px-4 py-3 lg:grid-cols-[minmax(13rem,1fr)_auto_auto] lg:items-center"
                >
                  <div className="relative min-w-0 lg:col-start-1 lg:row-start-1">
                    <label htmlFor="budget-item-search" className="sr-only">
                      搜尋花費項目
                    </label>
                    <MagnifyingGlass
                      aria-hidden="true"
                      size={18}
                      weight="regular"
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
                    />
                    <input
                      id="budget-item-search"
                      type="search"
                      value={search}
                      onChange={(event) => {
                        setSearch(event.target.value);
                        setTaxonomySelection({ workspaceId, itemId: null });
                      }}
                      placeholder="名稱、品項分類、用途或廠商"
                      className="min-h-11 w-full min-w-0 rounded-lg border border-line-strong bg-surface py-2 pl-10 pr-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-clay-strong focus:ring-2 focus:ring-clay/25"
                    />
                  </div>
                  <div
                    role="group"
                    aria-label="依下訂與付款狀態篩選"
                    className="col-start-1 row-start-2 flex min-w-0 overflow-hidden rounded-lg border border-line-strong bg-surface lg:col-start-2 lg:row-start-1"
                  >
                    {STATUS_FILTERS.map((filter) => {
                      const selected = statusFilter === filter.value;
                      return (
                        <button
                          key={filter.value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => {
                            setStatusFilter(filter.value);
                            setTaxonomySelection({ workspaceId, itemId: null });
                          }}
                          className={[
                            "min-h-11 min-w-0 flex-1 border-r border-line-strong px-2.5 py-1.5 text-xs font-semibold transition last:border-r-0 focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay lg:flex-none lg:px-3",
                            selected
                              ? "bg-clay-strong text-white"
                              : "bg-transparent text-ink-soft hover:bg-surface-sunken",
                          ].join(" ")}
                        >
                          {filter.label}
                        </button>
                      );
                    })}
                  </div>
                  <p
                    aria-live="polite"
                    className="col-start-1 row-start-3 min-w-0 max-w-full justify-self-start break-words text-left text-xs tabular-nums text-ink-soft lg:col-start-3 lg:row-start-1 lg:max-w-xs lg:justify-self-end lg:self-center lg:text-right"
                  >
                    {resultLabel}
                  </p>
                </div>

                {activeMatchCount === 0 ? (
                  <div className="border-b border-line-strong py-10 text-center">
                    <p className="text-sm leading-6 text-ink-soft">
                      找不到符合條件的花費項目，請調整搜尋或篩選條件。
                    </p>
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="mt-4 min-h-11 rounded-full border border-ink-faint bg-surface px-4 py-2 text-sm font-semibold text-clay-strong transition hover:border-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2"
                    >
                      清除篩選
                    </button>
                  </div>
                ) : null}

                <ul data-budget-view="group" className="min-w-0">
                  {visibleDriveDisplayEntries.map(({ itemIndex }) =>
                    renderBudgetItemEntry(itemIndex, false),
                  )}
                </ul>

                {legacyItems.length > 0 &&
                selectedTaxonomyContext === null ? (
                  <section
                    aria-labelledby="budget-legacy-unclassified-heading"
                    data-budget-legacy-unclassified="true"
                    className="m-4 min-w-0 border border-amber-300 bg-amber-50/75"
                  >
                    <div className="border-b border-amber-300 px-4 py-4 sm:px-5">
                      <h3
                        id="budget-legacy-unclassified-heading"
                        className="font-serif text-lg font-semibold text-amber-950"
                      >
                        {LEGACY_UNCLASSIFIED_HEADING}
                      </h3>
                      <p
                        role="status"
                        className="mt-2 max-w-3xl text-sm leading-6 text-amber-900"
                      >
                        這些項目尚未對應目前的品項分類。請開啟花費明細，從 20
                        個品項中選擇正確分類；重新分類前不會把舊類別當成選項顯示。
                      </p>
                    </div>
                    <ul data-budget-legacy-list="true" className="min-w-0">
                      {legacyDisplayEntries.map(({ itemIndex }) =>
                        renderBudgetItemEntry(itemIndex, true),
                      )}
                    </ul>
                  </section>
                ) : null}
              </>
            )}
          </section>
        </div>
      </section>
      {canResetBudget &&
      workspaceName.length > 0 &&
      resetSnapshot !== null &&
      resetSnapshot.itemCount > 0 ? (
        <ResetBudgetDataForm
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          snapshot={resetSnapshot}
        />
      ) : null}
    </div>
  );
}
