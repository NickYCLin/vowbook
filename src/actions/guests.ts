"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import {
  hasGuestDetails,
  normalizeGuestDetailsInput,
  type NormalizedGuestDetailsInput,
  validateGuestRequirementsWithinPartySize,
} from "@/domain/guest-details";
import {
  GuestValidationError,
  effectiveGuestSeniority,
  normalizeGuestInput,
  normalizeGuestVersion,
  type NormalizedGuestInput,
} from "@/domain/guest";
import {
  canGuestCheckIn,
  normalizeGuestCheckInExpectedVersion,
} from "@/domain/guest-check-in";
import { normalizeWeddingGiftExpectedVersion } from "@/domain/wedding-gift";
import { effectiveGuestDetailValue } from "@/domain/guest-detail-value";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import {
  runSerializableTransaction,
  SerializationConflictError,
} from "@/lib/serializable-transaction";
import {
  GUEST_DETAILS_FIELDS,
  upsertManualGuestDetails,
} from "@/lib/guest-manual-details";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

export type GuestMutationState = {
  status: "idle" | "success" | "error";
  message?: string;
};

class GuestRecordNotFoundError extends Error {}

class GuestStaleWriteError extends Error {}

class GuestPartyCapacityError extends Error {}

/**
 * 刪除賓客會 cascade 掉禮金與報到紀錄。操作者必須連同自己看到的那一筆
 * 一起送回來，server 才敢刪；否則畫面沒顯示的紀錄會被無聲清掉。
 */
type ExpectedCascadeSnapshot = {
  id: string;
  version: number;
} | null;

type LockedGuestDeleteRow = { id: string };
type LockedCascadeDeleteRow = { id: string; version: number };

const GUEST_DETAILS_FORM_FIELDS = GUEST_DETAILS_FIELDS;

/**
 * 失敗時只留下操作別與 Prisma 錯誤碼，讓線上問題可追查，
 * 又不會把賓客姓名、聯絡方式或資料庫訊息寫進 log。
 */
function logGuestMutationFailure(
  action: "create" | "update" | "delete",
  error: unknown,
): void {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^P\d{4}$/u.test(error.code)
      ? error.code
      : null;
  console.error("賓客操作失敗。", {
    action,
    error: error instanceof Error ? error.constructor.name : typeof error,
    code,
  });
}

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

async function revalidateGuestViews(workspaceId: string): Promise<boolean> {
  const revalidations = [
    () => revalidatePath(guestPath(workspaceId)),
    () => revalidatePath("/dashboard"),
    () => revalidatePath(tablesPath(workspaceId)),
    () => revalidatePath(`/workspaces/${workspaceId}/tables/print`),
    () => revalidatePath(`/workspaces/${workspaceId}/overview`),
    () => revalidatePath(`/workspaces/${workspaceId}/check-in`),
    () => revalidatePath(`/workspaces/${workspaceId}/gifts`),
    () => revalidatePath(`/workspaces/${workspaceId}/guests/cakes`),
    () => revalidatePath(`/workspaces/${workspaceId}/gifts/print`),
    () => revalidatePath(`/workspaces/${workspaceId}/tables/chart`),
  ];
  let revalidated = true;

  for (const revalidate of revalidations) {
    try {
      await revalidate();
    } catch {
      revalidated = false;
      console.error("賓客相關頁面重新驗證失敗。");
    }
  }

  return revalidated;
}

function guestSuccessState(
  message: string,
  revalidated: boolean,
): GuestMutationState {
  return {
    status: "success",
    message: revalidated
      ? message
      : `${message.replace(/。$/u, "")}；畫面未自動更新，請重新整理。`,
  };
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
  partySize: number,
): NormalizedGuestDetailsInput {
  const details = normalizeGuestDetailsInput({
    relationshipLabel: formData.get("relationshipLabel"),
    contactPhone: formData.get("contactPhone"),
    contactEmail: formData.get("contactEmail"),
    childSeatCount: formData.get("childSeatCount"),
    vegetarianCount: formData.get("vegetarianCount"),
    invitationDelivery: formData.get("invitationDelivery"),
    mailingAddress: formData.get("mailingAddress"),
    guestMessage: formData.get("guestMessage"),
    attendanceReply: formData.get("attendanceReply"),
    invitationReply: formData.get("invitationReply"),
  });
  validateGuestRequirementsWithinPartySize(details, partySize);
  return details;
}

function expectedCascadeSnapshotFromFormData(
  formData: FormData,
  {
    idField,
    versionField,
    normalizeVersion,
    invalidMessage,
  }: {
    idField: string;
    versionField: string;
    normalizeVersion: (value: unknown) => number;
    invalidMessage: string;
  },
): ExpectedCascadeSnapshot {
  const id = formData.get(idField);
  const version = formData.get(versionField);
  const hasId = id !== null && id !== "";
  const hasVersion = version !== null && version !== "";

  if (!hasId && !hasVersion) return null;
  if (
    !hasId ||
    !hasVersion ||
    typeof id !== "string" ||
    id.length > 191 ||
    id.trim() !== id
  ) {
    throw new GuestValidationError(invalidMessage);
  }

  return { id, version: normalizeVersion(version) };
}

function expectedWeddingGiftSnapshotFromFormData(
  formData: FormData,
): ExpectedCascadeSnapshot {
  return expectedCascadeSnapshotFromFormData(formData, {
    idField: "expectedWeddingGiftId",
    versionField: "expectedWeddingGiftVersion",
    normalizeVersion: normalizeWeddingGiftExpectedVersion,
    invalidMessage: "禮金快照資訊無效，請重新整理後再試。",
  });
}

function expectedGuestCheckInSnapshotFromFormData(
  formData: FormData,
): ExpectedCascadeSnapshot {
  return expectedCascadeSnapshotFromFormData(formData, {
    idField: "expectedGuestCheckInId",
    versionField: "expectedGuestCheckInVersion",
    normalizeVersion: normalizeGuestCheckInExpectedVersion,
    invalidMessage: "報到快照資訊無效，請重新整理後再試。",
  });
}

function cascadeSnapshotMatches(
  locked: readonly LockedCascadeDeleteRow[],
  expected: ExpectedCascadeSnapshot,
): boolean {
  if (!expected) return locked.length === 0;
  const current = locked[0] ?? null;
  return (
    locked.length === 1 &&
    current?.id === expected.id &&
    current.version === expected.version
  );
}

function includesGuestDetailsFields(formData: FormData): boolean {
  return GUEST_DETAILS_FORM_FIELDS.some((field) => formData.has(field));
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
    details = guestDetailsFromFormData(formData, input.partySize);
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
        data: { workspaceId, ...input, seniority: effectiveGuestSeniority(input.seniority) },
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
    if (error instanceof SerializationConflictError) {
      return { status: "error", message: error.message };
    }
    logGuestMutationFailure("create", error);
    return {
      status: "error",
      message: "目前無法新增賓客，請稍後再試。",
    };
  }

  return guestSuccessState(
    "已新增賓客。",
    await revalidateGuestViews(workspaceId),
  );
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
      ? guestDetailsFromFormData(formData, input.partySize)
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
          partySize: true,
          seatingTableId: true,
          checkIn: { select: { id: true } },
        },
      });
      if (!guest) {
        throw new GuestRecordNotFoundError();
      }
      if (guest.version !== expectedVersion) {
        throw new GuestStaleWriteError();
      }
      if (guest.checkIn && !canGuestCheckIn(input)) {
        throw new GuestValidationError(
          "此名單已有報到紀錄，請先取消報到，再變更為未確認、不出席或新人。",
        );
      }

      if (details === null && input.partySize < guest.partySize) {
        const detailRecords = await transaction.guestImportRecord.findMany({
          where: { guestId, workspaceId },
          orderBy: [{ source: "asc" }, { sourceInstance: "asc" }],
          select: {
            source: true,
            sourceInstance: true,
            sourceManaged: true,
            childSeatCount: true,
            vegetarianCount: true,
          },
        });
        validateGuestRequirementsWithinPartySize(
          {
            childSeatCount: effectiveGuestDetailValue(
              detailRecords,
              (record) => record.childSeatCount,
            ),
            vegetarianCount: effectiveGuestDetailValue(
              detailRecords,
              (record) => record.vegetarianCount,
            ),
          },
          input.partySize,
        );
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
    if (error instanceof GuestValidationError) {
      return validationState(error);
    }
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

    logGuestMutationFailure("update", error);
    return {
      status: "error",
      message: "目前無法更新賓客，請稍後再試。",
    };
  }

  return guestSuccessState(
    removedFromTable
      ? "已更新賓客；已從桌次移除不出席者。"
      : "已更新賓客。",
    await revalidateGuestViews(workspaceId),
  );
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
  let expectedWeddingGift: ExpectedCascadeSnapshot;
  let expectedGuestCheckIn: ExpectedCascadeSnapshot;
  try {
    expectedVersion = normalizeGuestVersion(_formData.get("expectedVersion"));
    expectedWeddingGift = expectedWeddingGiftSnapshotFromFormData(_formData);
    expectedGuestCheckIn = expectedGuestCheckInSnapshotFromFormData(_formData);
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
      const lockedGuests = await transaction.$queryRaw<LockedGuestDeleteRow[]>(
        Prisma.sql`
          SELECT "id"
          FROM "guests"
          WHERE "id" = ${guestId}
            AND "workspace_id" = ${workspaceId}
            AND "version" = ${expectedVersion}
          FOR UPDATE
        `,
      );
      if (lockedGuests.length !== 1) throw new GuestStaleWriteError();

      const lockedWeddingGifts =
        await transaction.$queryRaw<LockedCascadeDeleteRow[]>(Prisma.sql`
          SELECT "id", "version"
          FROM "wedding_gifts"
          WHERE "guest_id" = ${guestId}
            AND "workspace_id" = ${workspaceId}
          ORDER BY "id" ASC
          FOR UPDATE
        `);
      if (!cascadeSnapshotMatches(lockedWeddingGifts, expectedWeddingGift)) {
        throw new GuestStaleWriteError();
      }

      const lockedCheckIns =
        await transaction.$queryRaw<LockedCascadeDeleteRow[]>(Prisma.sql`
          SELECT "id", "version"
          FROM "guest_check_ins"
          WHERE "guest_id" = ${guestId}
            AND "workspace_id" = ${workspaceId}
          ORDER BY "id" ASC
          FOR UPDATE
        `);
      if (!cascadeSnapshotMatches(lockedCheckIns, expectedGuestCheckIn)) {
        throw new GuestStaleWriteError();
      }

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
    logGuestMutationFailure("delete", error);
    return {
      status: "error",
      message: "目前無法刪除賓客，請稍後再試。",
    };
  }

  return guestSuccessState(
    "已刪除賓客。",
    await revalidateGuestViews(workspaceId),
  );
}
