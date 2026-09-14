"use server";

import { revalidatePath } from "next/cache";
import {
  GuestCheckInValidationError,
  normalizeGuestCheckInDetails,
  normalizeGuestCheckInExpectedVersion,
  type NormalizedGuestCheckInDetails,
} from "@/domain/guest-check-in";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import {
  runSerializableTransaction,
  SerializationConflictError,
} from "@/lib/serializable-transaction";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

export type GuestCheckInMutationCode =
  | "VALIDATION"
  | "FORBIDDEN"
  | "STALE"
  | "UNAVAILABLE";

export type GuestCheckInMutationSnapshot = {
  id: string;
  headcount: number;
  notes: string | null;
  version: number;
};

export type GuestCheckInMutationState =
  | { status: "idle"; code?: never; message?: never; checkIn?: never }
  | {
      status: "success";
      message: string;
      checkIn?: GuestCheckInMutationSnapshot;
    }
  | {
      status: "error";
      code: GuestCheckInMutationCode;
      message: string;
      checkIn?: never;
    };

type CountResult = { count: number };

type GuestCheckInMutationClient = {
  guest: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  guestCheckIn: {
    create(args: unknown): Promise<GuestCheckInMutationSnapshot>;
    findFirst(args: unknown): Promise<GuestCheckInMutationSnapshot | null>;
    updateMany(args: unknown): Promise<CountResult>;
    deleteMany(args: unknown): Promise<CountResult>;
  };
};

const checkInSnapshotSelect = {
  id: true,
  headcount: true,
  notes: true,
  version: true,
} as const;

class GuestCheckInStaleError extends Error {}

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

async function authorize(
  workspaceId: string,
): Promise<string | GuestCheckInMutationState> {
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
): NormalizedGuestCheckInDetails {
  return normalizeGuestCheckInDetails({
    headcount: formData.get("headcount"),
    notes: formData.get("notes"),
  });
}

function validationState(error: unknown): GuestCheckInMutationState {
  return {
    status: "error",
    code: "VALIDATION",
    message:
      error instanceof GuestCheckInValidationError
        ? error.message
        : "輸入內容有誤，請重新確認。",
  };
}

function staleState(): GuestCheckInMutationState {
  return {
    status: "error",
    code: "STALE",
    message: "報到資料已更新、已建立或不存在，請重新整理後再試。",
  };
}

function failureState(
  error: unknown,
  fallbackMessage: string,
): GuestCheckInMutationState {
  if (error instanceof WorkspaceAccessDeniedError) {
    return { status: "error", code: "FORBIDDEN", message: error.message };
  }
  if (error instanceof GuestCheckInValidationError) {
    return validationState(error);
  }
  if (
    error instanceof GuestCheckInStaleError ||
    error instanceof SerializationConflictError ||
    isPrismaErrorCode(error, "P2002") ||
    isPrismaErrorCode(error, "P2003")
  ) {
    return staleState();
  }
  return { status: "error", code: "UNAVAILABLE", message: fallbackMessage };
}

function checkInPath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/check-in`;
}

async function revalidateCheckInPage(workspaceId: string): Promise<boolean> {
  try {
    await revalidatePath(checkInPath(workspaceId));
    return true;
  } catch {
    console.error("報到頁面重新驗證失敗。");
    return false;
  }
}

async function revalidateViews(workspaceId: string): Promise<boolean> {
  let revalidated = await revalidateCheckInPage(workspaceId);
  try {
    await revalidatePath(`/workspaces/${workspaceId}/overview`);
  } catch {
    console.error("報到頁面重新驗證失敗。");
    revalidated = false;
  }
  return revalidated;
}

function successAfterRevalidation(
  message: string,
  revalidated: boolean,
  checkIn?: GuestCheckInMutationSnapshot,
): GuestCheckInMutationState {
  return {
    status: "success",
    message: revalidated
      ? message
      : `${message.replace(/。$/u, "")}；畫面未自動更新，請重新整理。`,
    ...(checkIn ? { checkIn } : {}),
  };
}

async function failureAfterPossibleRevalidation(
  workspaceId: string,
  error: unknown,
  fallbackMessage: string,
): Promise<GuestCheckInMutationState> {
  const state = failureState(error, fallbackMessage);
  if (state.status === "error" && state.code === "STALE") {
    await revalidateCheckInPage(workspaceId);
  }
  return state;
}

export async function checkInGuestAction(
  workspaceId: string,
  guestId: string,
  _previousState: GuestCheckInMutationState,
  formData: FormData,
): Promise<GuestCheckInMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let details: NormalizedGuestCheckInDetails;
  try {
    details = detailsFromFormData(formData);
  } catch (error) {
    return validationState(error);
  }

  let checkIn: GuestCheckInMutationSnapshot;
  try {
    checkIn = await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      const client = transaction as unknown as GuestCheckInMutationClient;
      // 賓客必須先確定屬於同一個 workspace，client 傳來的 guestId 不可信；
      // 複合外鍵是最後一道防線，但這裡先擋掉才能回可讀的訊息。
      const guest = await client.guest.findFirst({
        where: { id: guestId, workspaceId },
        select: { id: true },
      });
      if (!guest) throw new GuestCheckInStaleError();

      return client.guestCheckIn.create({
        data: { workspaceId, guestId, ...details },
        select: checkInSnapshotSelect,
      });
    });
  } catch (error) {
    return failureAfterPossibleRevalidation(
      workspaceId,
      error,
      "目前無法完成報到，請稍後再試。",
    );
  }

  return successAfterRevalidation(
    "已完成報到。",
    await revalidateViews(workspaceId),
    checkIn,
  );
}

export async function updateGuestCheckInAction(
  workspaceId: string,
  checkInId: string,
  _previousState: GuestCheckInMutationState,
  formData: FormData,
): Promise<GuestCheckInMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let details: NormalizedGuestCheckInDetails;
  let expectedVersion: number;
  try {
    details = detailsFromFormData(formData);
    expectedVersion = normalizeGuestCheckInExpectedVersion(
      formData.get("expectedVersion"),
    );
  } catch (error) {
    return validationState(error);
  }

  let checkIn: GuestCheckInMutationSnapshot;
  try {
    checkIn = await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      const client = transaction as unknown as GuestCheckInMutationClient;
      const result = await client.guestCheckIn.updateMany({
        where: { id: checkInId, workspaceId, version: expectedVersion },
        data: { ...details, version: { increment: 1 } },
      });
      if (result.count !== 1) throw new GuestCheckInStaleError();
      const updated = await client.guestCheckIn.findFirst({
        where: { id: checkInId, workspaceId },
        select: checkInSnapshotSelect,
      });
      if (!updated) throw new GuestCheckInStaleError();
      return updated;
    });
  } catch (error) {
    return failureAfterPossibleRevalidation(
      workspaceId,
      error,
      "目前無法更新報到人數，請稍後再試。",
    );
  }

  return successAfterRevalidation(
    "已更新報到人數。",
    await revalidateViews(workspaceId),
    checkIn,
  );
}

export async function cancelGuestCheckInAction(
  workspaceId: string,
  checkInId: string,
  _previousState: GuestCheckInMutationState,
  formData: FormData,
): Promise<GuestCheckInMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let expectedVersion: number;
  try {
    expectedVersion = normalizeGuestCheckInExpectedVersion(
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
      const client = transaction as unknown as GuestCheckInMutationClient;
      const result = await client.guestCheckIn.deleteMany({
        where: { id: checkInId, workspaceId, version: expectedVersion },
      });
      if (result.count !== 1) throw new GuestCheckInStaleError();
    });
  } catch (error) {
    return failureAfterPossibleRevalidation(
      workspaceId,
      error,
      "目前無法取消報到，請稍後再試。",
    );
  }

  return successAfterRevalidation(
    "已取消報到。",
    await revalidateViews(workspaceId),
  );
}
