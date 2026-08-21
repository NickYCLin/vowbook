"use server";

import { revalidatePath } from "next/cache";
import {
  normalizeWeddingStaffDetails,
  type NormalizedWeddingStaffDetails,
  WeddingStaffValidationError,
} from "@/domain/wedding-staff";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { runSerializableTransaction } from "@/lib/serializable-transaction";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

export type WeddingStaffMutationCode =
  | "VALIDATION"
  | "FORBIDDEN"
  | "STALE"
  | "UNAVAILABLE";

export type WeddingStaffMutationState = {
  status: "idle" | "success" | "error";
  code?: WeddingStaffMutationCode;
  message?: string;
};

type CountResult = { count: number };

type WeddingStaffPrismaClient = {
  weddingStaffAssignment: {
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<CountResult>;
    deleteMany(args: unknown): Promise<CountResult>;
  };
};

async function authorize(
  workspaceId: string,
): Promise<string | WeddingStaffMutationState> {
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
    return {
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法確認工作區權限，請稍後再試。",
    };
  }
}

function detailsFromFormData(formData: FormData): NormalizedWeddingStaffDetails {
  return normalizeWeddingStaffDetails({
    roleName: formData.get("roleName"),
    personName: formData.get("personName"),
    contactPhone: formData.get("contactPhone"),
    notes: formData.get("notes"),
  });
}

function expectedVersion(formData: FormData): number {
  const raw = formData.get("expectedVersion");
  if (typeof raw !== "string" || !/^\d+$/u.test(raw)) {
    throw new WeddingStaffValidationError(
      "版本資訊無效，請重新整理後再試。",
    );
  }
  const version = Number(raw);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new WeddingStaffValidationError(
      "版本資訊無效，請重新整理後再試。",
    );
  }
  return version;
}

function validationState(error: unknown): WeddingStaffMutationState {
  return {
    status: "error",
    code: "VALIDATION",
    message:
      error instanceof WeddingStaffValidationError
        ? error.message
        : "輸入內容有誤，請重新確認。",
  };
}

function writeFailureState(
  error: unknown,
  fallbackMessage: string,
): WeddingStaffMutationState {
  if (error instanceof WorkspaceAccessDeniedError) {
    return { status: "error", code: "FORBIDDEN", message: error.message };
  }

  return { status: "error", code: "UNAVAILABLE", message: fallbackMessage };
}

function staleState(): WeddingStaffMutationState {
  return {
    status: "error",
    code: "STALE",
    message: "資料已更新或不存在，請重新整理後再試。",
  };
}

async function revalidateViews(workspaceId: string): Promise<void> {
  try {
    await revalidatePath(`/workspaces/${workspaceId}/staff`);
    await revalidatePath(`/workspaces/${workspaceId}/timeline`);
  } catch {
    console.error("婚禮工作人員頁面重新驗證失敗。");
  }
}

export async function createWeddingStaffAction(
  workspaceId: string,
  _previousState: WeddingStaffMutationState,
  formData: FormData,
): Promise<WeddingStaffMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let details: NormalizedWeddingStaffDetails;
  try {
    details = detailsFromFormData(formData);
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
      const staffTransaction =
        transaction as unknown as WeddingStaffPrismaClient;
      await staffTransaction.weddingStaffAssignment.create({
        data: { workspaceId, ...details },
      });
    });
  } catch (error) {
    return writeFailureState(
      error,
      "目前無法新增工作人員，請稍後再試。",
    );
  }

  await revalidateViews(workspaceId);
  return { status: "success", message: "已新增婚禮工作人員。" };
}

export async function updateWeddingStaffAction(
  workspaceId: string,
  staffId: string,
  _previousState: WeddingStaffMutationState,
  formData: FormData,
): Promise<WeddingStaffMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let details: NormalizedWeddingStaffDetails;
  let version: number;
  try {
    details = detailsFromFormData(formData);
    version = expectedVersion(formData);
  } catch (error) {
    return validationState(error);
  }

  let result: CountResult;
  try {
    result = await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      const staffTransaction =
        transaction as unknown as WeddingStaffPrismaClient;
      return staffTransaction.weddingStaffAssignment.updateMany({
        where: { id: staffId, workspaceId, version },
        data: { ...details, version: { increment: 1 } },
      });
    });
  } catch (error) {
    return writeFailureState(
      error,
      "目前無法更新工作人員，請稍後再試。",
    );
  }

  if (result.count === 0) {
    return staleState();
  }
  await revalidateViews(workspaceId);
  return { status: "success", message: "已更新婚禮工作人員。" };
}

export async function deleteWeddingStaffAction(
  workspaceId: string,
  staffId: string,
  _previousState: WeddingStaffMutationState,
  formData: FormData,
): Promise<WeddingStaffMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let version: number;
  try {
    version = expectedVersion(formData);
  } catch (error) {
    return validationState(error);
  }

  let result: CountResult;
  try {
    result = await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      const staffTransaction =
        transaction as unknown as WeddingStaffPrismaClient;
      return staffTransaction.weddingStaffAssignment.deleteMany({
        where: { id: staffId, workspaceId, version },
      });
    });
  } catch (error) {
    return writeFailureState(
      error,
      "目前無法移除工作人員，請稍後再試。",
    );
  }

  if (result.count === 0) {
    return staleState();
  }
  await revalidateViews(workspaceId);
  return { status: "success", message: "已移除婚禮工作人員。" };
}
