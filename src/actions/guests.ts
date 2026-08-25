"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import {
  hasGuestDetails,
  normalizeGuestDetailsInput,
  type NormalizedGuestDetailsInput,
} from "@/domain/guest-details";
import {
  GuestValidationError,
  normalizeGuestInput,
  normalizeGuestVersion,
  type NormalizedGuestInput,
} from "@/domain/guest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import {
  runSerializableTransaction,
  SerializationConflictError,
} from "@/lib/serializable-transaction";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

export type GuestMutationState = {
  status: "idle" | "success" | "error";
  message?: string;
};

class GuestRecordNotFoundError extends Error {}

class GuestStaleWriteError extends Error {}

class GuestPartyCapacityError extends Error {}

const MANUAL_DETAILS_SOURCE = "MANUAL";
const MANUAL_DETAILS_SOURCE_INSTANCE = "guest-details";
const MANUAL_DETAILS_SOURCE_LABEL = "自行填寫";
const GUEST_DETAILS_FORM_FIELDS = [
  "relationshipLabel",
  "contactPhone",
  "contactEmail",
  "ceremonyAttendance",
  "childSeatCount",
  "vegetarianCount",
  "invitationDelivery",
  "mailingAddress",
  "guestMessage",
  "attendanceReply",
  "invitationReply",
] as const;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function newlywedConflictState(
  input: NormalizedGuestInput,
): GuestMutationState {
  const role = input.side === "PARTNER_A" ? "新郎" : "新娘";
  return {
    status: "error",
    message: "此工作區已經有" + role + "，請直接編輯原有資料。",
  };
}

function guestPath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/guests`;
}

function tablesPath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/tables`;
}

function revalidateGuestViews(workspaceId: string): void {
  revalidatePath(guestPath(workspaceId));
  revalidatePath("/dashboard");
  revalidatePath(tablesPath(workspaceId));
}

function validationState(error: unknown): GuestMutationState {
  if (error instanceof GuestValidationError) {
    return { status: "error", message: error.message };
  }

  return { status: "error", message: "輸入內容有誤，請重新確認。" };
}

function guestInputFromFormData(formData: FormData): NormalizedGuestInput {
  return normalizeGuestInput({
    name: formData.get("name"),
    category: formData.get("category"),
    seniority: formData.get("seniority"),
    side: formData.get("side"),
    attendanceStatus: formData.get("attendanceStatus"),
    partySize: formData.get("partySize"),
    notes: formData.get("notes"),
  });
}

function guestDetailsFromFormData(
  formData: FormData,
): NormalizedGuestDetailsInput {
  return normalizeGuestDetailsInput({
    relationshipLabel: formData.get("relationshipLabel"),
    contactPhone: formData.get("contactPhone"),
    contactEmail: formData.get("contactEmail"),
    ceremonyAttendance: formData.get("ceremonyAttendance"),
    childSeatCount: formData.get("childSeatCount"),
    vegetarianCount: formData.get("vegetarianCount"),
    invitationDelivery: formData.get("invitationDelivery"),
    mailingAddress: formData.get("mailingAddress"),
    guestMessage: formData.get("guestMessage"),
    attendanceReply: formData.get("attendanceReply"),
    invitationReply: formData.get("invitationReply"),
  });
}

function includesGuestDetailsFields(formData: FormData): boolean {
  return GUEST_DETAILS_FORM_FIELDS.some((field) => formData.has(field));
}

async function upsertManualGuestDetails(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  guestId: string,
  details: NormalizedGuestDetailsInput,
) {
  const identity = {
    workspaceId,
    source: MANUAL_DETAILS_SOURCE,
    sourceInstance: MANUAL_DETAILS_SOURCE_INSTANCE,
    externalId: guestId,
  };
  const provenance = {
    guestId,
    workspaceId,
    source: MANUAL_DETAILS_SOURCE,
    sourceInstance: MANUAL_DETAILS_SOURCE_INSTANCE,
    sourceLabel: MANUAL_DETAILS_SOURCE_LABEL,
    sourceManaged: false,
    managedFields: [],
    externalId: guestId,
    sourcePartySize: null,
    sourceSubmittedAt: null,
  };

  await transaction.guestImportRecord.upsert({
    where: { workspaceId_source_sourceInstance_externalId: identity },
    create: { ...provenance, ...details },
    update: { ...provenance, ...details },
  });
}

async function authorizeGuestMutation(
  workspaceId: string,
): Promise<GuestMutationState | string> {
  const currentUser = await requireCurrentUser();

  try {
    await requireWorkspaceAccess(workspaceId, currentUser.id, "edit");
    return currentUser.id;
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return { status: "error", message: error.message };
    }

    return {
      status: "error",
      message: "目前無法確認工作區權限，請稍後再試。",
    };
  }
}

export async function createGuestAction(
  workspaceId: string,
  _previousState: GuestMutationState,
  formData: FormData,
): Promise<GuestMutationState> {
  const authorization = await authorizeGuestMutation(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  let input: NormalizedGuestInput;
  let details: NormalizedGuestDetailsInput;
  try {
    input = guestInputFromFormData(formData);
    details = guestDetailsFromFormData(formData);
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
      const guest = await transaction.guest.create({
        data: { workspaceId, ...input },
      });
      if (hasGuestDetails(details)) {
        await upsertManualGuestDetails(
          transaction,
          workspaceId,
          guest.id,
          details,
        );
      }
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return { status: "error", message: error.message };
    }
    if (input.category === "COUPLE" && isUniqueConstraintError(error)) {
      return newlywedConflictState(input);
    }
    return {
      status: "error",
      message: "目前無法新增賓客，請稍後再試。",
    };
  }

  revalidateGuestViews(workspaceId);
  return { status: "success", message: "已新增賓客。" };
}

export async function updateGuestAction(
  workspaceId: string,
  guestId: string,
  _previousState: GuestMutationState,
  formData: FormData,
): Promise<GuestMutationState> {
  const authorization = await authorizeGuestMutation(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  let input: NormalizedGuestInput;
  let details: NormalizedGuestDetailsInput | null;
  let expectedVersion: number;
  try {
    input = guestInputFromFormData(formData);
    // 桌次頁的就地人數編輯只送核心欄位；不能把未送出的兒童座椅、
    // 素食等既有資料誤當成空白並覆寫。完整賓客表單會帶這些欄位，
    // 即使值為空也代表使用者明確要清除。
    details = includesGuestDetailsFields(formData)
      ? guestDetailsFromFormData(formData)
      : null;
    expectedVersion = normalizeGuestVersion(formData.get("expectedVersion"));
  } catch (error) {
    return validationState(error);
  }

  let removedFromTable = false;
  try {
    await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        currentUserId,
        "edit",
        transaction,
      );
      const guest = await transaction.guest.findUnique({
        where: { id_workspaceId: { id: guestId, workspaceId } },
        select: {
          id: true,
          version: true,
          seatingTableId: true,
        },
      });
      if (!guest) {
        throw new GuestRecordNotFoundError();
      }
      if (guest.version !== expectedVersion) {
        throw new GuestStaleWriteError();
      }

      const removesFromTable =
        input.attendanceStatus === "DECLINED" && guest.seatingTableId !== null;

      if (guest.seatingTableId && !removesFromTable) {
        const table = await transaction.seatingTable.findUnique({
          where: {
            id_workspaceId: { id: guest.seatingTableId, workspaceId },
          },
          select: { id: true, capacity: true },
        });
        if (!table) {
          throw new GuestRecordNotFoundError();
        }

        const otherGuests = await transaction.guest.aggregate({
          where: {
            workspaceId,
            seatingTableId: guest.seatingTableId,
            NOT: { id: guestId },
          },
          _sum: { partySize: true },
        });
        const otherPartySize = otherGuests._sum.partySize ?? 0;
        if (otherPartySize + input.partySize > table.capacity) {
          throw new GuestPartyCapacityError();
        }
      }

      const result = await transaction.guest.updateMany({
        where: { id: guestId, workspaceId, version: expectedVersion },
        data: {
          ...input,
          ...(removesFromTable ? { seatingTableId: null } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw new GuestStaleWriteError();
      if (details !== null) {
        await upsertManualGuestDetails(
          transaction,
          workspaceId,
          guestId,
          details,
        );
      }
      removedFromTable = removesFromTable;
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return { status: "error", message: error.message };
    }
    if (
      error instanceof GuestRecordNotFoundError ||
      error instanceof GuestStaleWriteError
    ) {
      return {
        status: "error",
        message: "賓客資料已被更新或不存在，請重新整理後再試。",
      };
    }
    if (error instanceof GuestPartyCapacityError) {
      return {
        status: "error",
        message: "調整人數後會超過桌次容量，請先重新安排座位。",
      };
    }

    if (input.category === "COUPLE" && isUniqueConstraintError(error)) {
      return newlywedConflictState(input);
    }

    if (error instanceof SerializationConflictError) {
      return { status: "error", message: error.message };
    }

    return {
      status: "error",
      message: "目前無法更新賓客，請稍後再試。",
    };
  }

  revalidateGuestViews(workspaceId);
  return {
    status: "success",
    message: removedFromTable
      ? "已更新賓客；已從桌次移除不出席者。"
      : "已更新賓客。",
  };
}

export async function deleteGuestAction(
  workspaceId: string,
  guestId: string,
  _previousState: GuestMutationState,
  _formData: FormData,
): Promise<GuestMutationState> {
  void _previousState;

  const authorization = await authorizeGuestMutation(workspaceId);
  if (typeof authorization !== "string") return authorization;
  const currentUserId = authorization;

  let expectedVersion: number;
  try {
    expectedVersion = normalizeGuestVersion(_formData.get("expectedVersion"));
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
      const result = await transaction.guest.deleteMany({
        where: { id: guestId, workspaceId, version: expectedVersion },
      });
      if (result.count !== 1) throw new GuestStaleWriteError();
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return { status: "error", message: error.message };
    }
    if (error instanceof GuestStaleWriteError) {
      return {
        status: "error",
        message: "賓客資料已被更新或不存在，請重新整理後再試。",
      };
    }
    return {
      status: "error",
      message: "目前無法刪除賓客，請稍後再試。",
    };
  }

  revalidateGuestViews(workspaceId);
  return { status: "success", message: "已刪除賓客。" };
}
