import "server-only";

import { Prisma } from "@prisma/client";
import type { Sql } from "@prisma/client/runtime/library";

import {
  BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES,
  BUDGET_TAXONOMY_NODE_BY_KEY,
  BudgetItemValidationError,
  normalizeBudgetBookingStatus,
  normalizeBudgetItemDetails,
  normalizeBudgetPreparationStatus,
  normalizeBudgetTaxonomyItemKey,
  type BudgetCostCategory,
  type BudgetTaxonomyItemKey,
} from "@/domain/budget-item";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { MobileRequestError } from "@/lib/mobile/protocol";
import {
  runSerializableTransaction,
  SerializationConflictError,
} from "@/lib/serializable-transaction";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

const STALE_MESSAGE = "這筆花費剛剛被其他人更新，請重新整理後再試。";

/** 手機表單會送的欄位；候選廠商、預估範圍、負責人與用途關聯留在網站改，更新時原樣保留。 */
export const BUDGET_DETAIL_FIELDS = [
  "name",
  "plannedAmount",
  "depositAmount",
  "balanceAmount",
  "additionalAmount",
  "dueDate",
  "notes",
  "confirmedVendor",
  "vendorContact",
  "balancePaymentMethod",
];

export function budgetBody(body: unknown, allowed: string[]): Record<string, unknown> {
  // workspace、項目 id 與身分只看路徑和已驗證的使用者。
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "花費輸入格式有誤。");
  }
  return body as Record<string, unknown>;
}

function failure(error: unknown): never {
  if (error instanceof MobileRequestError) throw error;
  if (error instanceof BudgetItemValidationError) {
    throw new MobileRequestError(400, "VALIDATION", error.message);
  }
  if (error instanceof WorkspaceAccessDeniedError) {
    throw new MobileRequestError(403, "FORBIDDEN", "沒有這場婚宴的編輯權限。");
  }
  if (error instanceof SerializationConflictError) {
    throw new MobileRequestError(409, "CONFLICT", "剛剛有人同時操作，請重新整理後再試。");
  }
  throw new MobileRequestError(503, "UNAVAILABLE", "目前無法完成操作，請稍後再試。");
}

function versionOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "版本資訊無效，請重新整理後再試。");
  }
  return value;
}

/** 金額在網站是表單字串；手機傳數字或空值都轉成同一種格式再驗證。 */
function amountText(value: unknown): unknown {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? String(value) : "x";
  return value;
}

type CurrentItem = {
  bookingStatus: "PLANNING" | "BOOKED_BALANCE_DUE" | "PAID";
  category: BudgetCostCategory | null;
  estimatedRange: string | null;
  candidateVendors: string | null;
  primaryContact: string | null;
};

function editableDetails(
  fields: Record<string, unknown>,
  category: BudgetCostCategory,
  kept: Omit<CurrentItem, "bookingStatus" | "category"> | null,
) {
  const { bookingStatus, ...details } = normalizeBudgetItemDetails({
    name: fields.name,
    category,
    plannedAmount: amountText(fields.plannedAmount),
    actualAmount: "",
    dueDate: fields.dueDate ?? "",
    notes: fields.notes ?? "",
    depositAmount: amountText(fields.depositAmount),
    balanceAmount: amountText(fields.balanceAmount),
    additionalAmount: amountText(fields.additionalAmount),
    estimatedRange: kept?.estimatedRange ?? "",
    candidateVendors: kept?.candidateVendors ?? "",
    confirmedVendor: fields.confirmedVendor ?? "",
    vendorContact: fields.vendorContact ?? "",
    primaryContact: kept?.primaryContact ?? "",
    balancePaymentMethod: fields.balancePaymentMethod ?? "",
  });
  void bookingStatus;
  return details;
}

type BudgetTransaction = {
  $executeRaw(query: Sql): Promise<number>;
  budgetItem: {
    findFirst(args: unknown): Promise<({ id: string } & Partial<CurrentItem>) | null>;
    create(args: unknown): Promise<{ id: string; version: number }>;
    updateMany(args: unknown): Promise<{ count: number }>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
};

async function taxonomyGroupId(
  client: BudgetTransaction,
  workspaceId: string,
  key: BudgetTaxonomyItemKey,
): Promise<string> {
  // 和網站同一個規則：新項目一律掛在系統分類下面，沒有這個分類（例如沒辦文定）就不能新增。
  const group = await client.budgetItem.findFirst({
    where: {
      workspaceId,
      kind: "GROUP",
      systemTaxonomyKey: key,
      parent: { workspaceId, systemTaxonomyKey: BUDGET_TAXONOMY_NODE_BY_KEY[key].parentKey },
    },
    select: { id: true },
  });
  if (!group) throw new BudgetItemValidationError("這場婚宴沒有這個分類，請換一個。");
  return group.id;
}

export async function mobileCreateBudgetItem(
  workspaceId: string,
  userId: string,
  fields: Record<string, unknown>,
) {
  try {
    const key = normalizeBudgetTaxonomyItemKey(fields.taxonomyItemKey);
    const details = editableDetails(fields, BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES[key], null);
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as BudgetTransaction;
      const parentId = await taxonomyGroupId(client, workspaceId, key);
      const item = await client.budgetItem.create({
        data: {
          workspaceId,
          parentId,
          kind: "EXPENSE",
          source: "MANUAL",
          externalId: null,
          sourceHash: null,
          sourceOrder: null,
          ...details,
          relatedTaxonomyItemKey: null,
          systemTaxonomyKey: null,
          actualAmount: null,
          bookingStatus: "PLANNING",
          paid: false,
          paidAt: null,
        },
        select: { id: true, version: true },
      });
      return { id: item.id, name: details.name, version: item.version };
    });
  } catch (error) {
    return failure(error);
  }
}

/** 只改內容，不搬分類；分類要搬到網站做，那邊會一起檢查下層項目。 */
export async function mobileUpdateBudgetItem(
  workspaceId: string,
  userId: string,
  itemId: string,
  fields: Record<string, unknown>,
) {
  try {
    const version = versionOf(fields.expectedVersion);
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as BudgetTransaction;
      const current = await client.budgetItem.findFirst({
        where: { id: itemId, workspaceId, version, kind: "EXPENSE" },
        select: {
          id: true,
          bookingStatus: true,
          category: true,
          estimatedRange: true,
          candidateVendors: true,
          primaryContact: true,
        },
      });
      if (!current || !current.bookingStatus) throw new MobileRequestError(409, "STALE", STALE_MESSAGE);
      const details = editableDetails(fields, current.category ?? "OTHER_PENDING", {
        estimatedRange: current.estimatedRange ?? null,
        candidateVendors: current.candidateVendors ?? null,
        primaryContact: current.primaryContact ?? null,
      });
      // 已記錄的實付金額跟著付款狀態走，和網站更新花費時同一條規則。
      const actualAmount =
        current.bookingStatus === "PLANNING"
          ? null
          : current.bookingStatus === "BOOKED_BALANCE_DUE"
            ? details.depositAmount
            : details.plannedAmount;
      const updated = await client.budgetItem.updateMany({
        where: { id: itemId, workspaceId, version, kind: "EXPENSE" },
        data: { ...details, actualAmount, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new MobileRequestError(409, "STALE", STALE_MESSAGE);
      return { id: itemId, name: details.name, version: version + 1 };
    });
  } catch (error) {
    return failure(error);
  }
}

/** 下訂與付款狀態；實付金額與付款時間都由伺服器決定。 */
export async function mobileSetBudgetBookingStatus(
  workspaceId: string,
  userId: string,
  itemId: string,
  statusInput: unknown,
  expectedVersion: unknown,
) {
  try {
    if (typeof statusInput !== "string" || statusInput === "") {
      throw new BudgetItemValidationError("請選擇有效的下訂與付款狀態。");
    }
    const status = normalizeBudgetBookingStatus(statusInput);
    const version = versionOf(expectedVersion);
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as BudgetTransaction;
      const paidAt = new Date();
      const count = await client.$executeRaw(Prisma.sql`
        UPDATE "budget_items"
        SET
          "booking_status" = CAST(${status} AS "BudgetBookingStatus"),
          "paid" = ${status === "PAID"},
          "actual_amount" = CASE CAST(${status} AS "BudgetBookingStatus")
            WHEN 'PLANNING' THEN NULL
            WHEN 'BOOKED_BALANCE_DUE' THEN "deposit_amount"
            WHEN 'PAID' THEN "planned_amount"
          END,
          "paid_at" = CASE
            WHEN CAST(${status} AS "BudgetBookingStatus") <> 'PAID' THEN NULL
            WHEN "booking_status" = 'PAID' THEN "paid_at"
            ELSE ${paidAt}
          END,
          "version" = "version" + 1,
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${itemId}
          AND "workspace_id" = ${workspaceId}
          AND "version" = ${version}
          AND "kind" = 'EXPENSE'
          AND "preparation_status" = 'NEEDS_ACTION'::"BudgetPreparationStatus"
      `);
      if (count !== 1) throw new MobileRequestError(409, "STALE", STALE_MESSAGE);
      return { id: itemId, bookingStatus: status, version: version + 1 };
    });
  } catch (error) {
    return failure(error);
  }
}

/** 需要安排／已有自備／不打算準備；金額保留，只是不再計入預算。 */
export async function mobileSetBudgetPreparationStatus(
  workspaceId: string,
  userId: string,
  itemId: string,
  statusInput: unknown,
  expectedVersion: unknown,
) {
  try {
    const status = normalizeBudgetPreparationStatus(statusInput);
    const version = versionOf(expectedVersion);
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as BudgetTransaction;
      const updated = await client.budgetItem.updateMany({
        where: { id: itemId, workspaceId, version, kind: "EXPENSE" },
        data: { preparationStatus: status, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new MobileRequestError(409, "STALE", STALE_MESSAGE);
      return { id: itemId, preparationStatus: status, version: version + 1 };
    });
  } catch (error) {
    return failure(error);
  }
}

export async function mobileDeleteBudgetItem(
  workspaceId: string,
  userId: string,
  itemId: string,
  expectedVersion: unknown,
) {
  try {
    const version = versionOf(expectedVersion);
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as BudgetTransaction;
      // 系統分類本身不能刪；有下層項目時資料庫的外鍵會擋下來。
      const deleted = await client.budgetItem.deleteMany({
        where: { id: itemId, workspaceId, version, kind: "EXPENSE", systemTaxonomyKey: null },
      });
      if (deleted.count !== 1) throw new MobileRequestError(409, "STALE", STALE_MESSAGE);
      return { removed: true };
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2003") {
      throw new MobileRequestError(409, "IN_USE", "這筆花費下面還有細項，請先到網站整理。");
    }
    return failure(error);
  }
}
