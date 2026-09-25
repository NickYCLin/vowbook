"use server";

import {isGiftCollectionExcluded} from "@/domain/wedding-gift-policy";
import type { Prisma } from "@prisma/client";
import { effectiveGuestDetailValue } from "@/domain/guest-detail-value";
import { revalidatePath } from "next/cache";
import {
  normalizeWeddingGiftDetails,
  normalizeWeddingGiftExpectedVersion,
  normalizeWeddingGiftReturnNote,
  type NormalizedWeddingGiftDetails,
  WeddingGiftValidationError,
} from "@/domain/wedding-gift";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import {
  runSerializableTransaction,
  SerializationConflictError,
} from "@/lib/serializable-transaction";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

export type WeddingGiftMutationCode =
  | "VALIDATION"
  | "FORBIDDEN"
  | "STALE"
  | "UNAVAILABLE";

export type WeddingGiftMutationSnapshot = {
  id: string;
  amount: number;
  notes: string | null;
  returnGiftSentAt: Date | null;
  returnGiftNote: string | null;
  version: number;
};

export type GuestGiftExemptionSnapshot = { version: number; giftExemptWithCake: boolean };

export type WeddingGiftMutationState =
  | { status: "idle"; code?: never; message?: never; gift?: never }
  | {
      status: "success";
      message: string;
      gift?: WeddingGiftMutationSnapshot;
      guest?: GuestGiftExemptionSnapshot;
    }
  | {
      status: "error";
      code: WeddingGiftMutationCode;
      message: string;
      gift?: never;
    };

type CountResult = { count: number };

const giftPolicyGuestSelect = {
  id: true,
  giftExemptWithCake: true,
  category: true,
  importRecords: {
    orderBy: [{ source: "asc" }, { sourceInstance: "asc" }],
    select: { source: true, sourceInstance: true, sourceManaged: true, relationshipLabel: true },
  },
} satisfies Prisma.GuestSelect;

type WeddingGiftMutationClient = {
  guest: {
    findFirst(args: unknown): Promise<Prisma.GuestGetPayload<{ select: typeof giftPolicyGuestSelect }> | null>;
    updateMany(args: unknown): Promise<CountResult>;
  };
  weddingGift: {
    create(args: unknown): Promise<WeddingGiftMutationSnapshot>;
    findFirst(args: unknown): Promise<WeddingGiftMutationSnapshot | null>;
    updateMany(args: unknown): Promise<CountResult>;
    deleteMany(args: unknown): Promise<CountResult>;
  };
};

const giftSnapshotSelect = {
  id: true,
  amount: true,
  notes: true,
  returnGiftSentAt: true,
  returnGiftNote: true,
  version: true,
} as const;

class WeddingGiftStaleError extends Error {}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function isForeignKeyConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2003"
  );
}

async function authorize(
  workspaceId: string,
): Promise<string | WeddingGiftMutationState> {
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

function detailsFromFormData(
  formData: FormData,
): NormalizedWeddingGiftDetails {
  return normalizeWeddingGiftDetails({
    amount: formData.get("amount"),
    notes: formData.get("notes"),
  });
}

function validationState(error: unknown): WeddingGiftMutationState {
  return {
    status: "error",
    code: "VALIDATION",
    message:
      error instanceof WeddingGiftValidationError
        ? error.message
        : "輸入內容有誤，請重新確認。",
  };
}

function staleState(): WeddingGiftMutationState {
  return {
    status: "error",
    code: "STALE",
    message: "禮金資料已更新、已建立或不存在，請重新整理後再試。",
  };
}

function failureState(
  error: unknown,
  fallbackMessage: string,
): WeddingGiftMutationState {
  if (error instanceof WorkspaceAccessDeniedError) {
    return { status: "error", code: "FORBIDDEN", message: error.message };
  }
  if (error instanceof WeddingGiftValidationError) {
    return validationState(error);
  }
  if (
    error instanceof WeddingGiftStaleError ||
    error instanceof SerializationConflictError ||
    isUniqueConstraintError(error) ||
    isForeignKeyConstraintError(error)
  ) {
    return staleState();
  }
  return { status: "error", code: "UNAVAILABLE", message: fallbackMessage };
}

function giftsPath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/gifts`;
}

async function revalidateGiftPage(workspaceId: string): Promise<boolean> {
  try {
    await revalidatePath(giftsPath(workspaceId));
    return true;
  } catch {
    console.error("禮金頁面重新驗證失敗。");
    return false;
  }
}

async function revalidateViews(workspaceId: string): Promise<boolean> {
  let revalidated = await revalidateGiftPage(workspaceId);
  try {
    await revalidatePath(`/workspaces/${workspaceId}/overview`);
  } catch {
    console.error("禮金頁面重新驗證失敗。");
    revalidated = false;
  }
  try {
    await revalidatePath(`/workspaces/${workspaceId}/gifts/print`);
  } catch {
    revalidated = false;
  }
  try {
    await revalidatePath(`/workspaces/${workspaceId}/guests`);
  } catch {
    revalidated = false;
  }
  return revalidated;
}

function successAfterRevalidation(
  message: string,
  revalidated: boolean,
  gift?: WeddingGiftMutationSnapshot,
): Extract<WeddingGiftMutationState, { status: "success" }> {
  return {
    status: "success",
    message: revalidated
      ? message
      : `${message.replace(/。$/u, "")}；畫面未自動更新，請重新整理。`,
    ...(gift ? { gift } : {}),
  };
}

async function failureAfterPossibleRevalidation(
  workspaceId: string,
  error: unknown,
  fallbackMessage: string,
): Promise<WeddingGiftMutationState> {
  const state = failureState(error, fallbackMessage);
  if (state.status === "error" && state.code === "STALE") {
    await revalidateGiftPage(workspaceId);
  }
  return state;
}

export async function createWeddingGiftAction(
  workspaceId: string,
  guestId: string,
  _previousState: WeddingGiftMutationState,
  formData: FormData,
): Promise<WeddingGiftMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let details: NormalizedWeddingGiftDetails;
  try {
    details = detailsFromFormData(formData);
  } catch (error) {
    return validationState(error);
  }

  let gift: WeddingGiftMutationSnapshot;
  try {
    gift = await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      const client = transaction as unknown as WeddingGiftMutationClient;
      const guest = await client.guest.findFirst({
        where: { id: guestId, workspaceId },
        select: giftPolicyGuestSelect,
      });
      if (!guest) throw new WeddingGiftStaleError();
      const relationshipLabel = effectiveGuestDetailValue(guest.importRecords, record => record.relationshipLabel);
      if (isGiftCollectionExcluded({ ...guest, relationshipLabel })) throw new WeddingGiftValidationError("此親友不收禮金（新人、雙方父母手足或已設定不收禮金），無法新增登記。");

      return client.weddingGift.create({
        data: { workspaceId, guestId, ...details },
        select: giftSnapshotSelect,
      });
    });
  } catch (error) {
    return failureAfterPossibleRevalidation(
      workspaceId,
      error,
      "目前無法登記禮金，請稍後再試。",
    );
  }

  return successAfterRevalidation(
    "已登記禮金。",
    await revalidateViews(workspaceId),
    gift,
  );
}

export async function updateWeddingGiftAction(
  workspaceId: string,
  giftId: string,
  _previousState: WeddingGiftMutationState,
  formData: FormData,
): Promise<WeddingGiftMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let details: NormalizedWeddingGiftDetails;
  let expectedVersion: number;
  try {
    details = detailsFromFormData(formData);
    expectedVersion = normalizeWeddingGiftExpectedVersion(
      formData.get("expectedVersion"),
    );
  } catch (error) {
    return validationState(error);
  }

  let gift: WeddingGiftMutationSnapshot;
  try {
    gift = await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      const client = transaction as unknown as WeddingGiftMutationClient;
      const result = await client.weddingGift.updateMany({
        where: { id: giftId, workspaceId, version: expectedVersion },
        data: { ...details, version: { increment: 1 } },
      });
      if (result.count !== 1) throw new WeddingGiftStaleError();
      const updated = await client.weddingGift.findFirst({
        where: { id: giftId, workspaceId },
        select: giftSnapshotSelect,
      });
      if (!updated) throw new WeddingGiftStaleError();
      return updated;
    });
  } catch (error) {
    return failureAfterPossibleRevalidation(
      workspaceId,
      error,
      "目前無法更新禮金，請稍後再試。",
    );
  }

  return successAfterRevalidation(
    "已更新禮金。",
    await revalidateViews(workspaceId),
    gift,
  );
}

/**
 * 禮到人不到的回禮追蹤。回禮時間由 server 決定，client 只送「已回／未回」，
 * 避免有人塞一個假的寄送時間進來。
 */
export async function setWeddingGiftReturnAction(
  workspaceId: string,
  giftId: string,
  _previousState: WeddingGiftMutationState,
  formData: FormData,
): Promise<WeddingGiftMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let expectedVersion: number;
  let returnGiftNote: string | null;
  let markSent: boolean;
  try {
    expectedVersion = normalizeWeddingGiftExpectedVersion(
      formData.get("expectedVersion"),
    );
    returnGiftNote = normalizeWeddingGiftReturnNote(
      formData.get("returnGiftNote"),
    );
    const rawSent = formData.get("returnGiftSent");
    if (rawSent !== null && rawSent !== "on" && rawSent !== "") {
      throw new WeddingGiftValidationError("回禮狀態無效，請重新整理後再試。");
    }
    markSent = rawSent === "on";
  } catch (error) {
    return validationState(error);
  }

  let gift: WeddingGiftMutationSnapshot;
  try {
    gift = await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      const client = transaction as unknown as WeddingGiftMutationClient;
      const current = await client.weddingGift.findFirst({
        where: { id: giftId, workspaceId },
        select: giftSnapshotSelect,
      });
      if (!current || current.version !== expectedVersion) {
        throw new WeddingGiftStaleError();
      }

      // 重複標記已回禮時保留原本的回禮時間，不因為再點一次就往後跳。
      const returnGiftSentAt = markSent
        ? (current.returnGiftSentAt ?? new Date())
        : null;
      const result = await client.weddingGift.updateMany({
        where: { id: giftId, workspaceId, version: expectedVersion },
        data: {
          returnGiftSentAt,
          returnGiftNote,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw new WeddingGiftStaleError();

      const updated = await client.weddingGift.findFirst({
        where: { id: giftId, workspaceId },
        select: giftSnapshotSelect,
      });
      if (!updated) throw new WeddingGiftStaleError();
      return updated;
    });
  } catch (error) {
    return failureAfterPossibleRevalidation(
      workspaceId,
      error,
      "目前無法更新回禮狀態，請稍後再試。",
    );
  }

  return successAfterRevalidation(
    markSent ? "已標記為已回禮。" : "已改回尚未回禮。",
    await revalidateViews(workspaceId),
    gift,
  );
}

export async function deleteWeddingGiftAction(
  workspaceId: string,
  giftId: string,
  _previousState: WeddingGiftMutationState,
  formData: FormData,
): Promise<WeddingGiftMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let expectedVersion: number;
  try {
    expectedVersion = normalizeWeddingGiftExpectedVersion(
      formData.get("expectedVersion"),
    );
  } catch (error) {
    return validationState(error);
  }

  try {
    await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      const client = transaction as unknown as WeddingGiftMutationClient;
      const result = await client.weddingGift.deleteMany({
        where: { id: giftId, workspaceId, version: expectedVersion },
      });
      if (result.count !== 1) throw new WeddingGiftStaleError();
    });
  } catch (error) {
    return failureAfterPossibleRevalidation(
      workspaceId,
      error,
      "目前無法移除禮金紀錄，請稍後再試。",
    );
  }

  return successAfterRevalidation(
    "已移除禮金紀錄。",
    await revalidateViews(workspaceId),
  );
}

/** 賓客安排獨立於禮金紀錄，不建立零元禮金，也不更動出席回覆。 */
export async function setGuestGiftExemptionAction(
  workspaceId: string,
  guestId: string,
  _previousState: WeddingGiftMutationState,
  formData: FormData,
): Promise<WeddingGiftMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;
  let expectedVersion: number;
  let giftExemptWithCake: boolean;
  try {
    expectedVersion = normalizeWeddingGiftExpectedVersion(formData.get("expectedVersion"));
    const value = formData.get("giftExemptWithCake");
    if (value !== "on" && value !== "off") {
      throw new WeddingGiftValidationError("請重新確認不收禮金、會送餅的標記。");
    }
    giftExemptWithCake = value === "on";
  } catch (error) {
    return validationState(error);
  }
  try {
    await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, authorization, "edit", transaction);
      const client = transaction as unknown as WeddingGiftMutationClient;
      const result = await client.guest.updateMany({
        where: { id: guestId, workspaceId, version: expectedVersion },
        data: { giftExemptWithCake, version: { increment: 1 } },
      });
      if (result.count !== 1) throw new WeddingGiftStaleError();
    });
  } catch (error) {
    return failureAfterPossibleRevalidation(workspaceId, error, "目前無法更新賓客標記，請稍後再試。");
  }
  let revalidated = await revalidateViews(workspaceId);
  for (const view of ["guests", "tables", "guests/cakes"]) {
    try {
      await revalidatePath(`/workspaces/${workspaceId}/${view}`);
    } catch {
      revalidated = false;
    }
  }
  return {
    ...successAfterRevalidation("已更新不收禮金、會送餅的標記。", revalidated),
    status: "success",
    guest: { version: expectedVersion + 1, giftExemptWithCake },
  };
}
