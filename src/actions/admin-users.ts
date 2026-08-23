"use server";

import type { UserAccessStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { runSerializableTransaction } from "@/lib/serializable-transaction";
import {
  requireSystemAdmin,
  SystemAdminAccessDeniedError,
  SystemAdminConfigurationError,
  SystemAdminProtectedUserError,
  SystemAdminStaleWriteError,
  updateSystemUserAccessStatus,
} from "@/lib/system-admin";

export type SystemUserMutationCode =
  | "VALIDATION"
  | "FORBIDDEN"
  | "PROTECTED"
  | "STALE"
  | "UNAVAILABLE";

export type SystemUserMutationState = {
  status: "idle" | "success" | "error";
  code?: SystemUserMutationCode;
  message?: string;
};

const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const ACCESS_STATUSES = new Set<UserAccessStatus>([
  "ACTIVE",
  "SUSPENDED",
  "REMOVED",
]);

function parseMutation(formData: FormData): {
  targetUserId: string;
  expectedVersion: number;
  accessStatus: UserAccessStatus;
} | null {
  const targetUserId = formData.get("targetUserId");
  const rawVersion = formData.get("expectedVersion");
  const rawStatus = formData.get("accessStatus");
  if (
    typeof targetUserId !== "string" ||
    !USER_ID_PATTERN.test(targetUserId) ||
    typeof rawVersion !== "string" ||
    !/^\d+$/u.test(rawVersion) ||
    typeof rawStatus !== "string" ||
    !ACCESS_STATUSES.has(rawStatus as UserAccessStatus)
  ) {
    return null;
  }

  const expectedVersion = Number(rawVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) return null;
  return {
    targetUserId,
    expectedVersion,
    accessStatus: rawStatus as UserAccessStatus,
  };
}

function successMessage(accessStatus: UserAccessStatus): string {
  if (accessStatus === "SUSPENDED") return "已停權這位使用者。";
  if (accessStatus === "REMOVED") return "已移除這位使用者的登入權限。";
  return "已恢復這位使用者的登入權限。";
}

export async function updateSystemUserAccessAction(
  _previousState: SystemUserMutationState,
  formData: FormData,
): Promise<SystemUserMutationState> {
  let admin;
  try {
    admin = await requireSystemAdmin();
  } catch (error) {
    if (error instanceof SystemAdminAccessDeniedError) {
      return {
        status: "error",
        code: "FORBIDDEN",
        message: "無法執行系統管理操作。",
      };
    }
    return {
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法確認系統管理權限，請稍後再試。",
    };
  }

  const mutation = parseMutation(formData);
  if (!mutation) {
    return {
      status: "error",
      code: "VALIDATION",
      message: "操作資料無效，請重新整理後再試。",
    };
  }

  try {
    await runSerializableTransaction(async (transaction) => {
      await updateSystemUserAccessStatus(
        admin,
        mutation.targetUserId,
        mutation.expectedVersion,
        mutation.accessStatus,
        transaction,
      );
    });
  } catch (error) {
    if (error instanceof SystemAdminProtectedUserError) {
      return { status: "error", code: "PROTECTED", message: error.message };
    }
    if (error instanceof SystemAdminStaleWriteError) {
      return { status: "error", code: "STALE", message: error.message };
    }
    if (
      error instanceof SystemAdminAccessDeniedError ||
      error instanceof SystemAdminConfigurationError
    ) {
      return {
        status: "error",
        code: "FORBIDDEN",
        message: "無法執行系統管理操作。",
      };
    }
    return {
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法更新使用者狀態，請稍後再試。",
    };
  }

  try {
    revalidatePath("/admin/users");
  } catch {
    console.error("系統使用者列表重新驗證失敗。");
  }
  return { status: "success", message: successMessage(mutation.accessStatus) };
}
