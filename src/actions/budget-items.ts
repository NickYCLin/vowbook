"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  BUDGET_BOOKING_STATUS_LABELS,
  BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
  BUDGET_SYSTEM_NODE_BY_KEY,
  BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES,
  BUDGET_TAXONOMY_NODE_BY_KEY,
  BudgetItemValidationError,
  isBudgetTaxonomyItemKey,
  normalizeBudgetGroupDetails,
  normalizeBudgetItemDetails,
  normalizeBudgetTaxonomyItemKey,
  normalizeOptionalBudgetTaxonomyItemKey,
  normalizeRelatedBudgetTaxonomyItemKey,
  type BudgetCostCategory,
  type BudgetBookingStatus,
  type BudgetItemKind,
  type BudgetTaxonomyItemKey,
  type BudgetSystemNodeKey,
  type NormalizedBudgetItemDetails,
} from "@/domain/budget-item";
import {
  BUDGET_ENGAGEMENT_PRESET_GROUPS,
  type BudgetEngagementSuggestionKey,
} from "@/domain/budget-engagement-preset";
import {
  BUDGET_PREPARATION_PRESET_GROUPS,
  type BudgetPreparationSuggestionKey,
} from "@/domain/budget-preparation-preset";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import {
  normalizeWorkspaceDeletionConfirmation,
  normalizeWorkspaceName,
} from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";

import { runSerializableTransaction } from "@/lib/serializable-transaction";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";
import { fingerprintBudgetDirectChildIds } from "@/lib/budget-direct-child-set";
import {
  summarizeBudgetResetSnapshot,
  summarizeBudgetSubtreeSnapshot,
  type BudgetResetSnapshotRow,
} from "@/lib/budget-reset-snapshot";

export type BudgetItemMutationCode =
  "VALIDATION" | "FORBIDDEN" | "STALE" | "UNAVAILABLE";

export type BudgetItemMutationState = {
  status: "idle" | "success" | "error";
  code?: BudgetItemMutationCode;
  message?: string;
};

type CountResult = { count: number };
type BudgetSubtreeSnapshotRow = BudgetResetSnapshotRow & {
  parentId: string | null;
  name: string;
  kind: BudgetItemKind;
  systemTaxonomyKey: string | null;
};
type EditableBudgetItemDetails = Omit<
  NormalizedBudgetItemDetails,
  "bookingStatus"
>;
type BudgetEngagementSuggestionDefinition = {
  key: BudgetEngagementSuggestionKey;
  taxonomyItemKey: BudgetTaxonomyItemKey;
  name: string;
  notes?: string;
};

const BUDGET_ENGAGEMENT_SUGGESTION_BY_KEY: ReadonlyMap<
  BudgetEngagementSuggestionKey,
  BudgetEngagementSuggestionDefinition
> = new Map(
  BUDGET_ENGAGEMENT_PRESET_GROUPS.flatMap((group) =>
    group.items.map((item) => [
      item.key,
      { ...item, taxonomyItemKey: group.taxonomyItemKey },
    ]),
  ),
);

type BudgetPreparationSuggestionDefinition = {
  key: BudgetPreparationSuggestionKey;
  taxonomyItemKey: BudgetTaxonomyItemKey;
  name: string;
  notes?: string;
};

const BUDGET_PREPARATION_SUGGESTION_BY_KEY: ReadonlyMap<
  BudgetPreparationSuggestionKey,
  BudgetPreparationSuggestionDefinition
> = new Map(
  BUDGET_PREPARATION_PRESET_GROUPS.flatMap((group) =>
    group.items.map((item) => [item.key, item]),
  ),
);

type BudgetItemPrismaClient = {
  $executeRaw(query: unknown): Promise<number>;
  $queryRaw<Result = unknown>(query: unknown): Promise<Result>;
  budgetItem: {
    create(args: unknown): Promise<unknown>;
    createMany(args: unknown): Promise<CountResult>;
    findFirst(args: unknown): Promise<{
      id?: string;
      parentId?: string | null;
      category?: BudgetCostCategory | null;
      systemTaxonomyKey?: string | null;
      kind?: BudgetItemKind;
      bookingStatus?: BudgetBookingStatus;
      children?: Array<{ id: string }>;
    } | null>;
    findMany<Result = BudgetResetSnapshotRow[]>(args: unknown): Promise<Result>;
    updateMany(args: unknown): Promise<CountResult>;
    deleteMany(args: unknown): Promise<CountResult>;
  };
  weddingWorkspace: {
    findFirst(args: unknown): Promise<{ name: string } | null>;
  };
};

class BudgetGroupDissolveConflictError extends Error {
  constructor() {
    super("Budget GROUP dissolve CAS conflict.");
    this.name = "BudgetGroupDissolveConflictError";
  }
}

class BudgetResetConflictError extends Error {
  constructor() {
    super("Budget reset snapshot conflict.");
    this.name = "BudgetResetConflictError";
  }
}

class BudgetGroupSubtreeDeleteConflictError extends Error {
  constructor() {
    super("Budget GROUP subtree delete snapshot conflict.");
    this.name = "BudgetGroupSubtreeDeleteConflictError";
  }
}

async function runLockedBudgetTransaction<Result>(
  workspaceId: string,
  currentUserId: string,
  operation: (transaction: BudgetItemPrismaClient) => Promise<Result>,
): Promise<Result> {
  return runSerializableTransaction(async (transaction) => {
    await requireLockedWorkspaceAccess(
      workspaceId,
      currentUserId,
      "edit",
      transaction,
    );
    return operation(transaction as unknown as BudgetItemPrismaClient);
  });
}

function budgetPath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/budget`;
}

async function revalidateBudgetView(workspaceId: string): Promise<boolean> {
  try {
    await revalidatePath(budgetPath(workspaceId));
    return true;
  } catch {
    console.error("婚禮花費頁面重新驗證失敗。");
    return false;
  }
}

function successAfterRevalidation(
  message: string,
  revalidated: boolean,
): BudgetItemMutationState {
  return {
    status: "success",
    message: revalidated
      ? message
      : `${message.replace(/。$/u, "")}；畫面未自動更新，請重新整理。`,
  };
}

function validationState(error: unknown): BudgetItemMutationState {
  return {
    status: "error",
    code: "VALIDATION",
    message:
      error instanceof BudgetItemValidationError
        ? error.message
        : "輸入內容有誤，請重新確認。",
  };
}

function unavailableState(message: string): BudgetItemMutationState {
  return { status: "error", code: "UNAVAILABLE", message };
}

function authorizationFailureState(
  error: unknown,
): BudgetItemMutationState | null {
  return error instanceof WorkspaceAccessDeniedError
    ? { status: "error", code: "FORBIDDEN", message: error.message }
    : null;
}

function staleState(): BudgetItemMutationState {
  return {
    status: "error",
    code: "STALE",
    message: "資料已更新或不存在，請重新整理後再試。",
  };
}

async function authorizeBudgetMutation(
  workspaceId: string,
): Promise<BudgetItemMutationState | string> {
  const currentUser = await requireCurrentUser();

  try {
    await requireWorkspaceAccess(workspaceId, currentUser.id, "edit");
    return currentUser.id;
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return {
        status: "error",
        code: "FORBIDDEN",
        message: error.message,
      };
    }

    return unavailableState("目前無法確認工作區權限，請稍後再試。");
  }
}

function detailsFromFormData(
  formData: FormData,
  category: BudgetCostCategory,
): EditableBudgetItemDetails {
  const { bookingStatus, ...details } = normalizeBudgetItemDetails({
    name: formData.get("name"),
    category,
    plannedAmount: formData.get("plannedAmount"),
    actualAmount: formData.get("actualAmount"),
    dueDate: formData.get("dueDate"),
    notes: formData.get("notes"),
    depositAmount: formData.get("depositAmount"),
    balanceAmount: formData.get("balanceAmount"),
    additionalAmount: formData.get("additionalAmount"),
    estimatedRange: formData.get("estimatedRange"),
    candidateVendors: formData.get("candidateVendors"),
    confirmedVendor: formData.get("confirmedVendor"),
    vendorContact: formData.get("vendorContact"),
    primaryContact: formData.get("primaryContact"),
  });
  void bookingStatus;
  return details;
}

function expectedVersionFromFormData(formData: FormData): number {
  const value = formData.get("expectedVersion");
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    throw new BudgetItemValidationError("版本資訊無效，請重新整理後再試。");
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 2_147_483_647) {
    throw new BudgetItemValidationError("版本資訊無效，請重新整理後再試。");
  }

  return parsed;
}

function expectedDirectChildSetHashFromFormData(formData: FormData): string {
  const value = formData.get("expectedDirectChildSetHash");
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new BudgetItemValidationError(
      "群組內容確認資訊無效，請重新整理後再試。",
    );
  }
  return value;
}

function resetSnapshotTokenFromFormData(formData: FormData): string {
  const value = formData.get("expectedResetSnapshotToken");
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new BudgetItemValidationError(
      "花費資料確認資訊無效，請重新整理後再試。",
    );
  }
  return value;
}

function subtreeSnapshotTokenFromFormData(formData: FormData): string {
  const value = formData.get("expectedSubtreeSnapshotToken");
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new BudgetItemValidationError(
      "群組內容確認資訊無效，請重新整理後再試。",
    );
  }
  return value;
}

function groupDeletionConfirmationFromFormData(formData: FormData): string {
  return normalizeBudgetGroupDetails({
    name: formData.get("confirmationName"),
  }).name;
}

function engagementSuggestionKeysFromFormData(
  formData: FormData,
): BudgetEngagementSuggestionKey[] {
  const values = formData.getAll("suggestionKey");
  if (values.length === 0) {
    throw new BudgetItemValidationError("請至少選擇一個文定建議項目。");
  }

  const keys: BudgetEngagementSuggestionKey[] = [];
  const seen = new Set<BudgetEngagementSuggestionKey>();
  for (const value of values) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.trim() !== value
    ) {
      throw new BudgetItemValidationError("文定建議項目無效，請重新選擇。");
    }
    const key = value as BudgetEngagementSuggestionKey;
    if (!BUDGET_ENGAGEMENT_SUGGESTION_BY_KEY.has(key)) {
      throw new BudgetItemValidationError("文定建議項目無效，請重新選擇。");
    }
    if (seen.has(key)) {
      throw new BudgetItemValidationError("文定建議項目不可重複選擇。");
    }
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function preparationSuggestionKeysFromFormData(
  formData: FormData,
): BudgetPreparationSuggestionKey[] {
  const values = formData.getAll("suggestionKey");
  if (values.length === 0) {
    throw new BudgetItemValidationError(
      "請至少選擇一個常見婚禮建議項目。",
    );
  }

  const keys: BudgetPreparationSuggestionKey[] = [];
  const seen = new Set<BudgetPreparationSuggestionKey>();
  for (const value of values) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.trim() !== value
    ) {
      throw new BudgetItemValidationError(
        "常見婚禮建議項目無效，請重新選擇。",
      );
    }
    const key = value as BudgetPreparationSuggestionKey;
    if (!BUDGET_PREPARATION_SUGGESTION_BY_KEY.has(key)) {
      throw new BudgetItemValidationError(
        "常見婚禮建議項目無效，請重新選擇。",
      );
    }
    if (seen.has(key)) {
      throw new BudgetItemValidationError(
        "常見婚禮建議項目不可重複選擇。",
      );
    }
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function preparedSnapshotConfirmationFromFormData(formData: FormData): void {
  if (formData.get("preparedSnapshot") !== "READY") {
    throw new BudgetItemValidationError(
      "請先備妥可重新匯入的 Notion snapshot。",
    );
  }
}

function bookingStatusFromFormData(formData: FormData): BudgetBookingStatus {
  const value = formData.get("bookingStatus");
  if (
    typeof value !== "string" ||
    !Object.hasOwn(BUDGET_BOOKING_STATUS_LABELS, value)
  ) {
    throw new BudgetItemValidationError("請選擇有效的下訂與付款狀態。");
  }
  return value as BudgetBookingStatus;
}

function targetParentIdFromFormData(formData: FormData): string | null {
  const value = formData.get("targetParentId");
  if (typeof value !== "string") {
    throw new BudgetItemValidationError("請選擇有效的上層位置。");
  }
  const normalized = value.trim();
  if (normalized === "") return null;
  if (normalized.length > 191) {
    throw new BudgetItemValidationError("請選擇有效的上層位置。");
  }
  return normalized;
}

function boundParentId(parentId: string | null): string | null {
  if (parentId === null) return null;
  if (
    typeof parentId !== "string" ||
    parentId.length < 1 ||
    parentId.length > 191 ||
    parentId.trim() !== parentId
  ) {
    throw new BudgetItemValidationError("請選擇有效的上層位置。");
  }
  return parentId;
}

function isForeignKeyFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2003"
  );
}

async function fixedTaxonomyItemGroupId(
  transaction: BudgetItemPrismaClient,
  workspaceId: string,
  taxonomyItemKey: BudgetTaxonomyItemKey,
): Promise<string> {
  const definition = BUDGET_TAXONOMY_NODE_BY_KEY[taxonomyItemKey];
  const group = await transaction.budgetItem.findFirst({
    where: {
      workspaceId,
      kind: "GROUP",
      systemTaxonomyKey: taxonomyItemKey,
      parent: {
        workspaceId,
        systemTaxonomyKey: definition.parentKey,
      },
    },
    select: { id: true },
  });
  if (group?.id === undefined) {
    throw new BudgetItemValidationError("指定的品項分類不存在或無法使用。");
  }
  return group.id;
}

async function hierarchyTaxonomyItem(
  transaction: BudgetItemPrismaClient,
  workspaceId: string,
  itemId: string,
  allowInternal = false,
): Promise<{
  key:
    | BudgetTaxonomyItemKey
    | typeof BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY;
  category: BudgetCostCategory;
}> {
  const taxonomyNodes = await transaction.$queryRaw<
    Array<{ taxonomyKey: string }>
  >(
    Prisma.sql`
      WITH RECURSIVE "ancestors" AS (
        SELECT "id", "parent_id", "system_taxonomy_key"
        FROM "budget_items"
        WHERE "id" = ${itemId}
          AND "workspace_id" = ${workspaceId}
        UNION ALL
        SELECT "parent"."id", "parent"."parent_id", "parent"."system_taxonomy_key"
        FROM "budget_items" AS "parent"
        INNER JOIN "ancestors" AS "child"
          ON "child"."parent_id" = "parent"."id"
        WHERE "parent"."workspace_id" = ${workspaceId}
      )
      SELECT "system_taxonomy_key" AS "taxonomyKey"
      FROM "ancestors"
      WHERE "system_taxonomy_key" IS NOT NULL
    `,
  );
  const itemKeys = taxonomyNodes
    .map((node) => node.taxonomyKey)
    .filter(
      (
        key,
      ): key is
        | BudgetTaxonomyItemKey
        | typeof BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY =>
        isBudgetTaxonomyItemKey(key) ||
        key === BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
    );
  if (itemKeys.length !== 1) {
    throw new BudgetItemValidationError("指定的上層項目不存在或無法使用。");
  }
  const key = itemKeys[0];
  if (!allowInternal && !isBudgetTaxonomyItemKey(key)) {
    throw new BudgetItemValidationError("指定的上層項目不存在或無法使用。");
  }
  const expectedStageKey =
    BUDGET_SYSTEM_NODE_BY_KEY[key as BudgetSystemNodeKey].parentKey;
  if (
    taxonomyNodes.length !== 2 ||
    taxonomyNodes.filter((node) => node.taxonomyKey === key).length !== 1 ||
    taxonomyNodes.filter((node) => node.taxonomyKey === expectedStageKey)
      .length !== 1
  ) {
    throw new BudgetItemValidationError("指定的上層項目不存在或無法使用。");
  }
  return {
    key,
    category: isBudgetTaxonomyItemKey(key)
      ? BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES[key]
      : "OTHER_PENDING",
  };
}

async function returnStaleAfterRevalidation(
  workspaceId: string,
): Promise<BudgetItemMutationState> {
  await revalidateBudgetView(workspaceId);
  return staleState();
}

export async function addBudgetEngagementSuggestionsAction(
  workspaceId: string,
  _previousState: BudgetItemMutationState,
  formData: FormData,
): Promise<BudgetItemMutationState> {
  const authorization = await authorizeBudgetMutation(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  let suggestionKeys: BudgetEngagementSuggestionKey[];
  try {
    suggestionKeys = engagementSuggestionKeysFromFormData(formData);
  } catch (error) {
    return validationState(error);
  }

  let createdCount: number;
  try {
    const result = await runLockedBudgetTransaction(
      workspaceId,
      currentUserId,
      async (transaction) => {
        const suggestions = suggestionKeys.map((key) => {
          const suggestion = BUDGET_ENGAGEMENT_SUGGESTION_BY_KEY.get(key);
          if (!suggestion) {
            throw new BudgetItemValidationError(
              "文定建議項目無效，請重新選擇。",
            );
          }
          return suggestion;
        });
        const parentIds = new Map<BudgetTaxonomyItemKey, string>();
        for (const taxonomyItemKey of new Set(
          suggestions.map((suggestion) => suggestion.taxonomyItemKey),
        )) {
          parentIds.set(
            taxonomyItemKey,
            await fixedTaxonomyItemGroupId(
              transaction,
              workspaceId,
              taxonomyItemKey,
            ),
          );
        }

        const data = suggestions.map((suggestion) => {
          const parentId = parentIds.get(suggestion.taxonomyItemKey);
          if (parentId === undefined) {
            throw new BudgetItemValidationError(
              "指定的品項分類不存在或無法使用。",
            );
          }
          return {
            workspaceId,
            parentId,
            source: "MANUAL" as const,
            externalId: null,
            sourceHash: null,
            sourceOrder: null,
            sourceHierarchyPath: [],
            name: suggestion.name,
            kind: "EXPENSE" as const,
            category:
              BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES[
                suggestion.taxonomyItemKey
              ],
            legacyCategory: null,
            plannedAmount: 0,
            systemTaxonomyKey: null,
            relatedTaxonomyItemKey: null,
            suggestionKey: suggestion.key,
            actualAmount: null,
            dueDate: null,
            notes: suggestion.notes ?? null,
            paid: false,
            paidAt: null,
            bookingStatus: "PLANNING" as const,
            depositAmount: null,
            balanceAmount: null,
            additionalAmount: null,
            estimatedRange: null,
            candidateVendors: null,
            confirmedVendor: null,
            vendorContact: null,
            primaryContact: null,
          };
        });

        return transaction.budgetItem.createMany({
          data,
          skipDuplicates: true,
        });
      },
    );
    createdCount = result.count;
  } catch (error) {
    const authorizationFailure = authorizationFailureState(error);
    if (authorizationFailure) return authorizationFailure;
    if (error instanceof BudgetItemValidationError) {
      return validationState(error);
    }
    return unavailableState("目前無法新增文定建議項目，請稍後再試。");
  }

  const message =
    createdCount === 0
      ? "所選文定建議項目已存在。"
      : createdCount === suggestionKeys.length
        ? "已新增 " + createdCount + " 筆文定建議項目。"
        : "已新增 " + createdCount + " 筆文定建議項目；其餘已存在。";
  return successAfterRevalidation(
    message,
    await revalidateBudgetView(workspaceId),
  );
}

export async function addBudgetPreparationSuggestionsAction(
  workspaceId: string,
  _previousState: BudgetItemMutationState,
  formData: FormData,
): Promise<BudgetItemMutationState> {
  const authorization = await authorizeBudgetMutation(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  let suggestionKeys: BudgetPreparationSuggestionKey[];
  try {
    suggestionKeys = preparationSuggestionKeysFromFormData(formData);
  } catch (error) {
    return validationState(error);
  }

  let createdCount: number;
  try {
    const result = await runLockedBudgetTransaction(
      workspaceId,
      currentUserId,
      async (transaction) => {
        const suggestions = suggestionKeys.map((key) => {
          const suggestion = BUDGET_PREPARATION_SUGGESTION_BY_KEY.get(key);
          if (!suggestion) {
            throw new BudgetItemValidationError(
              "常見婚禮建議項目無效，請重新選擇。",
            );
          }
          return suggestion;
        });
        const parentIds = new Map<BudgetTaxonomyItemKey, string>();
        for (const taxonomyItemKey of new Set(
          suggestions.map((suggestion) => suggestion.taxonomyItemKey),
        )) {
          parentIds.set(
            taxonomyItemKey,
            await fixedTaxonomyItemGroupId(
              transaction,
              workspaceId,
              taxonomyItemKey,
            ),
          );
        }

        const data = suggestions.map((suggestion) => {
          const parentId = parentIds.get(suggestion.taxonomyItemKey);
          if (parentId === undefined) {
            throw new BudgetItemValidationError(
              "指定的品項分類不存在或無法使用。",
            );
          }
          return {
            workspaceId,
            parentId,
            source: "MANUAL" as const,
            externalId: null,
            sourceHash: null,
            sourceOrder: null,
            sourceHierarchyPath: [],
            name: suggestion.name,
            kind: "EXPENSE" as const,
            category:
              BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES[
                suggestion.taxonomyItemKey
              ],
            legacyCategory: null,
            plannedAmount: 0,
            systemTaxonomyKey: null,
            relatedTaxonomyItemKey: null,
            suggestionKey: suggestion.key,
            actualAmount: null,
            dueDate: null,
            notes: suggestion.notes ?? null,
            paid: false,
            paidAt: null,
            bookingStatus: "PLANNING" as const,
            depositAmount: null,
            balanceAmount: null,
            additionalAmount: null,
            estimatedRange: null,
            candidateVendors: null,
            confirmedVendor: null,
            vendorContact: null,
            primaryContact: null,
          };
        });

        return transaction.budgetItem.createMany({
          data,
          skipDuplicates: true,
        });
      },
    );
    createdCount = result.count;
  } catch (error) {
    const authorizationFailure = authorizationFailureState(error);
    if (authorizationFailure) return authorizationFailure;
    if (error instanceof BudgetItemValidationError) {
      return validationState(error);
    }
    return unavailableState(
      "目前無法新增常見婚禮建議項目，請稍後再試。",
    );
  }

  const message =
    createdCount === 0
      ? "所選常見婚禮建議項目已存在。"
      : createdCount === suggestionKeys.length
        ? "已新增 " + createdCount + " 筆常見婚禮建議項目。"
        : "已新增 " + createdCount +
          " 筆常見婚禮建議項目；其餘已存在。";
  return successAfterRevalidation(
    message,
    await revalidateBudgetView(workspaceId),
  );
}

export async function createBudgetGroupAction(
  workspaceId: string,
  parentId: string | null,
  _previousState: BudgetItemMutationState,
  formData: FormData,
): Promise<BudgetItemMutationState> {
  const authorization = await authorizeBudgetMutation(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  let name: string;
  let normalizedParentId: string | null;
  let taxonomyItemKey: BudgetTaxonomyItemKey | null;
  try {
    ({ name } = normalizeBudgetGroupDetails({ name: formData.get("name") }));
    normalizedParentId = boundParentId(parentId);
    taxonomyItemKey =
      normalizedParentId === null
        ? normalizeBudgetTaxonomyItemKey(formData.get("taxonomyItemKey"))
        : null;
  } catch (error) {
    return validationState(error);
  }

  try {
    await runLockedBudgetTransaction(
      workspaceId,
      currentUserId,
      async (transaction) => {
        const resolvedParentId =
          normalizedParentId === null
            ? await fixedTaxonomyItemGroupId(
                transaction,
                workspaceId,
                taxonomyItemKey as BudgetTaxonomyItemKey,
              )
            : normalizedParentId;
        if (normalizedParentId !== null) {
          await hierarchyTaxonomyItem(
            transaction,
            workspaceId,
            normalizedParentId,
          );
        }
        await transaction.budgetItem.create({
          data: {
            workspaceId,
            parentId: resolvedParentId,
            kind: "GROUP",
            source: "MANUAL",
            externalId: null,
            sourceHash: null,
            sourceOrder: null,
            name,
            category: null,
            systemTaxonomyKey: null,
            legacyCategory: null,
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
          },
        });
      },
    );
  } catch (error) {
    const authorizationFailure = authorizationFailureState(error);
    if (authorizationFailure) return authorizationFailure;
    if (
      normalizedParentId !== null &&
      ((error instanceof BudgetItemValidationError &&
        error.message === "指定的上層項目不存在或無法使用。") ||
        isForeignKeyFailure(error))
    ) {
      return unavailableState("指定的上層項目不存在或無法使用。");
    }
    return unavailableState("目前無法建立群組，請稍後再試。");
  }

  return successAfterRevalidation(
    "已建立群組。",
    await revalidateBudgetView(workspaceId),
  );
}

export async function updateBudgetGroupAction(
  workspaceId: string,
  itemId: string,
  _previousState: BudgetItemMutationState,
  formData: FormData,
): Promise<BudgetItemMutationState> {
  const authorization = await authorizeBudgetMutation(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  let name: string;
  let expectedVersion: number;
  try {
    ({ name } = normalizeBudgetGroupDetails({ name: formData.get("name") }));
    expectedVersion = expectedVersionFromFormData(formData);
  } catch (error) {
    return validationState(error);
  }

  let result: CountResult;
  try {
    result = await runLockedBudgetTransaction(
      workspaceId,
      currentUserId,
      (transaction) =>
        transaction.budgetItem.updateMany({
          where: {
            id: itemId,
            workspaceId,
            version: expectedVersion,
            kind: "GROUP",
            systemTaxonomyKey: null,
          },
          data: { name, version: { increment: 1 } },
        }),
    );
  } catch (error) {
    const authorizationFailure = authorizationFailureState(error);
    if (authorizationFailure) return authorizationFailure;
    return unavailableState("目前無法更新群組，請稍後再試。");
  }

  if (result.count === 0) {
    return returnStaleAfterRevalidation(workspaceId);
  }
  return successAfterRevalidation(
    "已更新群組。",
    await revalidateBudgetView(workspaceId),
  );
}

export async function createBudgetItemAction(
  workspaceId: string,
  _previousState: BudgetItemMutationState,
  formData: FormData,
): Promise<BudgetItemMutationState> {
  const authorization = await authorizeBudgetMutation(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  let details: EditableBudgetItemDetails;
  let taxonomyItemKey: BudgetTaxonomyItemKey;
  let relatedTaxonomyItemKey: BudgetTaxonomyItemKey | null;
  try {
    taxonomyItemKey = normalizeBudgetTaxonomyItemKey(
      formData.get("taxonomyItemKey"),
    );
    relatedTaxonomyItemKey = normalizeRelatedBudgetTaxonomyItemKey(
      formData.get("relatedTaxonomyItemKey"),
      taxonomyItemKey,
    );
    details = detailsFromFormData(
      formData,
      BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES[taxonomyItemKey],
    );
  } catch (error) {
    return validationState(error);
  }

  try {
    await runLockedBudgetTransaction(
      workspaceId,
      currentUserId,
      async (transaction) => {
        const taxonomyParentId = await fixedTaxonomyItemGroupId(
          transaction,
          workspaceId,
          taxonomyItemKey,
        );
        await transaction.budgetItem.create({
          data: {
            workspaceId,
            parentId: taxonomyParentId,
            kind: "EXPENSE",
            source: "MANUAL",
            externalId: null,
            sourceHash: null,
            sourceOrder: null,
            ...details,
            relatedTaxonomyItemKey,
            systemTaxonomyKey: null,
            actualAmount: null,
            bookingStatus: "PLANNING",
            paid: false,
            paidAt: null,
          },
        });
      },
    );
  } catch (error) {
    const authorizationFailure = authorizationFailureState(error);
    if (authorizationFailure) return authorizationFailure;
    return unavailableState("目前無法新增花費項目，請稍後再試。");
  }

  return successAfterRevalidation(
    "已新增花費項目。",
    await revalidateBudgetView(workspaceId),
  );
}

export async function createChildBudgetItemAction(
  workspaceId: string,
  parentId: string,
  _previousState: BudgetItemMutationState,
  formData: FormData,
): Promise<BudgetItemMutationState> {
  const authorization = await authorizeBudgetMutation(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  let details: EditableBudgetItemDetails;
  let relatedTaxonomyItemKeyInput: BudgetTaxonomyItemKey | null;
  try {
    details = detailsFromFormData(formData, "OTHER_PENDING");
    relatedTaxonomyItemKeyInput = normalizeOptionalBudgetTaxonomyItemKey(
      formData.get("relatedTaxonomyItemKey"),
    );
  } catch (error) {
    return validationState(error);
  }

  try {
    await runLockedBudgetTransaction(
      workspaceId,
      currentUserId,
      async (transaction) => {
        const parentTaxonomy = await hierarchyTaxonomyItem(
          transaction,
          workspaceId,
          parentId,
        );
        if (!isBudgetTaxonomyItemKey(parentTaxonomy.key)) {
          throw new BudgetItemValidationError(
            "指定的上層項目不存在或無法使用。",
          );
        }
        const relatedTaxonomyItemKey = normalizeRelatedBudgetTaxonomyItemKey(
          relatedTaxonomyItemKeyInput,
          parentTaxonomy.key,
        );
        await transaction.budgetItem.create({
          data: {
            workspaceId,
            parentId,
            kind: "EXPENSE",
            source: "MANUAL",
            externalId: null,
            sourceHash: null,
            sourceOrder: null,
            ...details,
            category: parentTaxonomy.category,
            relatedTaxonomyItemKey,
            systemTaxonomyKey: null,
            actualAmount: null,
            bookingStatus: "PLANNING",
            paid: false,
            paidAt: null,
          },
        });
      },
    );
  } catch (error) {
    const authorizationFailure = authorizationFailureState(error);
    if (authorizationFailure) return authorizationFailure;
    if (
      (error instanceof BudgetItemValidationError &&
        error.message === "指定的上層項目不存在或無法使用。") ||
      isForeignKeyFailure(error)
    ) {
      return unavailableState("指定的上層項目不存在或無法使用。");
    }
    if (error instanceof BudgetItemValidationError) {
      return validationState(error);
    }
    return unavailableState("目前無法新增花費項目，請稍後再試。");
  }

  return successAfterRevalidation(
    "已在指定項目下新增花費。",
    await revalidateBudgetView(workspaceId),
  );
}

export async function updateBudgetItemAction(
  workspaceId: string,
  itemId: string,
  _previousState: BudgetItemMutationState,
  formData: FormData,
): Promise<BudgetItemMutationState> {
  const authorization = await authorizeBudgetMutation(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  let details: EditableBudgetItemDetails;
  let expectedVersion: number;
  let taxonomyItemKey: BudgetTaxonomyItemKey;
  let relatedTaxonomyItemKey: BudgetTaxonomyItemKey | null;
  try {
    taxonomyItemKey = normalizeBudgetTaxonomyItemKey(
      formData.get("taxonomyItemKey"),
    );
    relatedTaxonomyItemKey = normalizeRelatedBudgetTaxonomyItemKey(
      formData.get("relatedTaxonomyItemKey"),
      taxonomyItemKey,
    );
    details = detailsFromFormData(
      formData,
      BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES[taxonomyItemKey],
    );
    expectedVersion = expectedVersionFromFormData(formData);
  } catch (error) {
    return validationState(error);
  }

  let result: CountResult;
  try {
    result = await runLockedBudgetTransaction(
      workspaceId,
      currentUserId,
      async (transaction) => {
        const authoritativeItem = await transaction.budgetItem.findFirst({
          where: {
            id: itemId,
            workspaceId,
            version: expectedVersion,
            kind: "EXPENSE",
          },
          select: {
            bookingStatus: true,
            parentId: true,
            category: true,
            children: { take: 1, select: { id: true } },
          },
        });
        if (
          authoritativeItem === null ||
          authoritativeItem.bookingStatus === undefined
        ) {
          return { count: 0 };
        }
        const currentTaxonomy = await hierarchyTaxonomyItem(
          transaction,
          workspaceId,
          itemId,
          true,
        );
        const isChangingTaxonomy = taxonomyItemKey !== currentTaxonomy.key;
        if (
          isChangingTaxonomy &&
          authoritativeItem.children !== undefined &&
          authoritativeItem.children.length > 0
        ) {
          throw new BudgetItemValidationError(
            "有下層項目的花費無法直接變更品項分類，請先整理下層項目。",
          );
        }
        const targetParentId =
          !isChangingTaxonomy
            ? authoritativeItem.parentId
            : await fixedTaxonomyItemGroupId(
                transaction,
                workspaceId,
                taxonomyItemKey,
              );

        const actualAmount =
          authoritativeItem.bookingStatus === "PLANNING"
            ? null
            : authoritativeItem.bookingStatus === "BOOKED_BALANCE_DUE"
              ? details.depositAmount
              : details.plannedAmount;

        return transaction.budgetItem.updateMany({
          where: {
            id: itemId,
            workspaceId,
            version: expectedVersion,
            kind: "EXPENSE",
          },
          data: {
            ...details,
            parentId: targetParentId,
            relatedTaxonomyItemKey,
            actualAmount,
            version: { increment: 1 },
          },
        });
      },
    );
  } catch (error) {
    const authorizationFailure = authorizationFailureState(error);
    if (authorizationFailure) return authorizationFailure;
    if (
      error instanceof BudgetItemValidationError &&
      error.message ===
        "有下層項目的花費無法直接變更品項分類，請先整理下層項目。"
    ) {
      return validationState(error);
    }
    return unavailableState("目前無法更新花費項目，請稍後再試。");
  }

  if (result.count === 0) {
    return returnStaleAfterRevalidation(workspaceId);
  }

  return successAfterRevalidation(
    "已更新花費項目。",
    await revalidateBudgetView(workspaceId),
  );
}

export async function changeBudgetItemBookingStatusAction(
  workspaceId: string,
  itemId: string,
  _previousState: BudgetItemMutationState,
  formData: FormData,
): Promise<BudgetItemMutationState> {
  const authorization = await authorizeBudgetMutation(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  let targetStatus: BudgetBookingStatus;
  let expectedVersion: number;
  try {
    targetStatus = bookingStatusFromFormData(formData);
    expectedVersion = expectedVersionFromFormData(formData);
  } catch (error) {
    return validationState(error);
  }

  let count: number;
  try {
    const targetPaid = targetStatus === "PAID";
    const paidAtForNewTransition = new Date();
    count = await runLockedBudgetTransaction(
      workspaceId,
      currentUserId,
      (transaction) =>
        transaction.$executeRaw(
          Prisma.sql`
        UPDATE "budget_items"
        SET
          "booking_status" = CAST(${targetStatus} AS "BudgetBookingStatus"),
          "paid" = ${targetPaid},
          "actual_amount" = CASE CAST(${targetStatus} AS "BudgetBookingStatus")
            WHEN 'PLANNING' THEN NULL
            WHEN 'BOOKED_BALANCE_DUE' THEN "deposit_amount"
            WHEN 'PAID' THEN "planned_amount"
          END,
          "paid_at" = CASE
            WHEN CAST(${targetStatus} AS "BudgetBookingStatus") <> 'PAID' THEN NULL
            WHEN "booking_status" = 'PAID' THEN "paid_at"
            ELSE ${paidAtForNewTransition}
          END,
          "version" = "version" + 1,
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${itemId}
          AND "workspace_id" = ${workspaceId}
          AND "version" = ${expectedVersion}
          AND "kind" = 'EXPENSE'
          `,
        ),
    );
  } catch (error) {
    const authorizationFailure = authorizationFailureState(error);
    if (authorizationFailure) return authorizationFailure;
    return unavailableState("目前無法更新付款狀態，請稍後再試。");
  }

  if (count === 0) {
    return returnStaleAfterRevalidation(workspaceId);
  }

  return successAfterRevalidation(
    "已更新付款狀態。",
    await revalidateBudgetView(workspaceId),
  );
}

export async function moveBudgetItemAction(
  workspaceId: string,
  itemId: string,
  _previousState: BudgetItemMutationState,
  formData: FormData,
): Promise<BudgetItemMutationState> {
  const authorization = await authorizeBudgetMutation(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  let expectedVersion: number;
  let targetParentId: string | null;
  try {
    expectedVersion = expectedVersionFromFormData(formData);
    targetParentId = targetParentIdFromFormData(formData);
  } catch (error) {
    return validationState(error);
  }

  let count: number;
  try {
    count = await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        currentUserId,
        "edit",
        transaction,
      );
      // Both interactive and operator hierarchy writes share this workspace lock
      // and Serializable retry boundary. A waiter with an old snapshot is forced
      // through SSI retry before it can commit a reciprocal move.
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}, 0::bigint))`,
      );
      return transaction.$executeRaw(
        Prisma.sql`
        WITH RECURSIVE "descendants" AS (
          SELECT "id"
          FROM "budget_items"
          WHERE "id" = ${itemId}
            AND "workspace_id" = ${workspaceId}
          UNION
          SELECT "child"."id"
          FROM "budget_items" AS "child"
          INNER JOIN "descendants" AS "parent"
            ON "child"."parent_id" = "parent"."id"
           AND "child"."workspace_id" = ${workspaceId}
        )
, "item_ancestors" AS (
          SELECT "id", "parent_id", "system_taxonomy_key"
          FROM "budget_items"
          WHERE "id" = ${itemId}
            AND "workspace_id" = ${workspaceId}
          UNION ALL
          SELECT "parent"."id", "parent"."parent_id", "parent"."system_taxonomy_key"
          FROM "budget_items" AS "parent"
          INNER JOIN "item_ancestors" AS "child"
            ON "child"."parent_id" = "parent"."id"
          WHERE "parent"."workspace_id" = ${workspaceId}
        ), "target_ancestors" AS (
          SELECT "id", "parent_id", "system_taxonomy_key"
          FROM "budget_items"
          WHERE "id" = ${targetParentId}
            AND "workspace_id" = ${workspaceId}
          UNION ALL
          SELECT "parent"."id", "parent"."parent_id", "parent"."system_taxonomy_key"
          FROM "budget_items" AS "parent"
          INNER JOIN "target_ancestors" AS "child"
            ON "child"."parent_id" = "parent"."id"
          WHERE "parent"."workspace_id" = ${workspaceId}
        )
        UPDATE "budget_items" AS "item"
        SET
          "parent_id" = ${targetParentId},
          "version" = "item"."version" + 1,
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "item"."id" = ${itemId}
          AND "item"."workspace_id" = ${workspaceId}
          AND "item"."version" = ${expectedVersion}
          AND "item"."system_taxonomy_key" IS NULL
          AND ${targetParentId}::text IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM "budget_items" AS "target"
            WHERE "target"."id" = ${targetParentId}
              AND "target"."workspace_id" = ${workspaceId}
              AND NOT EXISTS (
                SELECT 1
                FROM "descendants"
                WHERE "descendants"."id" = "target"."id"
              )
          )
          AND (
            SELECT COUNT(*)
            FROM "item_ancestors"
            WHERE (
              LEFT("system_taxonomy_key", 5) = 'ITEM_'
              OR "system_taxonomy_key" = ${BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY}
            )
          ) = 1
          AND (
            SELECT COUNT(*)
            FROM "target_ancestors"
            WHERE (
              LEFT("system_taxonomy_key", 5) = 'ITEM_'
              OR "system_taxonomy_key" = ${BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY}
            )
          ) = 1
          AND (
            SELECT "system_taxonomy_key"
            FROM "item_ancestors"
            WHERE (
              LEFT("system_taxonomy_key", 5) = 'ITEM_'
              OR "system_taxonomy_key" = ${BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY}
            )
          ) = (
            SELECT "system_taxonomy_key"
            FROM "target_ancestors"
            WHERE (
              LEFT("system_taxonomy_key", 5) = 'ITEM_'
              OR "system_taxonomy_key" = ${BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY}
            )
          )
        `,
      );
    });
  } catch (error) {
    const authorizationFailure = authorizationFailureState(error);
    if (authorizationFailure) return authorizationFailure;
    return unavailableState("目前無法調整階層位置，請稍後再試。");
  }

  if (count === 0) return returnStaleAfterRevalidation(workspaceId);
  return successAfterRevalidation(
    "已調整階層位置。",
    await revalidateBudgetView(workspaceId),
  );
}

export async function dissolveBudgetGroupAction(
  workspaceId: string,
  itemId: string,
  _previousState: BudgetItemMutationState,
  formData: FormData,
): Promise<BudgetItemMutationState> {
  const authorization = await authorizeBudgetMutation(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  let expectedVersion: number;
  let expectedDirectChildSetHash: string;
  try {
    expectedVersion = expectedVersionFromFormData(formData);
    expectedDirectChildSetHash =
      expectedDirectChildSetHashFromFormData(formData);
  } catch (error) {
    return validationState(error);
  }

  let count: number;
  try {
    count = await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        currentUserId,
        "edit",
        transaction,
      );
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}, 0::bigint))`,
      );

      const candidateGroups = await transaction.$queryRaw<
        Array<{ parentId: string | null }>
      >(
        Prisma.sql`
          SELECT "parent_id" AS "parentId"
          FROM "budget_items"
          WHERE "id" = ${itemId}
            AND "workspace_id" = ${workspaceId}
            AND "system_taxonomy_key" IS NULL
        `,
      );
      if (candidateGroups.length !== 1) return 0;

      const candidateParentId = candidateGroups[0].parentId;
      if (candidateParentId !== null) {
        const lockedParents = await transaction.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`
            SELECT "id"
            FROM "budget_items"
            WHERE "id" = ${candidateParentId}
              AND "workspace_id" = ${workspaceId}
            FOR KEY SHARE
          `,
        );
        if (lockedParents.length !== 1) return 0;
      }

      const lockedGroups = await transaction.$queryRaw<
        Array<{
          id: string;
          workspaceId: string;
          kind: BudgetItemKind;
          version: number;
          parentId: string | null;
        }>
      >(
        Prisma.sql`
          SELECT
            "id",
            "workspace_id" AS "workspaceId",
            "kind"::text AS "kind",
            "version",
            "parent_id" AS "parentId"
          FROM "budget_items"
          WHERE "id" = ${itemId}
            AND "workspace_id" = ${workspaceId}
            AND "system_taxonomy_key" IS NULL
          FOR UPDATE
        `,
      );
      const lockedGroup = lockedGroups[0];
      if (
        lockedGroups.length !== 1 ||
        lockedGroup.id !== itemId ||
        lockedGroup.workspaceId !== workspaceId ||
        lockedGroup.kind !== "GROUP" ||
        lockedGroup.version !== expectedVersion ||
        lockedGroup.parentId !== candidateParentId
      ) {
        return 0;
      }

      const lockedChildren = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT "id"
          FROM "budget_items"
          WHERE "workspace_id" = ${workspaceId}
            AND "parent_id" = ${itemId}
          ORDER BY "id"
          FOR UPDATE
        `,
      );
      if (
        fingerprintBudgetDirectChildIds(
          lockedChildren.map((child) => child.id),
        ) !== expectedDirectChildSetHash
      ) {
        return 0;
      }

      const moved = await transaction.$executeRaw(
        Prisma.sql`
          UPDATE "budget_items" AS "child"
          SET
            "parent_id" = ${candidateParentId},
            "version" = "child"."version" + 1,
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "child"."workspace_id" = ${workspaceId}
            AND "child"."parent_id" = ${itemId}
        `,
      );
      if (moved !== lockedChildren.length) {
        throw new BudgetGroupDissolveConflictError();
      }

      const deleted = await transaction.$executeRaw(
        Prisma.sql`
          DELETE FROM "budget_items"
          WHERE "id" = ${itemId}
            AND "workspace_id" = ${workspaceId}
            AND "version" = ${expectedVersion}
            AND "kind" = 'GROUP'
            AND "system_taxonomy_key" IS NULL
            AND "parent_id" IS NOT DISTINCT FROM ${candidateParentId}
        `,
      );
      if (deleted !== 1) {
        throw new BudgetGroupDissolveConflictError();
      }
      return deleted;
    });
  } catch (error) {
    const authorizationFailure = authorizationFailureState(error);
    if (authorizationFailure) return authorizationFailure;
    if (error instanceof BudgetGroupDissolveConflictError) {
      return returnStaleAfterRevalidation(workspaceId);
    }
    return unavailableState(
      "目前無法移除群組並保留其中項目，請稍後再試。",
    );
  }

  if (count === 0) return returnStaleAfterRevalidation(workspaceId);
  return successAfterRevalidation(
    "已移除群組並保留其中項目。",
    await revalidateBudgetView(workspaceId),
  );
}

export async function deleteBudgetGroupSubtreeAction(
  workspaceId: string,
  itemId: string,
  _previousState: BudgetItemMutationState,
  formData: FormData,
): Promise<BudgetItemMutationState> {
  const authorization = await authorizeBudgetMutation(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  let expectedVersion: number;
  let expectedSubtreeSnapshotToken: string;
  let confirmationName: string;
  try {
    expectedVersion = expectedVersionFromFormData(formData);
    expectedSubtreeSnapshotToken =
      subtreeSnapshotTokenFromFormData(formData);
    confirmationName = groupDeletionConfirmationFromFormData(formData);
  } catch (error) {
    return validationState(error);
  }

  let outcome:
    | {
        type: "DELETED";
        groupName: string;
        itemCount: number;
        attachmentCount: number;
      }
    | { type: "CONFIRMATION" };
  try {
    outcome = await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        currentUserId,
        "edit",
        transaction,
      );
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}, 0::bigint))`,
      );
      const subtreeClient = transaction as unknown as BudgetItemPrismaClient;
      const rows = await subtreeClient.budgetItem.findMany<
        BudgetSubtreeSnapshotRow[]
      >({
        where: { workspaceId, systemTaxonomyKey: null },
        orderBy: { id: "asc" },
        select: {
          id: true,
          parentId: true,
          name: true,
          kind: true,
          version: true,
          source: true,
          systemTaxonomyKey: true,
          attachments: {
            orderBy: { id: "asc" },
            select: { id: true },
          },
        },
      });

      const byId = new Map<string, BudgetSubtreeSnapshotRow>();
      const childrenByParent = new Map<string, BudgetSubtreeSnapshotRow[]>();
      for (const row of rows) {
        if (byId.has(row.id)) {
          throw new BudgetGroupSubtreeDeleteConflictError();
        }
        byId.set(row.id, row);
        if (row.parentId !== null) {
          const children = childrenByParent.get(row.parentId) ?? [];
          children.push(row);
          childrenByParent.set(row.parentId, children);
        }
      }

      const root = byId.get(itemId);
      if (
        !root ||
        root.kind !== "GROUP" ||
        root.systemTaxonomyKey !== null ||
        root.version !== expectedVersion
      ) {
        throw new BudgetGroupSubtreeDeleteConflictError();
      }

      const subtreeRows: BudgetSubtreeSnapshotRow[] = [];
      const visited = new Set<string>();
      const stack = [root];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current || visited.has(current.id)) {
          throw new BudgetGroupSubtreeDeleteConflictError();
        }
        visited.add(current.id);
        subtreeRows.push(current);
        const children = childrenByParent.get(current.id) ?? [];
        for (let index = children.length - 1; index >= 0; index -= 1) {
          stack.push(children[index]);
        }
      }

      if (
        subtreeRows.length < 2 ||
        subtreeRows.some((row) => row.systemTaxonomyKey !== null)
      ) {
        throw new BudgetGroupSubtreeDeleteConflictError();
      }
      if (
        confirmationName !==
        normalizeBudgetGroupDetails({ name: root.name }).name
      ) {
        return { type: "CONFIRMATION" as const };
      }

      const snapshot = summarizeBudgetSubtreeSnapshot(subtreeRows, root.id);
      if (snapshot.token !== expectedSubtreeSnapshotToken) {
        throw new BudgetGroupSubtreeDeleteConflictError();
      }

      const deleted = await subtreeClient.budgetItem.deleteMany({
        where: {
          workspaceId,
          systemTaxonomyKey: null,
          id: { in: subtreeRows.map((row) => row.id).toSorted() },
        },
      });
      if (deleted.count !== snapshot.itemCount) {
        throw new BudgetGroupSubtreeDeleteConflictError();
      }
      return {
        type: "DELETED" as const,
        groupName: root.name,
        itemCount: snapshot.itemCount,
        attachmentCount: snapshot.attachmentCount,
      };
    });
  } catch (error) {
    const authorizationFailure = authorizationFailureState(error);
    if (authorizationFailure) return authorizationFailure;
    if (error instanceof BudgetGroupSubtreeDeleteConflictError) {
      return returnStaleAfterRevalidation(workspaceId);
    }
    return unavailableState(
      "目前無法永久刪除群組與下層項目，請稍後再試。",
    );
  }

  if (outcome.type === "CONFIRMATION") {
    return {
      status: "error",
      code: "VALIDATION",
      message: "群組名稱不相符，群組與下層項目均未刪除。",
    };
  }

  const descendantCount = outcome.itemCount - 1;
  const attachmentDescription =
    outcome.attachmentCount === 0
      ? ""
      : `，以及 ${outcome.attachmentCount} 個附件`;
  return successAfterRevalidation(
    `已永久刪除群組「${outcome.groupName}」與 ${descendantCount} 筆下層項目${attachmentDescription}。`,
    await revalidateBudgetView(workspaceId),
  );
}

export async function deleteBudgetItemAction(
  workspaceId: string,
  itemId: string,
  _previousState: BudgetItemMutationState,
  formData: FormData,
): Promise<BudgetItemMutationState> {
  const authorization = await authorizeBudgetMutation(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  let expectedVersion: number;
  try {
    expectedVersion = expectedVersionFromFormData(formData);
  } catch (error) {
    return validationState(error);
  }

  let result: CountResult;
  try {
    result = await runLockedBudgetTransaction(
      workspaceId,
      currentUserId,
      (transaction) =>
        transaction.budgetItem.deleteMany({
          where: {
            id: itemId,
            workspaceId,
            version: expectedVersion,
            systemTaxonomyKey: null,
          },
        }),
    );
  } catch (error) {
    const authorizationFailure = authorizationFailureState(error);
    if (authorizationFailure) return authorizationFailure;
    if (isForeignKeyFailure(error)) {
      return unavailableState("此花費項目包含子項，請先處理子項後再移除。");
    }
    return unavailableState("目前無法移除花費項目，請稍後再試。");
  }

  if (result.count === 0) {
    return returnStaleAfterRevalidation(workspaceId);
  }

  return successAfterRevalidation(
    "已移除花費項目。",
    await revalidateBudgetView(workspaceId),
  );
}

export async function resetBudgetDataAction(
  workspaceId: string,
  _previousState: BudgetItemMutationState,
  formData: FormData,
): Promise<BudgetItemMutationState> {
  const currentUser = await requireCurrentUser();
  try {
    await requireWorkspaceAccess(
      workspaceId,
      currentUser.id,
      "manageMembers",
    );
  } catch (error) {
    const authorizationFailure = authorizationFailureState(error);
    return (
      authorizationFailure ??
      unavailableState("目前無法確認工作區權限，請稍後再試。")
    );
  }

  let confirmationName: string;
  let expectedResetSnapshotToken: string;
  try {
    preparedSnapshotConfirmationFromFormData(formData);
    confirmationName = normalizeWorkspaceDeletionConfirmation(
      formData.get("confirmationName"),
    );
    expectedResetSnapshotToken = resetSnapshotTokenFromFormData(formData);
  } catch (error) {
    return validationState(error);
  }

  let outcome:
    | { type: "DELETED"; itemCount: number; attachmentCount: number }
    | { type: "CONFIRMATION" };
  try {
    outcome = await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        currentUser.id,
        "manageMembers",
        transaction,
      );
      const resetClient = transaction as unknown as BudgetItemPrismaClient;
      const workspace = await resetClient.weddingWorkspace.findFirst({
        where: { id: workspaceId },
        select: { name: true },
      });
      if (!workspace) throw new BudgetResetConflictError();
      if (confirmationName !== normalizeWorkspaceName(workspace.name)) {
        return { type: "CONFIRMATION" as const };
      }

      const rows = await resetClient.budgetItem.findMany({
        where: { workspaceId, systemTaxonomyKey: null },
        orderBy: { id: "asc" },
        select: {
          id: true,
          version: true,
          source: true,
          attachments: {
            orderBy: { id: "asc" },
            select: { id: true },
          },
        },
      });
      const snapshot = summarizeBudgetResetSnapshot(rows);
      if (
        snapshot.itemCount === 0 ||
        snapshot.token !== expectedResetSnapshotToken
      ) {
        throw new BudgetResetConflictError();
      }

      const deleted = await resetClient.budgetItem.deleteMany({
        where: { workspaceId, systemTaxonomyKey: null },
      });
      if (deleted.count !== snapshot.itemCount) {
        throw new BudgetResetConflictError();
      }
      return {
        type: "DELETED" as const,
        itemCount: snapshot.itemCount,
        attachmentCount: snapshot.attachmentCount,
      };
    });
  } catch (error) {
    const authorizationFailure = authorizationFailureState(error);
    if (authorizationFailure) return authorizationFailure;
    if (error instanceof BudgetResetConflictError) {
      return returnStaleAfterRevalidation(workspaceId);
    }
    return unavailableState("目前無法清除花費資料，請稍後再試。");
  }

  if (outcome.type === "CONFIRMATION") {
    return {
      status: "error",
      code: "VALIDATION",
      message: "婚宴名稱不相符，花費資料未清除。",
    };
  }

  return successAfterRevalidation(
    `已清除 ${outcome.itemCount} 筆花費與 ${outcome.attachmentCount} 個附件，Drive 固定分類已保留。`,
    await revalidateBudgetView(workspaceId),
  );
}
