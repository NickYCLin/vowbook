"use server";

import { revalidatePath } from "next/cache";
import {
  PACKING_CATEGORY_LABELS,
  PACKING_SIDE_LABELS,
  normalizePackingCategory,
  normalizePackingItemTitle,
  normalizePackingNote,
  normalizePackingSide,
  PackingItemValidationError,
} from "@/domain/packing-item";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { runSerializableTransaction } from "@/lib/serializable-transaction";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

export type PackingItemMutationState = {
  status: "idle" | "success" | "error";
  code?: "VALIDATION" | "FORBIDDEN" | "STALE" | "UNAVAILABLE";
  message?: string;
};

type CountResult = { count: number };

type PackingItemTransaction = {
  packingItem: {
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<CountResult>;
    deleteMany(args: unknown): Promise<CountResult>;
  };
};

function packingPath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/tasks/packing`;
}

async function revalidatePacking(workspaceId: string): Promise<boolean> {
  try {
    await revalidatePath(packingPath(workspaceId));
    return true;
  } catch {
    console.error("打包清單頁面重新驗證失敗。");
    return false;
  }
}

async function success(
  workspaceId: string,
  message: string,
): Promise<PackingItemMutationState> {
  const revalidated = await revalidatePacking(workspaceId);
  return {
    status: "success",
    message: revalidated
      ? message
      : `${message.replace(/。$/u, "")}；畫面未自動更新，請重新整理。`,
  };
}

function validationState(error: unknown): PackingItemMutationState {
  return {
    status: "error",
    code: "VALIDATION",
    message:
      error instanceof PackingItemValidationError
        ? error.message
        : "輸入內容有誤，請重新確認。",
  };
}

function writeFailureState(
  error: unknown,
  fallbackMessage: string,
): PackingItemMutationState {
  if (error instanceof WorkspaceAccessDeniedError) {
    return { status: "error", code: "FORBIDDEN", message: error.message };
  }
  return { status: "error", code: "UNAVAILABLE", message: fallbackMessage };
}

async function staleState(
  workspaceId: string,
): Promise<PackingItemMutationState> {
  await revalidatePacking(workspaceId);
  return {
    status: "error",
    code: "STALE",
    message: "資料已更新或不存在，請重新整理後再試。",
  };
}

async function authorize(
  workspaceId: string,
): Promise<string | PackingItemMutationState> {
  const currentUser = await requireCurrentUser();
  try {
    await requireWorkspaceAccess(workspaceId, currentUser.id, "edit");
    return currentUser.id;
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return { status: "error", code: "FORBIDDEN", message: error.message };
    }
    return {
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法確認工作區權限，請稍後再試。",
    };
  }
}

function expectedVersionFrom(formData: FormData): number {
  const value = formData.get("expectedVersion");
  const parsed = typeof value === "string" && /^\d+$/u.test(value)
    ? Number(value)
    : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new PackingItemValidationError("版本資訊無效，請重新整理後再試。");
  }
  return parsed;
}

async function withLockedEdit<T>(
  workspaceId: string,
  userId: string,
  operation: (transaction: PackingItemTransaction) => Promise<T>,
): Promise<T> {
  return runSerializableTransaction(async (transaction) => {
    await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
    return operation(transaction as unknown as PackingItemTransaction);
  });
}

export async function createPackingItemAction(
  workspaceId: string,
  _previousState: PackingItemMutationState,
  formData: FormData,
): Promise<PackingItemMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let title: string;
  let side: ReturnType<typeof normalizePackingSide>;
  let category: ReturnType<typeof normalizePackingCategory>;
  let note: string | null;
  try {
    title = normalizePackingItemTitle(formData.get("title"));
    side = normalizePackingSide(formData.get("side"));
    category = normalizePackingCategory(formData.get("category"));
    note = normalizePackingNote(formData.get("note"));
  } catch (error) {
    return validationState(error);
  }

  try {
    await withLockedEdit(workspaceId, authorization, (transaction) =>
      transaction.packingItem.create({
        data: { workspaceId, title, side, category, note, packed: false },
      }),
    );
  } catch (error) {
    return writeFailureState(error, "目前無法加入打包清單，請稍後再試。");
  }
  return success(
    workspaceId,
    category === "WEDDING_SUPPLY" ? "已加入宴客用品。" : "已加入打包清單。",
  );
}

export async function setPackingItemPackedAction(
  workspaceId: string,
  itemId: string,
  packed: boolean,
  _previousState: PackingItemMutationState,
  formData: FormData,
): Promise<PackingItemMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let expectedVersion: number;
  try {
    expectedVersion = expectedVersionFrom(formData);
  } catch (error) {
    return validationState(error);
  }

  let result: CountResult;
  try {
    result = await withLockedEdit(workspaceId, authorization, (transaction) =>
      transaction.packingItem.updateMany({
        where: { id: itemId, workspaceId, version: expectedVersion },
        data: { packed: packed === true, version: { increment: 1 } },
      }),
    );
  } catch (error) {
    return writeFailureState(error, "目前無法更新打包狀態，請稍後再試。");
  }
  if (result.count === 0) return staleState(workspaceId);
  return success(workspaceId, packed ? "已打包。" : "已改回未打包。");
}

export async function updatePackingItemAction(
  workspaceId: string,
  itemId: string,
  _previousState: PackingItemMutationState,
  formData: FormData,
): Promise<PackingItemMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let expectedVersion: number;
  let title: string;
  let side: ReturnType<typeof normalizePackingSide>;
  let note: string | null;
  try {
    expectedVersion = expectedVersionFrom(formData);
    title = normalizePackingItemTitle(formData.get("title"));
    side = normalizePackingSide(formData.get("side"));
    note = normalizePackingNote(formData.get("note"));
  } catch (error) {
    return validationState(error);
  }

  let result: CountResult;
  try {
    result = await withLockedEdit(workspaceId, authorization, (transaction) =>
      transaction.packingItem.updateMany({
        where: { id: itemId, workspaceId, version: expectedVersion },
        data: { title, side, note, version: { increment: 1 } },
      }),
    );
  } catch (error) {
    return writeFailureState(error, "目前無法更新物品，請稍後再試。");
  }
  if (result.count === 0) return staleState(workspaceId);
  return success(workspaceId, "已更新物品。");
}

/** 拖曳換區：只改分欄與分類，名稱、備註與打包狀態不動。 */
export async function movePackingItemAction(
  workspaceId: string,
  itemId: string,
  _previousState: PackingItemMutationState,
  formData: FormData,
): Promise<PackingItemMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let expectedVersion: number;
  let side: ReturnType<typeof normalizePackingSide>;
  let category: ReturnType<typeof normalizePackingCategory>;
  try {
    expectedVersion = expectedVersionFrom(formData);
    side = normalizePackingSide(formData.get("side"));
    const rawCategory = formData.get("category");
    if (typeof rawCategory !== "string" || rawCategory.length === 0) {
      throw new PackingItemValidationError("請選擇要移到哪一區。");
    }
    category = normalizePackingCategory(rawCategory);
  } catch (error) {
    return validationState(error);
  }

  let result: CountResult;
  try {
    result = await withLockedEdit(workspaceId, authorization, (transaction) =>
      transaction.packingItem.updateMany({
        where: { id: itemId, workspaceId, version: expectedVersion },
        data: { side, category, version: { increment: 1 } },
      }),
    );
  } catch (error) {
    return writeFailureState(error, "目前無法移動物品，請稍後再試。");
  }
  if (result.count === 0) return staleState(workspaceId);
  const destination =
    category === "WEDDING_SUPPLY"
      ? PACKING_CATEGORY_LABELS[category]
      : PACKING_SIDE_LABELS[side];
  return success(workspaceId, `已移到${destination}。`);
}

export async function deletePackingItemAction(
  workspaceId: string,
  itemId: string,
  _previousState: PackingItemMutationState,
  formData: FormData,
): Promise<PackingItemMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let expectedVersion: number;
  try {
    expectedVersion = expectedVersionFrom(formData);
  } catch (error) {
    return validationState(error);
  }

  let result: CountResult;
  try {
    result = await withLockedEdit(workspaceId, authorization, (transaction) =>
      transaction.packingItem.deleteMany({
        where: { id: itemId, workspaceId, version: expectedVersion },
      }),
    );
  } catch (error) {
    return writeFailureState(error, "目前無法移除物品，請稍後再試。");
  }
  if (result.count === 0) return staleState(workspaceId);
  return success(workspaceId, "已從打包清單移除。");
}
