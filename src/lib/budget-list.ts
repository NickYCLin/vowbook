import "server-only";

import type { WeddingWorkspace } from "@prisma/client";
import {
  getWorkspacePermissions,
  WorkspaceAccessDeniedError,
} from "@/domain/workspace";
import type {
  BudgetBookingStatus,
  BudgetCostCategory,
  BudgetItemKind,
  BudgetPrimaryContact,
  BudgetSystemNodeKey,
  BudgetTaxonomyItemKey,
} from "@/domain/budget-item";
import {
  BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
  BUDGET_SYSTEM_NODES,
  BUDGET_SYSTEM_NODE_BY_KEY,
  BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES,
  isBudgetTaxonomyItemKey,
} from "@/domain/budget-item";
import {
  ALLOWED_BUDGET_ATTACHMENT_MEDIA_TYPES,
  type BudgetAttachmentMetadata,
  type BudgetAttachmentMediaType,
} from "@/domain/budget-attachment";
import { requireCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { fingerprintBudgetDirectChildIds } from "@/lib/budget-direct-child-set";
import {
  summarizeBudgetResetSnapshot,
  summarizeBudgetSubtreeNode,
  type BudgetResetSnapshot,
  type BudgetSubtreeChildSnapshot,
  type BudgetSubtreeDeleteSnapshot,
} from "@/lib/budget-reset-snapshot";

export type { BudgetResetSnapshot } from "@/lib/budget-reset-snapshot";

type BudgetItemSource = "MANUAL" | "NOTION";

type BudgetItemRecord = {
  id: string;
  parentId: string | null;
  source: BudgetItemSource;
  sourceOrder: number | null;
  sourceHierarchyPath: string[];
  name: string;
  kind: BudgetItemKind;
  category: BudgetCostCategory | null;
  systemTaxonomyKey?: string | null;
  relatedTaxonomyItemKey: string | null;
  suggestionKey?: string | null;
  plannedAmount: number;
  actualAmount: number | null;
  dueDate: Date | null;
  notes: string | null;
  paid: boolean;
  paidAt: Date | null;
  bookingStatus: BudgetBookingStatus;
  depositAmount: number | null;
  balanceAmount: number | null;
  additionalAmount: number | null;
  estimatedRange: string | null;
  candidateVendors: string | null;
  confirmedVendor: string | null;
  vendorContact: string | null;
  primaryContact: BudgetPrimaryContact | null;
  version: number;
  createdAt: Date;
  attachments?: Array<{
    id: string;
    originalName: string;
    mediaType: string;
    byteSize: number;
    createdAt: Date;
  }>;
};

type BudgetItemPrismaClient = {
  budgetItem: {
    findMany(args: unknown): Promise<BudgetItemRecord[]>;
  };
};

export type BudgetItemListItem = {
  id: string;
  parentId: string | null;
  depth: number;
  hasChildren: boolean;
  breadcrumb: string[];
  directChildren: Array<{
    id: string;
    name: string;
    hasChildren: boolean;
  }>;
  directChildCount: number;
  directChildSetHash: string;
  descendantCount: number;
  subtreeDeleteSnapshot?: BudgetSubtreeDeleteSnapshot;
  source: BudgetItemSource;
  sourceHierarchyPath: string[];
  name: string;
  kind: BudgetItemKind;
  category: BudgetCostCategory | null;
  systemTaxonomyKey?: BudgetSystemNodeKey | null;
  relatedTaxonomyItemKey: BudgetTaxonomyItemKey | null;
  suggestionKey?: string | null;
  directParentName: string | null;
  plannedAmount: number;
  rolledUpPlannedAmount: string;
  actualAmount: number | null;
  rolledUpActualAmount: string;
  rolledUpActualAmountRecorded?: boolean;
  rolledUpDepositAmount: string;
  rolledUpDepositAmountRecorded?: boolean;
  rolledUpBalanceAmount: string;
  rolledUpBalanceAmountRecorded?: boolean;
  dueDate: string | null;
  notes: string | null;
  paid: boolean;
  paidAt: string | null;
  bookingStatus: BudgetBookingStatus;
  depositAmount: number | null;
  balanceAmount: number | null;
  additionalAmount: number | null;
  estimatedRange: string | null;
  candidateVendors: string | null;
  confirmedVendor: string | null;
  vendorContact: string | null;
  primaryContact: BudgetPrimaryContact | null;
  version: number;
  attachments?: BudgetAttachmentMetadata[];
};

export type BudgetSummary = {
  itemCount: number;
  paidCount: number;
  plannedTotal: string;
  actualTotal: string;
  balanceDueTotal: string;
  balanceDueCount: number;
  balanceDueMissingAmountCount: number;
  nearestBalanceDueDate: string | null;
};

const DATA_ERROR_MESSAGE = "目前無法載入婚禮花費，請稍後再試。";

export class BudgetItemDataError extends Error {
  constructor(message = DATA_ERROR_MESSAGE) {
    super(message);
    this.name = "BudgetItemDataError";
  }
}

const budgetItemSelect = {
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

function amountAsBigInt(amount: number): bigint {
  if (!Number.isInteger(amount) || amount < 0 || amount > 2_147_483_647) {
    throw new BudgetItemDataError();
  }
  return BigInt(amount);
}

export function sumTwdAmounts(amounts: Iterable<number>): string {
  let total = BigInt(0);
  for (const amount of amounts) {
    total += amountAsBigInt(amount);
  }
  return total.toString();
}

function compareItems(left: BudgetItemRecord, right: BudgetItemRecord): number {
  const leftSystemIndex =
    left.systemTaxonomyKey === null || left.systemTaxonomyKey === undefined
      ? Number.MAX_SAFE_INTEGER
      : BUDGET_SYSTEM_NODES.findIndex(
          (node) => node.key === left.systemTaxonomyKey,
        );
  const rightSystemIndex =
    right.systemTaxonomyKey === null || right.systemTaxonomyKey === undefined
      ? Number.MAX_SAFE_INTEGER
      : BUDGET_SYSTEM_NODES.findIndex(
          (node) => node.key === right.systemTaxonomyKey,
        );
  if (leftSystemIndex !== rightSystemIndex) {
    return leftSystemIndex - rightSystemIndex;
  }
  if (left.sourceOrder !== right.sourceOrder) {
    if (left.sourceOrder === null) return 1;
    if (right.sourceOrder === null) return -1;
    return left.sourceOrder - right.sourceOrder;
  }
  const category = (left.category ?? "").localeCompare(
    right.category ?? "",
    "zh-Hant",
  );
  if (category !== 0) return category;
  const name = left.name.localeCompare(right.name, "zh-Hant");
  if (name !== 0) return name;
  const createdAt = left.createdAt.getTime() - right.createdAt.getTime();
  if (createdAt !== 0 && !Number.isNaN(createdAt)) return createdAt;
  return left.id.localeCompare(right.id);
}

function itemViewModel(
  item: BudgetItemRecord,
  depth: number,
  breadcrumb: string[],
  directChildren: BudgetItemListItem["directChildren"],
  descendantCount: number,
  subtreeDeleteSnapshot: BudgetItemListItem["subtreeDeleteSnapshot"],
  rolledUpPlannedAmount: bigint,
  rolledUpActualAmount: bigint,
  rolledUpActualAmountRecorded: boolean,
  rolledUpDepositAmount: bigint,
  rolledUpDepositAmountRecorded: boolean,
  rolledUpBalanceAmount: bigint,
  rolledUpBalanceAmountRecorded: boolean,
): BudgetItemListItem {
  const sourceHierarchyPath = item.sourceHierarchyPath ?? [];
  if (
    !Array.isArray(sourceHierarchyPath) ||
    sourceHierarchyPath.length > 4 ||
    sourceHierarchyPath.some(
      (segment) =>
        typeof segment !== "string" ||
        segment.length === 0 ||
        segment !== segment.trim(),
    ) ||
    (item.source !== "NOTION" && sourceHierarchyPath.length > 0)
  ) {
    throw new BudgetItemDataError();
  }
  const attachments = item.attachments?.map((attachment) => {
    if (
      !(ALLOWED_BUDGET_ATTACHMENT_MEDIA_TYPES as readonly string[]).includes(
        attachment.mediaType,
      ) ||
      !Number.isSafeInteger(attachment.byteSize) ||
      attachment.byteSize < 1 ||
      Number.isNaN(attachment.createdAt.getTime())
    ) {
      throw new BudgetItemDataError();
    }

    return {
      id: attachment.id,
      originalName: attachment.originalName,
      mediaType: attachment.mediaType as BudgetAttachmentMediaType,
      byteSize: attachment.byteSize,
      createdAt: attachment.createdAt.toISOString(),
    };
  });

  return {
    id: item.id,
    parentId: item.parentId,
    depth,
    hasChildren: directChildren.length > 0,
    breadcrumb,
    directChildren,
    directChildCount: directChildren.length,
    directChildSetHash: fingerprintBudgetDirectChildIds(
      directChildren.map((child) => child.id),
    ),
    descendantCount,
    ...(subtreeDeleteSnapshot === undefined
      ? {}
      : { subtreeDeleteSnapshot }),
    source: item.source,
    sourceHierarchyPath: [...sourceHierarchyPath],
    name: item.name,
    kind: item.kind,
    category: item.category,
    relatedTaxonomyItemKey:
      (item.relatedTaxonomyItemKey as BudgetTaxonomyItemKey | null) ?? null,
    directParentName:
      breadcrumb.length > 1 ? breadcrumb[breadcrumb.length - 2] : null,
    ...(Object.hasOwn(item, "suggestionKey")
      ? { suggestionKey: item.suggestionKey ?? null }
      : {}),
    ...(Object.hasOwn(item, "systemTaxonomyKey")
      ? {
          systemTaxonomyKey:
            (item.systemTaxonomyKey as BudgetSystemNodeKey | null) ?? null,
        }
      : {}),
    plannedAmount: item.plannedAmount,
    rolledUpPlannedAmount: rolledUpPlannedAmount.toString(),
    actualAmount: item.actualAmount,
    rolledUpActualAmount: rolledUpActualAmount.toString(),
    rolledUpActualAmountRecorded,
    rolledUpDepositAmount: rolledUpDepositAmount.toString(),
    rolledUpDepositAmountRecorded,
    rolledUpBalanceAmount: rolledUpBalanceAmount.toString(),
    rolledUpBalanceAmountRecorded,
    dueDate: item.dueDate?.toISOString().slice(0, 10) ?? null,
    notes: item.notes,
    paid: item.paid,
    paidAt: item.paidAt?.toISOString() ?? null,
    bookingStatus: item.bookingStatus,
    depositAmount: item.depositAmount,
    balanceAmount: item.balanceAmount,
    additionalAmount: item.additionalAmount,
    estimatedRange: item.estimatedRange,
    candidateVendors: item.candidateVendors,
    confirmedVendor: item.confirmedVendor,
    vendorContact: item.vendorContact,
    primaryContact: item.primaryContact,
    version: item.version,
    ...(attachments === undefined ? {} : { attachments }),
  };
}

function hasSystemTaxonomyKey(
  item: BudgetItemRecord,
): item is BudgetItemRecord & { systemTaxonomyKey: string | null } {
  return Object.hasOwn(item, "systemTaxonomyKey");
}

function isBudgetSystemNodeKey(
  value: unknown,
): value is BudgetSystemNodeKey {
  return (
    typeof value === "string" &&
    Object.hasOwn(BUDGET_SYSTEM_NODE_BY_KEY, value)
  );
}

function validateBudgetTaxonomyContract(
  items: BudgetItemRecord[],
  byId: ReadonlyMap<string, BudgetItemRecord>,
  roots: BudgetItemRecord[],
): void {
  if (!items.every(hasSystemTaxonomyKey)) throw new BudgetItemDataError();

  const fixedByKey = new Map<BudgetSystemNodeKey, BudgetItemRecord>();
  for (const item of items) {
    const relatedTaxonomyItemKey = item.relatedTaxonomyItemKey ?? null;
    if (
      (item.kind === "GROUP" && relatedTaxonomyItemKey !== null) ||
      (relatedTaxonomyItemKey !== null &&
        !isBudgetTaxonomyItemKey(relatedTaxonomyItemKey))
    ) {
      throw new BudgetItemDataError();
    }
    const key = item.systemTaxonomyKey;
    if (key === null) continue;
    if (!isBudgetSystemNodeKey(key)) throw new BudgetItemDataError();
    const definition = BUDGET_SYSTEM_NODE_BY_KEY[key];
    if (
      item.kind !== "GROUP" ||
      item.category !== null ||
      item.name !== definition.label ||
      item.sourceOrder !== definition.sourceOrder ||
      fixedByKey.has(key)
    ) {
      throw new BudgetItemDataError();
    }
    fixedByKey.set(key, item);
  }

  if (
    fixedByKey.size !== BUDGET_SYSTEM_NODES.length ||
    BUDGET_SYSTEM_NODES.some((node) => !fixedByKey.has(node.key))
  ) {
    throw new BudgetItemDataError();
  }

  for (const definition of BUDGET_SYSTEM_NODES) {
    const fixed = fixedByKey.get(definition.key);
    if (!fixed) throw new BudgetItemDataError();
    if (definition.parentKey === null) {
      if (fixed.parentId !== null) throw new BudgetItemDataError();
    } else if (fixed.parentId !== fixedByKey.get(definition.parentKey)?.id) {
      throw new BudgetItemDataError();
    }
  }

  const expectedRootKeys = BUDGET_SYSTEM_NODES.filter(
    (node) => node.parentKey === null,
  ).map((node) => node.key);
  if (
    roots.length !== expectedRootKeys.length ||
    roots.some(
      (root) =>
        !isBudgetSystemNodeKey(root.systemTaxonomyKey) ||
        !expectedRootKeys.includes(root.systemTaxonomyKey),
    )
  ) {
    throw new BudgetItemDataError();
  }

  for (const item of items) {
    const relatedTaxonomyItemKey = item.relatedTaxonomyItemKey ?? null;
    if (item.systemTaxonomyKey !== null) continue;
    if (item.parentId === null) throw new BudgetItemDataError();

    const visited = new Set<string>([item.id]);
    let ancestor = byId.get(item.parentId);
    while (ancestor?.systemTaxonomyKey === null) {
      if (visited.has(ancestor.id) || ancestor.parentId === null) {
        throw new BudgetItemDataError();
      }
      visited.add(ancestor.id);
      ancestor = byId.get(ancestor.parentId);
    }
    if (
      !ancestor ||
      (!isBudgetTaxonomyItemKey(ancestor.systemTaxonomyKey) &&
        ancestor.systemTaxonomyKey !==
          BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY) ||
      (item.kind === "EXPENSE" &&
        isBudgetTaxonomyItemKey(ancestor.systemTaxonomyKey) &&
        (item.category !==
          BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES[
            ancestor.systemTaxonomyKey
          ] ||
          relatedTaxonomyItemKey === ancestor.systemTaxonomyKey))
    ) {
      throw new BudgetItemDataError();
    }
  }
}

function buildTree(items: BudgetItemRecord[]): BudgetItemListItem[] {
  const hasTaxonomyContract = items.some(hasSystemTaxonomyKey);
  const byId = new Map<string, BudgetItemRecord>();
  const childrenByParent = new Map<string, BudgetItemRecord[]>();
  const roots: BudgetItemRecord[] = [];

  for (const item of items) {
    if (byId.has(item.id)) throw new BudgetItemDataError();
    if (
      (item.kind === "GROUP" && item.category !== null) ||
      (item.kind === "EXPENSE" && item.category === null)
    ) {
      throw new BudgetItemDataError();
    }
    byId.set(item.id, item);
  }
  for (const item of items) {
    if (item.parentId === item.id) throw new BudgetItemDataError();
    if (item.parentId === null) {
      roots.push(item);
      continue;
    }
    if (!byId.has(item.parentId)) throw new BudgetItemDataError();
    const children = childrenByParent.get(item.parentId) ?? [];
    children.push(item);
    childrenByParent.set(item.parentId, children);
  }
  roots.sort(compareItems);
  for (const children of childrenByParent.values()) children.sort(compareItems);

  if (hasTaxonomyContract) {
    validateBudgetTaxonomyContract(items, byId, roots);
  }
  const color = new Map<string, 0 | 1 | 2>();
  const rolledPlanned = new Map<string, bigint>();
  const rolledActual = new Map<string, bigint>();
  const rolledActualRecorded = new Map<string, boolean>();
  // 訂金與尾款也要彙總，帳本那一列的四個數字才會是同一個範圍。
  const rolledDeposit = new Map<string, bigint>();
  const rolledDepositRecorded = new Map<string, boolean>();
  const rolledBalance = new Map<string, bigint>();
  const rolledBalanceRecorded = new Map<string, boolean>();
  const descendantCounts = new Map<string, number>();
  const subtreeDeleteSnapshots = new Map<
    string,
    BudgetSubtreeDeleteSnapshot
  >();

  for (const startingItem of items) {
    if (color.get(startingItem.id) === 2) continue;
    const stack: Array<{ item: BudgetItemRecord; exiting: boolean }> = [
      { item: startingItem, exiting: false },
    ];
    while (stack.length > 0) {
      const frame = stack.pop();
      if (!frame) break;
      const currentColor = color.get(frame.item.id) ?? 0;
      if (frame.exiting) {
        let planned = amountAsBigInt(frame.item.plannedAmount);
        let actual =
          frame.item.actualAmount === null
            ? BigInt(0)
            : amountAsBigInt(frame.item.actualAmount);
        let actualRecorded = frame.item.actualAmount !== null;
        let deposit =
          frame.item.depositAmount === null
            ? BigInt(0)
            : amountAsBigInt(frame.item.depositAmount);
        let depositRecorded = frame.item.depositAmount !== null;
        let balance =
          frame.item.balanceAmount === null
            ? BigInt(0)
            : amountAsBigInt(frame.item.balanceAmount);
        let balanceRecorded = frame.item.balanceAmount !== null;
        let descendantCount = 0;
        const childSubtreeSnapshots: BudgetSubtreeChildSnapshot[] = [];
        for (const child of childrenByParent.get(frame.item.id) ?? []) {
          const childPlanned = rolledPlanned.get(child.id);
          const childActual = rolledActual.get(child.id);
          const childActualRecorded = rolledActualRecorded.get(child.id);
          const childDeposit = rolledDeposit.get(child.id);
          const childDepositRecorded = rolledDepositRecorded.get(child.id);
          const childBalance = rolledBalance.get(child.id);
          const childBalanceRecorded = rolledBalanceRecorded.get(child.id);
          const childDescendantCount = descendantCounts.get(child.id);
          const childSubtreeSnapshot = subtreeDeleteSnapshots.get(child.id);
          if (
            childPlanned === undefined ||
            childActual === undefined ||
            childActualRecorded === undefined ||
            childDeposit === undefined ||
            childDepositRecorded === undefined ||
            childBalance === undefined ||
            childBalanceRecorded === undefined ||
            childDescendantCount === undefined ||
            childSubtreeSnapshot === undefined
          ) {
            throw new BudgetItemDataError();
          }
          planned += childPlanned;
          actual += childActual;
          actualRecorded ||= childActualRecorded;
          deposit += childDeposit;
          depositRecorded ||= childDepositRecorded;
          balance += childBalance;
          balanceRecorded ||= childBalanceRecorded;
          descendantCount += childDescendantCount + 1;
          childSubtreeSnapshots.push({
            id: child.id,
            ...childSubtreeSnapshot,
          });
        }
        subtreeDeleteSnapshots.set(
          frame.item.id,
          summarizeBudgetSubtreeNode(
            {
              id: frame.item.id,
              version: frame.item.version,
              source: frame.item.source,
              attachments: frame.item.attachments?.map((attachment) => ({
                id: attachment.id,
              })),
            },
            childSubtreeSnapshots,
          ),
        );
        rolledPlanned.set(frame.item.id, planned);
        rolledActual.set(frame.item.id, actual);
        rolledActualRecorded.set(frame.item.id, actualRecorded);
        rolledDeposit.set(frame.item.id, deposit);
        rolledDepositRecorded.set(frame.item.id, depositRecorded);
        rolledBalance.set(frame.item.id, balance);
        rolledBalanceRecorded.set(frame.item.id, balanceRecorded);
        descendantCounts.set(frame.item.id, descendantCount);
        color.set(frame.item.id, 2);
        continue;
      }
      if (currentColor === 1) throw new BudgetItemDataError();
      if (currentColor === 2) continue;
      color.set(frame.item.id, 1);
      stack.push({ item: frame.item, exiting: true });
      const children = childrenByParent.get(frame.item.id) ?? [];
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push({ item: children[index], exiting: false });
      }
    }
  }

  const result: BudgetItemListItem[] = [];
  const stack = roots
    .slice()
    .reverse()
    .map((item) => ({ item, depth: 0, breadcrumb: [item.name] }));
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    const children = childrenByParent.get(entry.item.id) ?? [];
    const planned = rolledPlanned.get(entry.item.id);
    const actual = rolledActual.get(entry.item.id);
    const actualRecorded = rolledActualRecorded.get(entry.item.id);
    const deposit = rolledDeposit.get(entry.item.id);
    const depositRecorded = rolledDepositRecorded.get(entry.item.id);
    const balance = rolledBalance.get(entry.item.id);
    const balanceRecorded = rolledBalanceRecorded.get(entry.item.id);
    const descendantCount = descendantCounts.get(entry.item.id);
    const subtreeSnapshot = subtreeDeleteSnapshots.get(entry.item.id);
    if (
      planned === undefined ||
      actual === undefined ||
      actualRecorded === undefined ||
      deposit === undefined ||
      depositRecorded === undefined ||
      balance === undefined ||
      balanceRecorded === undefined ||
      descendantCount === undefined ||
      subtreeSnapshot === undefined
    ) {
      throw new BudgetItemDataError();
    }
    const subtreeDeleteSnapshot =
      entry.item.kind === "GROUP" &&
      (entry.item.systemTaxonomyKey ?? null) === null &&
      descendantCount > 0
        ? subtreeSnapshot
        : undefined;
    const directChildren = children.map((child) => ({
      id: child.id,
      name: child.name,
      hasChildren: (childrenByParent.get(child.id)?.length ?? 0) > 0,
    }));
    result.push(
      itemViewModel(
        entry.item,
        entry.depth,
        entry.breadcrumb,
        directChildren,
        descendantCount,
        subtreeDeleteSnapshot,
        planned,
        actual,
        actualRecorded,
        deposit,
        depositRecorded,
        balance,
        balanceRecorded,
      ),
    );
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({
        item: children[index],
        depth: entry.depth + 1,
        breadcrumb: [...entry.breadcrumb, children[index].name],
      });
    }
  }
  if (result.length !== items.length) throw new BudgetItemDataError();
  return result;
}

function summarize(items: BudgetItemRecord[]): BudgetSummary {
  const expenseItems = items.filter((item) => item.kind === "EXPENSE");
  const balanceDueItems = expenseItems.filter(
    (item) => item.bookingStatus === "BOOKED_BALANCE_DUE",
  );
  const balanceDueDates = balanceDueItems.flatMap((item) =>
    item.dueDate === null ? [] : [item.dueDate.toISOString().slice(0, 10)],
  );

  return {
    itemCount: expenseItems.length,
    paidCount: expenseItems.reduce(
      (total, item) => total + (item.paid ? 1 : 0),
      0,
    ),
    plannedTotal: sumTwdAmounts(
      expenseItems.map((item) => item.plannedAmount),
    ),
    actualTotal: sumTwdAmounts(
      expenseItems.flatMap((item) =>
        item.actualAmount === null ? [] : [item.actualAmount],
      ),
    ),
    balanceDueTotal: sumTwdAmounts(
      balanceDueItems.flatMap((item) =>
        item.balanceAmount === null ? [] : [item.balanceAmount],
      ),
    ),
    balanceDueCount: balanceDueItems.length,
    balanceDueMissingAmountCount: balanceDueItems.reduce(
      (total, item) => total + (item.balanceAmount === null ? 1 : 0),
      0,
    ),
    nearestBalanceDueDate:
      balanceDueDates.length === 0 ? null : balanceDueDates.sort()[0],
  };
}

export async function getBudgetPageData(workspaceId: string) {
  const currentUser = await requireCurrentUser();

  let access;
  try {
    access = await requireWorkspaceAccess<
      Pick<WeddingWorkspace, "id" | "name">
    >(workspaceId, currentUser.id, "read");
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) throw error;
    throw new BudgetItemDataError();
  }

  try {
    const budgetPrisma = prisma as unknown as BudgetItemPrismaClient;
    const records = await budgetPrisma.budgetItem.findMany({
      where: { workspaceId },
      orderBy: deterministicOrder,
      select: budgetItemSelect,
    });
    const permissions = getWorkspacePermissions(access.role);
    const resetSnapshot: BudgetResetSnapshot | null = permissions.canManageMembers
      ? summarizeBudgetResetSnapshot(
          records
            .filter((item) => (item.systemTaxonomyKey ?? null) === null)
            .map((item) => ({
              id: item.id,
              version: item.version,
              source: item.source,
              attachments: item.attachments?.map((attachment) => ({
                id: attachment.id,
              })),
            })),
        )
      : null;

    return {
      workspaceName: access.workspace.name,
      canEdit: permissions.canEdit,
      canResetBudget: permissions.canManageMembers,
      resetSnapshot,
      items: buildTree(records),
      summary: summarize(records),
    };
  } catch {
    throw new BudgetItemDataError();
  }
}
