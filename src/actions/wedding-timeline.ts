"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  normalizeWeddingTimelineDetails,
  normalizeWeddingTimelineStaffIds,
  type NormalizedWeddingTimelineDetails,
  WeddingTimelineValidationError,
} from "@/domain/wedding-timeline";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { runSerializableTransaction } from "@/lib/serializable-transaction";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

export type WeddingTimelineMutationCode =
  | "VALIDATION"
  | "FORBIDDEN"
  | "STALE"
  | "CONFLICT"
  | "UNAVAILABLE";

export type WeddingTimelineMutationState = {
  status: "idle" | "success" | "error";
  code?: WeddingTimelineMutationCode;
  message?: string;
};

class TimelineStaffMismatchError extends WeddingTimelineValidationError {}
class TimelineNotEmptyError extends Error {}
class TimelineStaleError extends Error {}

const GENERAL_LUNCH_TIMELINE = [
  {
    startMinute: 570,
    endMinute: 600,
    phase: "準備",
    title: "前置作業",
    location: null,
    details:
      "主持人報到並與新人確認當日流程。\n09:40 第一次進場彩排。\n彩排後安排拍攝與休息。",
    mediaCue: "音樂、燈光一起",
    notes: "與場館影音及小管家確認",
  },
  {
    startMinute: 600,
    endMinute: 630,
    phase: "準備",
    title: "拍照時間",
    location: "宴會廳／儀式空間",
    details: "宴會廳拍攝與休息。\n10:25 移動至儀式空間。",
    mediaCue: "迎賓音樂",
    notes: null,
  },
  {
    startMinute: 630,
    endMinute: 680,
    phase: "儀式",
    title: "證婚儀式",
    location: "儀式空間",
    details:
      "主持人開場。\n新郎進場。\n新娘持捧花進場。\n趣味宣誓。\n交換戒指（新郎先）。\n謝親恩。\n大合照。\n11:20 換裝。",
    mediaCue: "01 新郎進場、02 新娘進場、03 宣誓／交換戒指、04 謝親恩",
    notes: "待確認：捧花、麥克風、戒指戒盒、感謝詞及合照順序。",
  },
  {
    startMinute: 690,
    endMinute: 720,
    phase: "迎賓",
    title: "迎賓",
    location: null,
    details: "收禮與招待就位。\n宣傳拍貼活動。\n開始前 5 分鐘預告。",
    mediaCue: "婚紗輪播、迎賓音樂",
    notes: null,
  },
  {
    startMinute: 720,
    endMinute: 740,
    phase: "進場",
    title: "第一次進場",
    location: null,
    details:
      "花童進場。\n雙方主婚人進場。\n新人持捧花進場。\n邀請雙方主婚人上台。\n舉杯感謝。\n入席開餐。",
    mediaCue: "01 小花童進場、02 雙方主婚人進場、03 新人進場、04 舉杯",
    notes: "準備捧花與酒杯 6 杯。",
  },
  {
    startMinute: 740,
    endMinute: 795,
    phase: "用餐",
    title: "用餐",
    location: null,
    details:
      "賓客用餐。\n新人於第二道菜前退場。\n主桌前拍全體大合照。\n換裝 25 分鐘。",
    mediaCue: "婚紗輪播、用餐音樂",
    notes: null,
  },
  {
    startMinute: 795,
    endMinute: 825,
    phase: "進場",
    title: "第二次進場",
    location: null,
    details:
      "指定 Pose 拍照進場。\n以兩桌為單位合照。\n捧花遊戲。\n花椰菜遊戲。\n全場快問快答（最多 8 題，每題 10 秒）。\n入席準備敬酒。",
    mediaCue: "05 新人二進、06 捧花遊戲、07 花椰菜遊戲、08 全場遊戲",
    notes:
      "準備 Pose 簡報、遊戲簡報／道具、主題禮物、分貝機、酒杯 6 杯。",
  },
  {
    startMinute: 825,
    endMinute: 870,
    phase: "敬酒",
    title: "敬酒",
    location: null,
    details: "賓客用餐並逐桌敬酒。\n結束後換裝 25 分鐘。",
    mediaCue: "婚紗輪播、敬酒音樂",
    notes: "場館人員協助引導",
  },
  {
    startMinute: 870,
    endMinute: null,
    phase: "送客",
    title: "送客",
    location: "拍照區",
    details: "主持廣播婚宴圓滿完成。\n新人於拍照區等候送客。",
    mediaCue: "送客音樂",
    notes: "準備喜糖與提籃",
  },
] as const;

async function authorize(
  workspaceId: string,
): Promise<string | WeddingTimelineMutationState> {
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

function parsedForm(formData: FormData): {
  details: NormalizedWeddingTimelineDetails;
  staffIds: string[];
} {
  return {
    details: normalizeWeddingTimelineDetails({
      startTime: formData.get("startTime"),
      endTime: formData.get("endTime"),
      phase: formData.get("phase"),
      title: formData.get("title"),
      location: formData.get("location"),
      details: formData.get("details"),
      mediaCue: formData.get("mediaCue"),
      notes: formData.get("notes"),
    }),
    staffIds: normalizeWeddingTimelineStaffIds(formData.getAll("staffIds")),
  };
}

function expectedVersion(formData: FormData): number {
  const raw = formData.get("expectedVersion");
  if (typeof raw !== "string" || !/^\d+$/u.test(raw)) {
    throw new WeddingTimelineValidationError(
      "版本資訊無效，請重新整理後再試。",
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new WeddingTimelineValidationError(
      "版本資訊無效，請重新整理後再試。",
    );
  }
  return value;
}

async function verifyStaff(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  staffIds: string[],
): Promise<void> {
  if (staffIds.length === 0) return;
  const records = await transaction.weddingStaffAssignment.findMany({
    where: { workspaceId, id: { in: staffIds } },
    select: { id: true },
  });
  if (
    records.length !== staffIds.length ||
    new Set(records.map((record) => record.id)).size !== staffIds.length
  ) {
    throw new TimelineStaffMismatchError(
      "工作人員指派已變更，請重新整理後再試。",
    );
  }
}

function validationState(error: unknown): WeddingTimelineMutationState {
  return {
    status: "error",
    code: "VALIDATION",
    message:
      error instanceof WeddingTimelineValidationError
        ? error.message
        : "輸入內容有誤，請重新確認。",
  };
}

async function revalidateTimeline(workspaceId: string): Promise<void> {
  try {
    await revalidatePath(`/workspaces/${workspaceId}/timeline`);
  } catch {
    console.error("婚禮總流程頁面重新驗證失敗。");
  }
}

export async function createWeddingTimelineItemAction(
  workspaceId: string,
  _previousState: WeddingTimelineMutationState,
  formData: FormData,
): Promise<WeddingTimelineMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  let parsed: ReturnType<typeof parsedForm>;
  try {
    parsed = parsedForm(formData);
  } catch (error) {
    return validationState(error);
  }

  try {
    await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        currentUserId,
        "edit",
        transaction,
      );
      await verifyStaff(transaction, workspaceId, parsed.staffIds);
      await transaction.weddingTimelineItem.create({
        data: {
          workspaceId,
          ...parsed.details,
          staffAssignments: {
            create: parsed.staffIds.map((staffAssignmentId) => ({
              staffAssignmentId,
            })),
          },
        },
      });
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return { status: "error", code: "FORBIDDEN", message: error.message };
    }
    if (error instanceof WeddingTimelineValidationError) {
      return validationState(error);
    }
    return {
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法新增流程項目，請稍後再試。",
    };
  }

  await revalidateTimeline(workspaceId);
  return { status: "success", message: "已新增流程項目。" };
}

export async function updateWeddingTimelineItemAction(
  workspaceId: string,
  itemId: string,
  _previousState: WeddingTimelineMutationState,
  formData: FormData,
): Promise<WeddingTimelineMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  let parsed: ReturnType<typeof parsedForm>;
  let version: number;
  try {
    parsed = parsedForm(formData);
    version = expectedVersion(formData);
  } catch (error) {
    return validationState(error);
  }

  try {
    await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        currentUserId,
        "edit",
        transaction,
      );
      const updated = await transaction.weddingTimelineItem.updateMany({
        where: { id: itemId, workspaceId, version },
        data: { ...parsed.details, version: { increment: 1 } },
      });
      if (updated.count === 0) throw new TimelineStaleError();

      await verifyStaff(transaction, workspaceId, parsed.staffIds);
      await transaction.weddingTimelineStaffAssignment.deleteMany({
        where: { timelineItemId: itemId, workspaceId },
      });
      if (parsed.staffIds.length > 0) {
        await transaction.weddingTimelineStaffAssignment.createMany({
          data: parsed.staffIds.map((staffAssignmentId) => ({
            timelineItemId: itemId,
            staffAssignmentId,
            workspaceId,
          })),
        });
      }
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return { status: "error", code: "FORBIDDEN", message: error.message };
    }
    if (error instanceof WeddingTimelineValidationError) {
      return validationState(error);
    }
    if (error instanceof TimelineStaleError) {
      return {
        status: "error",
        code: "STALE",
        message: "資料已更新或不存在，請重新整理後再試。",
      };
    }
    return {
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法更新流程項目，請稍後再試。",
    };
  }

  await revalidateTimeline(workspaceId);
  return { status: "success", message: "已更新流程項目。" };
}

export async function deleteWeddingTimelineItemAction(
  workspaceId: string,
  itemId: string,
  _previousState: WeddingTimelineMutationState,
  formData: FormData,
): Promise<WeddingTimelineMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  let version: number;
  try {
    version = expectedVersion(formData);
  } catch (error) {
    return validationState(error);
  }

  try {
    await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        currentUserId,
        "edit",
        transaction,
      );
      const result = await transaction.weddingTimelineItem.deleteMany({
        where: { id: itemId, workspaceId, version },
      });
      if (result.count === 0) throw new TimelineStaleError();
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return { status: "error", code: "FORBIDDEN", message: error.message };
    }
    if (error instanceof TimelineStaleError) {
      return {
        status: "error",
        code: "STALE",
        message: "資料已更新或不存在，請重新整理後再試。",
      };
    }
    return {
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法刪除流程項目，請稍後再試。",
    };
  }

  await revalidateTimeline(workspaceId);
  return { status: "success", message: "已刪除流程項目。" };
}

export async function applyGeneralLunchTimelineTemplateAction(
  workspaceId: string,
  _previousState: WeddingTimelineMutationState,
): Promise<WeddingTimelineMutationState> {
  void _previousState;
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  try {
    await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        currentUserId,
        "edit",
        transaction,
      );
      const count = await transaction.weddingTimelineItem.count({
        where: { workspaceId },
      });
      if (count !== 0) throw new TimelineNotEmptyError();
      await transaction.weddingTimelineItem.createMany({
        data: GENERAL_LUNCH_TIMELINE.map((item) => ({
          workspaceId,
          ...item,
        })),
      });
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return { status: "error", code: "FORBIDDEN", message: error.message };
    }
    if (error instanceof TimelineNotEmptyError) {
      return {
        status: "error",
        code: "CONFLICT",
        message: "目前已有流程項目，未建立詳細午宴流程範本。",
      };
    }
    return {
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法建立詳細午宴流程範本，請稍後再試。",
    };
  }

  await revalidateTimeline(workspaceId);
  return {
    status: "success",
    message: "已建立詳細午宴流程範本，建立後可自由編輯。",
  };
}
