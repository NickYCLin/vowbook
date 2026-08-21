"use server";

import { revalidatePath } from "next/cache";
import {
  normalizeWeddingTaskDetails,
  normalizeWeddingTaskSide,
  normalizeWeddingTaskStatus,
  type NormalizedWeddingTaskDetails,
  type WeddingTaskSideValue,
  type WeddingTaskStatusValue,
  WeddingTaskValidationError,
} from "@/domain/wedding-task";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { runSerializableTransaction } from "@/lib/serializable-transaction";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

export type WeddingTaskMutationCode =
  | "VALIDATION"
  | "FORBIDDEN"
  | "STALE"
  | "UNAVAILABLE";

export type WeddingTaskMutationState = {
  status: "idle" | "success" | "error";
  code?: WeddingTaskMutationCode;
  message?: string;
};

type CountResult = { count: number };

type WeddingTaskPrismaClient = {
  weddingTask: {
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<CountResult>;
    deleteMany(args: unknown): Promise<CountResult>;
  };
};

function tasksPath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/tasks`;
}

async function revalidateTaskView(workspaceId: string): Promise<boolean> {
  try {
    await revalidatePath(tasksPath(workspaceId));
    return true;
  } catch {
    console.error("婚宴任務頁面重新驗證失敗。");
    return false;
  }
}

function successAfterRevalidation(
  message: string,
  revalidated: boolean,
): WeddingTaskMutationState {
  return {
    status: "success",
    message: revalidated
      ? message
      : `${message.replace(/。$/u, "")}；畫面未自動更新，請重新整理。`,
  };
}

function validationState(error: unknown): WeddingTaskMutationState {
  return {
    status: "error",
    code: "VALIDATION",
    message:
      error instanceof WeddingTaskValidationError
        ? error.message
        : "輸入內容有誤，請重新確認。",
  };
}

function unavailableState(message: string): WeddingTaskMutationState {
  return { status: "error", code: "UNAVAILABLE", message };
}

function writeFailureState(
  error: unknown,
  fallbackMessage: string,
): WeddingTaskMutationState {
  if (error instanceof WorkspaceAccessDeniedError) {
    return { status: "error", code: "FORBIDDEN", message: error.message };
  }

  return unavailableState(fallbackMessage);
}

function staleState(): WeddingTaskMutationState {
  return {
    status: "error",
    code: "STALE",
    message: "資料已更新或不存在，請重新整理後再試。",
  };
}

async function authorizeWeddingTaskMutation(
  workspaceId: string,
): Promise<string | WeddingTaskMutationState> {
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

type NormalizedWeddingTaskInput = NormalizedWeddingTaskDetails & {
  side: WeddingTaskSideValue;
};

function detailsFromFormData(formData: FormData): NormalizedWeddingTaskInput {
  return {
    ...normalizeWeddingTaskDetails({
      title: formData.get("title"),
      description: formData.get("description"),
      dueDate: formData.get("dueDate"),
    }),
    side: normalizeWeddingTaskSide(formData.get("side")),
  };
}

function expectedVersionFromFormData(formData: FormData): number {
  const value = formData.get("expectedVersion");
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    throw new WeddingTaskValidationError(
      "版本資訊無效，請重新整理後再試。",
    );
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new WeddingTaskValidationError(
      "版本資訊無效，請重新整理後再試。",
    );
  }

  return parsed;
}

async function returnStaleAfterRevalidation(
  workspaceId: string,
): Promise<WeddingTaskMutationState> {
  await revalidateTaskView(workspaceId);
  return staleState();
}

export async function createWeddingTaskAction(
  workspaceId: string,
  _previousState: WeddingTaskMutationState,
  formData: FormData,
): Promise<WeddingTaskMutationState> {
  const authorization = await authorizeWeddingTaskMutation(workspaceId);
  if (typeof authorization !== "string") {
    return authorization;
  }

  let details: NormalizedWeddingTaskInput;
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
      const taskTransaction = transaction as unknown as WeddingTaskPrismaClient;
      await taskTransaction.weddingTask.create({
        data: {
          workspaceId,
          ...details,
          status: "TODO",
          completedAt: null,
        },
      });
    });
  } catch (error) {
    return writeFailureState(
      error,
      "目前無法新增婚宴任務，請稍後再試。",
    );
  }

  return successAfterRevalidation(
    "已新增婚宴任務。",
    await revalidateTaskView(workspaceId),
  );
}

export async function updateWeddingTaskAction(
  workspaceId: string,
  taskId: string,
  _previousState: WeddingTaskMutationState,
  formData: FormData,
): Promise<WeddingTaskMutationState> {
  const authorization = await authorizeWeddingTaskMutation(workspaceId);
  if (typeof authorization !== "string") {
    return authorization;
  }

  let details: NormalizedWeddingTaskInput;
  let expectedVersion: number;
  try {
    details = detailsFromFormData(formData);
    expectedVersion = expectedVersionFromFormData(formData);
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
      const taskTransaction = transaction as unknown as WeddingTaskPrismaClient;
      return taskTransaction.weddingTask.updateMany({
        where: { id: taskId, workspaceId, version: expectedVersion },
        data: { ...details, version: { increment: 1 } },
      });
    });
  } catch (error) {
    return writeFailureState(error, "目前無法更新任務內容，請稍後再試。");
  }

  if (result.count === 0) {
    return returnStaleAfterRevalidation(workspaceId);
  }

  return successAfterRevalidation(
    "已更新任務內容。",
    await revalidateTaskView(workspaceId),
  );
}

export async function changeWeddingTaskStatusAction(
  workspaceId: string,
  taskId: string,
  targetStatusValue: unknown,
  _previousState: WeddingTaskMutationState,
  formData: FormData,
): Promise<WeddingTaskMutationState> {
  const authorization = await authorizeWeddingTaskMutation(workspaceId);
  if (typeof authorization !== "string") {
    return authorization;
  }

  let targetStatus: WeddingTaskStatusValue;
  let expectedVersion: number;
  try {
    targetStatus = normalizeWeddingTaskStatus(targetStatusValue);
    expectedVersion = expectedVersionFromFormData(formData);
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
      const taskTransaction = transaction as unknown as WeddingTaskPrismaClient;

      if (targetStatus === "DONE") {
        let statusResult = await taskTransaction.weddingTask.updateMany({
          where: {
            id: taskId,
            workspaceId,
            version: expectedVersion,
            status: { not: "DONE" },
          },
          data: {
            status: "DONE",
            completedAt: new Date(),
            version: { increment: 1 },
          },
        });

        if (statusResult.count === 0) {
          statusResult = await taskTransaction.weddingTask.updateMany({
            where: {
              id: taskId,
              workspaceId,
              version: expectedVersion,
              status: "DONE",
            },
            data: { version: { increment: 1 } },
          });
        }

        return statusResult;
      }

      return taskTransaction.weddingTask.updateMany({
        where: { id: taskId, workspaceId, version: expectedVersion },
        data: {
          status: targetStatus,
          completedAt: null,
          version: { increment: 1 },
        },
      });
    });
  } catch (error) {
    return writeFailureState(error, "目前無法更新任務狀態，請稍後再試。");
  }

  if (result.count === 0) {
    return returnStaleAfterRevalidation(workspaceId);
  }

  return successAfterRevalidation(
    "已更新任務狀態。",
    await revalidateTaskView(workspaceId),
  );
}

export async function deleteWeddingTaskAction(
  workspaceId: string,
  taskId: string,
  _previousState: WeddingTaskMutationState,
  formData: FormData,
): Promise<WeddingTaskMutationState> {
  const authorization = await authorizeWeddingTaskMutation(workspaceId);
  if (typeof authorization !== "string") {
    return authorization;
  }

  let expectedVersion: number;
  try {
    expectedVersion = expectedVersionFromFormData(formData);
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
      const taskTransaction = transaction as unknown as WeddingTaskPrismaClient;
      return taskTransaction.weddingTask.deleteMany({
        where: { id: taskId, workspaceId, version: expectedVersion },
      });
    });
  } catch (error) {
    return writeFailureState(error, "目前無法刪除婚宴任務，請稍後再試。");
  }

  if (result.count === 0) {
    return returnStaleAfterRevalidation(workspaceId);
  }

  return successAfterRevalidation(
    "已刪除婚宴任務。",
    await revalidateTaskView(workspaceId),
  );
}
