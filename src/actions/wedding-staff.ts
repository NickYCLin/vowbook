"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import {
  normalizeWeddingStaffDetails,
  type NormalizedWeddingStaffDetails,
  WeddingStaffValidationError,
} from "@/domain/wedding-staff";
import {
  isWeddingStaffTimelineAssignmentFingerprint,
  weddingStaffTimelineAssignmentFingerprint,
} from "@/domain/wedding-staff-timeline-snapshot";
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
    findFirst(args: unknown): Promise<{
      redEnvelopeAmount: number | null;
      redEnvelopeSentAt: Date | null;
      version: number;
    } | null>;
    updateMany(args: unknown): Promise<CountResult>;
    deleteMany(args: unknown): Promise<CountResult>;
  };
};

type LockedWeddingStaffRow = { id: string };
type LockedTimelineAssignmentRow = { timelineItemId: string };

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
    needsMeal: formData.get("needsMeal"),
    mealCount: formData.get("mealCount"),
    vegetarianMealCount: formData.get("vegetarianMealCount"),
    redEnvelopeAmount: formData.get("redEnvelopeAmount"),
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

function expectedTimelineAssignmentFingerprint(formData: FormData): string {
  const value = formData.get("expectedTimelineAssignmentFingerprint");
  if (!isWeddingStaffTimelineAssignmentFingerprint(value)) {
    throw new WeddingStaffValidationError(
      "流程指派快照無效，請重新整理後再試。",
    );
  }
  return value;
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

  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2003") return { status: "error", code: "VALIDATION", message: "此人員仍有總召交辦事項，請先到總召交辦解除負責人關聯，再移除人員。" };
  return { status: "error", code: "UNAVAILABLE", message: fallbackMessage };
}

function staleState(): WeddingStaffMutationState {
  return {
    status: "error",
    code: "STALE",
    message: "資料已更新或不存在，請重新整理後再試。",
  };
}

async function revalidateViews(workspaceId: string): Promise<boolean> {
  let succeeded = true;
  for (const path of [
    `/workspaces/${workspaceId}/staff`,
    `/workspaces/${workspaceId}/timeline`,
    `/workspaces/${workspaceId}/overview`,
    `/workspaces/${workspaceId}/staff/handoffs`,
    `/workspaces/${workspaceId}/staff/print`,
  ]) {
    try {
      await revalidatePath(path);
    } catch {
      succeeded = false;
    }
  }
  if (!succeeded) {
    console.error("婚禮工作人員頁面重新驗證失敗。");
  }
  return succeeded;
}

function committedSuccessMessage(message: string, revalidated: boolean): string {
  return revalidated
    ? message
    : `${message.replace(/。$/u, "")}；畫面未自動更新，請重新整理。`;
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

  const revalidated = await revalidateViews(workspaceId);
  return {
    status: "success",
    message: committedSuccessMessage("已新增婚禮工作人員。", revalidated),
  };
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
  const revalidated = await revalidateViews(workspaceId);
  return {
    status: "success",
    message: committedSuccessMessage("已更新婚禮工作人員。", revalidated),
  };
}

/**
 * 婚宴結束時逐一發紅包。發放時間由 server 決定，client 只送「已發／未發」；
 * 重複標記已發放時保留原本的時間，不因為再點一次就往後跳。
 */
export async function setWeddingStaffRedEnvelopeSentAction(
  workspaceId: string,
  staffId: string,
  _previousState: WeddingStaffMutationState,
  formData: FormData,
): Promise<WeddingStaffMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let version: number;
  let markSent: boolean;
  try {
    version = expectedVersion(formData);
    const rawSent = formData.get("redEnvelopeSent");
    if (rawSent !== null && rawSent !== "on" && rawSent !== "") {
      throw new WeddingStaffValidationError(
        "紅包發放狀態無效，請重新整理後再試。",
      );
    }
    markSent = rawSent === "on";
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
      const current =
        await staffTransaction.weddingStaffAssignment.findFirst({
          where: { id: staffId, workspaceId },
          select: {
            redEnvelopeAmount: true,
            redEnvelopeSentAt: true,
            version: true,
          },
        });
      if (!current || current.version !== version) {
        return { count: 0 };
      }
      // 沒有紅包金額就沒有東西可發，資料庫的 CHECK 也會擋下來。
      if (markSent && current.redEnvelopeAmount === null) {
        throw new WeddingStaffValidationError(
          "請先填寫紅包金額，再標記為已發放。",
        );
      }
      return staffTransaction.weddingStaffAssignment.updateMany({
        where: { id: staffId, workspaceId, version },
        data: {
          redEnvelopeSentAt: markSent
            ? (current.redEnvelopeSentAt ?? new Date())
            : null,
          version: { increment: 1 },
        },
      });
    });
  } catch (error) {
    if (error instanceof WeddingStaffValidationError) {
      return validationState(error);
    }
    return writeFailureState(
      error,
      "目前無法更新紅包發放狀態，請稍後再試。",
    );
  }

  if (result.count === 0) return staleState();
  const revalidated = await revalidateViews(workspaceId);
  return {
    status: "success",
    message: committedSuccessMessage(
      markSent ? "已標記紅包為已發放。" : "已改回尚未發放紅包。",
      revalidated,
    ),
  };
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
  let timelineAssignmentFingerprint: string;
  try {
    version = expectedVersion(formData);
    timelineAssignmentFingerprint =
      expectedTimelineAssignmentFingerprint(formData);
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
      const lockedStaff = await transaction.$queryRaw<LockedWeddingStaffRow[]>(
        Prisma.sql`
          SELECT "id"
          FROM "wedding_staff_assignments"
          WHERE "id" = ${staffId}
            AND "workspace_id" = ${workspaceId}
            AND "version" = ${version}
          FOR UPDATE
        `,
      );
      if (lockedStaff.length !== 1) return { count: 0 };

      const lockedAssignments =
        await transaction.$queryRaw<LockedTimelineAssignmentRow[]>(Prisma.sql`
          SELECT "timeline_item_id" AS "timelineItemId"
          FROM "wedding_timeline_staff_assignments"
          WHERE "staff_assignment_id" = ${staffId}
            AND "workspace_id" = ${workspaceId}
          ORDER BY "timeline_item_id" ASC
          FOR UPDATE
        `);
      if (
        weddingStaffTimelineAssignmentFingerprint(
          lockedAssignments.map((assignment) => assignment.timelineItemId),
        ) !== timelineAssignmentFingerprint
      ) {
        return { count: 0 };
      }

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
  const revalidated = await revalidateViews(workspaceId);
  return {
    status: "success",
    message: committedSuccessMessage("已移除婚禮工作人員。", revalidated),
  };
}
