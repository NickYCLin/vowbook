"use server";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  SeatingFloorPlanLayoutConflictError,
  resolveSeatingFloorPlanPositions,
} from "@/domain/seating-floor-plan";
import {
  MAX_SEATING_TABLE_COUNT,
  normalizeSeatingTableAdjustmentInput,
  normalizeSeatingTableInput,
  normalizeSeatingTableLayoutInput,
  normalizeSeatingTableVersion,
  type NormalizedSeatingTableAdjustmentInput,
  type NormalizedSeatingTableInput,
  type NormalizedSeatingTableLayoutInput,
  SeatingTableValidationError,
} from "@/domain/seating-table";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import {
  isRetryableTransactionConflict,
  runSerializableTransaction,
  SerializationConflictError,
} from "@/lib/serializable-transaction";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

export type SeatingTableRemovalPreviewTable = {
  position: number;
  name: string;
  capacity: number;
  notes: string | null;
  affectedGuestGroupCount: number;
  affectedGuestPartySize: number;
};

export type SeatingTableAdjustmentConfirmation = {
  operation: "adjust-table-count" | "delete-table";
  targetTableCount: number;
  removedTableCount: number;
  affectedGuestGroupCount: number;
  affectedGuestPartySize: number;
  canConfirm: boolean;
  tables: SeatingTableRemovalPreviewTable[];
  fingerprint: string;
};

export type SeatingTableMutationState =
  | { status: "idle"; message?: string }
  | { status: "success" | "error"; message: string }
  | {
      status: "confirmation";
      stale: boolean;
      message: string;
      confirmation: SeatingTableAdjustmentConfirmation;
    };

class SeatingRecordNotFoundError extends Error {}

class SeatingCapacityError extends Error {}

class SeatingGuestDeclinedError extends Error {}

class SeatingTableStaleError extends Error {}

class SeatingRemovalCountMismatchError extends Error {}

function isUniqueConstraintError(
  error: unknown,
): error is { code: "P2002"; meta?: unknown } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function uniqueConstraintTarget(error: unknown): string[] {
  if (
    !isUniqueConstraintError(error) ||
    !("meta" in error) ||
    typeof error.meta !== "object" ||
    error.meta === null ||
    !("target" in error.meta)
  ) {
    return [];
  }

  const { target } = error.meta;
  if (Array.isArray(target)) {
    return target.map((part) => String(part).toLowerCase());
  }
  return [String(target).toLowerCase()];
}

function uniqueConstraintMatches(
  error: unknown,
  field: "name" | "position",
): boolean {
  const target = uniqueConstraintTarget(error);
  return target.some(
    (part) =>
      part === field ||
      part.endsWith(`_${field}`) ||
      part.includes(`_${field}_key`) ||
      part.includes(`workspace_id_${field}`),
  );
}

async function runSeatingSequenceTransaction<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (isRetryableTransactionConflict(error)) {
        if (attempt === maxAttempts) {
          throw new SerializationConflictError();
        }
        continue;
      }
      if (!isUniqueConstraintError(error) || attempt === maxAttempts) {
        throw error;
      }
    }
  }

  throw new SerializationConflictError();
}

function tablesPath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/tables`;
}

function guestsPath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/guests`;
}

function revalidateSeatingViews(workspaceId: string): void {
  revalidatePath(tablesPath(workspaceId));
  revalidatePath(guestsPath(workspaceId));
}

function tableInputFromFormData(formData: FormData): NormalizedSeatingTableInput {
  return normalizeSeatingTableInput({
    name: formData.get("name"),
    capacity: formData.get("capacity"),
    notes: formData.get("notes"),
  });
}

function adjustmentInputFromFormData(
  formData: FormData,
): NormalizedSeatingTableAdjustmentInput {
  return normalizeSeatingTableAdjustmentInput({
    totalTableCount: formData.get("totalTableCount"),
    defaultCapacity: formData.get("defaultCapacity"),
  });
}

async function lockSeatingTableSequence(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`vowbook:seating:${workspaceId}`}, 0))`;
  const fence = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "wedding_workspaces"
    WHERE "id" = ${workspaceId}
    FOR UPDATE
  `);
  if (fence.length !== 1) {
    throw new SeatingRecordNotFoundError();
  }
}

async function advanceSeatingTableSequence(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  await transaction.$executeRaw(Prisma.sql`
    UPDATE "wedding_workspaces"
    SET "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${workspaceId}
  `);
}

async function lockSeatingTableRows(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "seating_tables"
    WHERE "workspace_id" = ${workspaceId}
    ORDER BY "position" ASC, "id" ASC
    FOR UPDATE
  `);
}

async function lockSeatingAssignmentTable(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  tableId: string,
): Promise<void> {
  const locked = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "seating_tables"
    WHERE "workspace_id" = ${workspaceId}
      AND "id" = ${tableId}
    FOR KEY SHARE
  `);
  if (locked.length !== 1) {
    throw new SeatingRecordNotFoundError();
  }
}

type SeatingSnapshotTable = {
  id: string;
  workspaceId: string;
  position: number;
  version: number;
  name: string;
  capacity: number;
  notes: string | null;
  layoutX: number | null;
  layoutY: number | null;
};

type SeatingSnapshotGuest = {
  id: string;
  version: number;
  partySize: number;
  seatingTableId: string;
};

async function seatingSnapshotTables(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
): Promise<SeatingSnapshotTable[]> {
  return (await transaction.seatingTable.findMany({
    where: { workspaceId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: {
      id: true,
      workspaceId: true,
      position: true,
      version: true,
      name: true,
      capacity: true,
      notes: true,
      layoutX: true,
      layoutY: true,
    },
  })) as SeatingSnapshotTable[];
}

function validateSeatingFloorPlanCandidate(
  tables: SeatingSnapshotTable[],
): void {
  resolveSeatingFloorPlanPositions(tables);
}

type SeatingRemovalOperation =
  | { operation: "adjust-table-count"; targetTableCount: number }
  | { operation: "delete-table"; tableId: string };

const SEATING_REMOVAL_FINGERPRINT_VERSION =
  "vowbook-seating-removal-v1";

function seatingRemovalFingerprint(
  workspaceId: string,
  operation: SeatingRemovalOperation,
  tables: SeatingSnapshotTable[],
  guests: SeatingSnapshotGuest[],
): string {
  const orderedTables = [...tables].sort(
    (left, right) =>
      left.position - right.position || left.id.localeCompare(right.id),
  );
  const orderedGuests = [...guests].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        fingerprintVersion: SEATING_REMOVAL_FINGERPRINT_VERSION,
        workspaceId,
        operation: operation.operation,
        absoluteTarget:
          operation.operation === "adjust-table-count"
            ? { targetTableCount: operation.targetTableCount }
            : { tableId: operation.tableId },
        currentTableCount: orderedTables.length,
        tables: orderedTables.map((table) => ({
          id: table.id,
          position: table.position,
          version: table.version,
          name: table.name,
          capacity: table.capacity,
          notes: table.notes,
        })),
        affectedGuests: orderedGuests.map((guest) => ({
          id: guest.id,
          version: guest.version,
          partySize: guest.partySize,
          seatingTableId: guest.seatingTableId,
        })),
      }),
    )
    .digest("hex");

  return `${SEATING_REMOVAL_FINGERPRINT_VERSION}:${digest}`;
}

/**
 * 一次加好幾桌時的預設桌名。以前要編出「待命名桌 A／B／C」是為了閃開桌名的
 * 唯一限制；桌次的身分改由桌號承擔之後，那串流水字母只是雜訊。
 */
function defaultTableNames(count: number): string[] {
  return Array.from({ length: count }, () => "待命名桌");
}

function submittedRemovalFingerprint(formData: FormData): string | null {
  const value = formData.get("snapshotFingerprint");
  return typeof value === "string" && value !== "" ? value : null;
}

async function seatingRemovalSnapshot(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  operation: SeatingRemovalOperation,
  existingTables?: SeatingSnapshotTable[],
): Promise<{
  allTables: SeatingSnapshotTable[];
  affectedTables: SeatingSnapshotTable[];
  affectedGuests: SeatingSnapshotGuest[];
}> {
  const allTables =
    existingTables ??
    (await seatingSnapshotTables(transaction, workspaceId));

  let affectedTables: SeatingSnapshotTable[];
  if (operation.operation === "adjust-table-count") {
    affectedTables = allTables.slice(operation.targetTableCount);
  } else {
    const target = allTables.find((table) => table.id === operation.tableId);
    if (!target) {
      throw new SeatingRecordNotFoundError();
    }
    affectedTables = [target];
  }

  const affectedTableIds = affectedTables.map((table) => table.id);
  if (affectedTableIds.length > 0) {
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "guests"
      WHERE "workspace_id" = ${workspaceId}
        AND "seating_table_id" IN (${Prisma.join(affectedTableIds)})
      ORDER BY "id" ASC
      FOR UPDATE
    `);
  }
  const affectedGuests =
    affectedTableIds.length === 0
      ? []
      : ((await transaction.guest.findMany({
          where: {
            workspaceId,
            seatingTableId: { in: affectedTableIds },
          },
          orderBy: [{ id: "asc" }],
          select: {
            id: true,
            version: true,
            partySize: true,
            seatingTableId: true,
          },
        })) as SeatingSnapshotGuest[]);

  return { allTables, affectedTables, affectedGuests };
}

function seatingRemovalConfirmation(
  workspaceId: string,
  operation: SeatingRemovalOperation,
  allTables: SeatingSnapshotTable[],
  affectedTables: SeatingSnapshotTable[],
  affectedGuests: SeatingSnapshotGuest[],
): SeatingTableAdjustmentConfirmation {
  const tables = affectedTables.map((table) => {
    const tableGuests = affectedGuests.filter(
      (guest) => guest.seatingTableId === table.id,
    );
    return {
      position: table.position,
      name: table.name,
      capacity: table.capacity,
      notes: table.notes,
      affectedGuestGroupCount: tableGuests.length,
      affectedGuestPartySize: tableGuests.reduce(
        (total, guest) => total + guest.partySize,
        0,
      ),
    };
  });

  return {
    operation: operation.operation,
    targetTableCount:
      operation.operation === "adjust-table-count"
        ? operation.targetTableCount
        : allTables.length - 1,
    removedTableCount: affectedTables.length,
    affectedGuestGroupCount: affectedGuests.length,
    affectedGuestPartySize: affectedGuests.reduce(
      (total, guest) => total + guest.partySize,
      0,
    ),
    canConfirm: affectedGuests.length === 0,
    tables,
    fingerprint: seatingRemovalFingerprint(
      workspaceId,
      operation,
      allTables,
      affectedGuests,
    ),
  };
}

function removalPreviewState(
  operation: SeatingRemovalOperation,
  confirmation: SeatingTableAdjustmentConfirmation,
  submittedFingerprint: string | null,
): SeatingTableMutationState {
  const stale =
    submittedFingerprint !== null &&
    submittedFingerprint !== confirmation.fingerprint;

  if (stale) {
    return {
      status: "confirmation",
      stale: true,
      message: "桌次或賓客安排已變更，請重新確認最新影響。",
      confirmation,
    };
  }

  if (!confirmation.canConfirm) {
    return {
      status: "confirmation",
      stale: false,
      message:
        operation.operation === "adjust-table-count"
          ? "待移除桌次仍有賓客，請先移動賓客後再縮減桌數。"
          : `此桌仍有 ${confirmation.affectedGuestGroupCount} 組、${confirmation.affectedGuestPartySize} 位賓客，請先移動賓客後再刪除桌次。`,
      confirmation,
    };
  }

  return {
    status: "confirmation",
    stale: false,
    message:
      operation.operation === "adjust-table-count"
        ? "縮減桌數會永久移除所列空桌，請確認後再繼續。"
        : "刪除桌次會永久移除此空桌，請確認後再繼續。",
    confirmation,
  };
}

async function previewOrConfirmSeatingRemoval(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  operation: SeatingRemovalOperation,
  submittedFingerprint: string | null,
  existingTables?: SeatingSnapshotTable[],
): Promise<SeatingTableMutationState> {
  const { allTables, affectedTables, affectedGuests } =
    await seatingRemovalSnapshot(
      transaction,
      workspaceId,
      operation,
      existingTables,
    );
  const confirmation = seatingRemovalConfirmation(
    workspaceId,
    operation,
    allTables,
    affectedTables,
    affectedGuests,
  );
  const affectedTableIds = new Set(affectedTables.map((table) => table.id));
  validateSeatingFloorPlanCandidate(
    allTables.filter((table) => !affectedTableIds.has(table.id)),
  );

  if (
    submittedFingerprint === null ||
    submittedFingerprint !== confirmation.fingerprint ||
    !confirmation.canConfirm
  ) {
    return removalPreviewState(
      operation,
      confirmation,
      submittedFingerprint,
    );
  }

  const deletion = await transaction.seatingTable.deleteMany({
    where: {
      workspaceId,
      id: { in: affectedTables.map((table) => table.id) },
    },
  });
  if (deletion.count !== affectedTables.length) {
    throw new SeatingRemovalCountMismatchError();
  }
  await advanceSeatingTableSequence(transaction, workspaceId);

  return operation.operation === "adjust-table-count"
    ? {
        status: "success",
        message: `已縮減為 ${operation.targetTableCount} 桌，並移除 ${affectedTables.length} 桌空桌。`,
      }
    : { status: "success", message: "已刪除空桌。" };
}

function validationState(error: unknown): SeatingTableMutationState {
  if (error instanceof SeatingTableValidationError) {
    return { status: "error", message: error.message };
  }

  return { status: "error", message: "輸入內容有誤，請重新確認。" };
}

function assignmentTableId(formData: FormData): string | null {
  const value = formData.get("tableId");
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  return value.trim();
}

async function authorizeSeatingMutation(
  workspaceId: string,
): Promise<string | SeatingTableMutationState> {
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

function capacityOrConflictState(
  error: unknown,
  fallbackMessage: string,
): SeatingTableMutationState {
  // 桌名不再有唯一限制：好幾桌都叫「男方同事」是常態，桌號才是身分。
  if (uniqueConstraintMatches(error, "position")) {
    return {
      status: "error",
      message: "同時有其他座位變更，請重新確認後再試。",
    };
  }

  if (error instanceof SeatingTableValidationError) {
    return { status: "error", message: error.message };
  }

  if (error instanceof SeatingCapacityError) {
    return { status: "error", message: error.message };
  }

  if (error instanceof SeatingGuestDeclinedError) {
    return {
      status: "error",
      message: "此賓客已標記為不出席，無法安排座位。",
    };
  }

  if (error instanceof SeatingTableStaleError) {
    return {
      status: "error",
      message: "桌次已由其他人更新，請重新載入後再試。",
    };
  }

  if (error instanceof SeatingFloorPlanLayoutConflictError) {
    return {
      status: "error",
      message: "目前場地配置無法安全排列，請調整桌次位置後再試。",
    };
  }

  if (error instanceof SeatingRemovalCountMismatchError) {
    return {
      status: "error",
      message: "桌次已變更，未刪除任何資料；請重新預覽後再試。",
    };
  }

  if (error instanceof SeatingRecordNotFoundError) {
    return {
      status: "error",
      message: "桌次不存在或已被移除，請重新整理後再試。",
    };
  }

  if (error instanceof WorkspaceAccessDeniedError) {
    return { status: "error", message: error.message };
  }

  if (error instanceof SerializationConflictError) {
    return { status: "error", message: error.message };
  }

  return { status: "error", message: fallbackMessage };
}

export async function createSeatingTableAction(
  workspaceId: string,
  _previousState: SeatingTableMutationState,
  formData: FormData,
): Promise<SeatingTableMutationState> {
  const authorization = await authorizeSeatingMutation(workspaceId);
  if (typeof authorization !== "string") {
    return authorization;
  }

  let input: NormalizedSeatingTableInput;
  try {
    input = tableInputFromFormData(formData);
  } catch (error) {
    return validationState(error);
  }

  try {
    await runSeatingSequenceTransaction(async (transaction) => {
      await lockSeatingTableSequence(transaction, workspaceId);
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      const existingTables = await seatingSnapshotTables(
        transaction,
        workspaceId,
      );
      if (existingTables.length >= MAX_SEATING_TABLE_COUNT) {
        throw new SeatingTableValidationError(
          `總桌數不可超過 ${MAX_SEATING_TABLE_COUNT} 桌。`,
        );
      }
      const position =
        existingTables.reduce(
          (maximum, table) => Math.max(maximum, table.position),
          0,
        ) + 1;
      validateSeatingFloorPlanCandidate([
        ...existingTables,
        {
          id: `candidate:${position}`,
          workspaceId,
          position,
          version: 0,
          ...input,
          layoutX: null,
          layoutY: null,
        },
      ]);
      await transaction.seatingTable.create({
        data: { workspaceId, position, ...input },
      });
      await advanceSeatingTableSequence(transaction, workspaceId);
    });
  } catch (error) {
    return capacityOrConflictState(
      error,
      "目前無法新增桌次，請稍後再試。",
    );
  }

  revalidatePath(tablesPath(workspaceId));
  return { status: "success", message: "已新增桌次。" };
}

export async function adjustSeatingTablesAction(
  workspaceId: string,
  _previousState: SeatingTableMutationState,
  formData: FormData,
): Promise<SeatingTableMutationState> {
  void _previousState;
  const authorization = await authorizeSeatingMutation(workspaceId);
  if (typeof authorization !== "string") {
    return authorization;
  }

  let input: NormalizedSeatingTableAdjustmentInput;
  try {
    input = adjustmentInputFromFormData(formData);
  } catch (error) {
    return validationState(error);
  }

  const fingerprint = submittedRemovalFingerprint(formData);

  let result: SeatingTableMutationState;
  try {
    result = await runSeatingSequenceTransaction(async (transaction) => {
      await lockSeatingTableSequence(transaction, workspaceId);
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );

      let tables = await seatingSnapshotTables(transaction, workspaceId);

      if (input.totalTableCount === tables.length) {
        if (fingerprint !== null) {
          return {
            status: "error" as const,
            message: "確認內容與目前桌數不一致，請重新設定後再試。",
          };
        }
        return {
          status: "success" as const,
          message: `目前已是 ${tables.length} 桌，桌次沒有變更。`,
        };
      }

      if (input.totalTableCount > tables.length) {
        if (fingerprint !== null) {
          return {
            status: "error" as const,
            message: "確認內容與目前桌數不一致，請重新設定後再試。",
          };
        }
        const addCount = input.totalTableCount - tables.length;
        const maximumPosition = tables.reduce(
          (maximum, table) => Math.max(maximum, table.position),
          0,
        );
        const names = defaultTableNames(addCount);
        validateSeatingFloorPlanCandidate([
          ...tables,
          ...names.map((name, index) => ({
            id: `candidate:${maximumPosition + index + 1}`,
            workspaceId,
            position: maximumPosition + index + 1,
            version: 0,
            name,
            capacity: input.defaultCapacity,
            notes: null,
            layoutX: null,
            layoutY: null,
          })),
        ]);
        await transaction.seatingTable.createMany({
          data: names.map((name, index) => ({
            workspaceId,
            position: maximumPosition + index + 1,
            name,
            capacity: input.defaultCapacity,
          })),
        });
        await advanceSeatingTableSequence(transaction, workspaceId);
        return {
          status: "success" as const,
          message: `已將總桌數設定為 ${input.totalTableCount} 桌。`,
        };
      }

      await lockSeatingTableRows(transaction, workspaceId);
      tables = await seatingSnapshotTables(transaction, workspaceId);
      return previewOrConfirmSeatingRemoval(
        transaction,
        workspaceId,
        {
          operation: "adjust-table-count",
          targetTableCount: input.totalTableCount,
        },
        fingerprint,
        tables,
      );
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return {
        status: "error",
        message: "同時有其他座位變更，請重新確認後再試。",
      };
    }
    return capacityOrConflictState(
      error,
      "目前無法調整桌數，請稍後再試。",
    );
  }

  if (result.status === "success") {
    revalidateSeatingViews(workspaceId);
  }
  return result;
}

export async function updateSeatingTableAction(
  workspaceId: string,
  tableId: string,
  _previousState: SeatingTableMutationState,
  formData: FormData,
): Promise<SeatingTableMutationState> {
  const authorization = await authorizeSeatingMutation(workspaceId);
  if (typeof authorization !== "string") {
    return authorization;
  }

  let input: NormalizedSeatingTableInput;
  let expectedVersion: number;
  try {
    input = tableInputFromFormData(formData);
    expectedVersion = normalizeSeatingTableVersion(
      formData.get("expectedVersion"),
    );
  } catch (error) {
    return validationState(error);
  }

  try {
    await runSerializableTransaction(async (transaction) => {
      await lockSeatingTableSequence(transaction, workspaceId);
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      const tables = await seatingSnapshotTables(transaction, workspaceId);
      const table = tables.find((candidate) => candidate.id === tableId);
      if (!table) {
        throw new SeatingRecordNotFoundError();
      }
      if (table.version !== expectedVersion) {
        throw new SeatingTableStaleError();
      }

      const assigned = await transaction.guest.aggregate({
        where: { workspaceId, seatingTableId: tableId },
        _sum: { partySize: true },
      });
      const assignedPartySize = assigned._sum.partySize ?? 0;
      if (input.capacity < assignedPartySize) {
        throw new SeatingCapacityError(
          `桌次容量不可低於目前已安排的 ${assignedPartySize} 位。`,
        );
      }

      validateSeatingFloorPlanCandidate(
        tables.map((candidate) =>
          candidate.id === tableId
            ? {
                ...candidate,
                name: input.name,
                capacity: input.capacity,
                notes: input.notes,
              }
            : candidate,
        ),
      );

      const update = await transaction.seatingTable.updateMany({
        where: {
          id: tableId,
          workspaceId,
          version: expectedVersion,
        },
        data: { ...input, version: { increment: 1 } },
      });
      if (update.count !== 1) {
        throw new SeatingTableStaleError();
      }
      await advanceSeatingTableSequence(transaction, workspaceId);
    });
  } catch (error) {
    return capacityOrConflictState(
      error,
      "目前無法更新桌次，請稍後再試。",
    );
  }

  revalidateSeatingViews(workspaceId);
  return { status: "success", message: "已更新桌次。" };
}

export async function updateSeatingTableLayoutAction(
  workspaceId: string,
  tableId: string,
  _previousState: SeatingTableMutationState,
  formData: FormData,
): Promise<SeatingTableMutationState> {
  void _previousState;
  const authorization = await authorizeSeatingMutation(workspaceId);
  if (typeof authorization !== "string") {
    return authorization;
  }

  let input: NormalizedSeatingTableLayoutInput;
  let expectedVersion: number;
  try {
    input = normalizeSeatingTableLayoutInput({
      layoutX: formData.get("layoutX"),
      layoutY: formData.get("layoutY"),
    });
    expectedVersion = normalizeSeatingTableVersion(
      formData.get("expectedVersion"),
    );
  } catch (error) {
    return validationState(error);
  }

  try {
    await runSerializableTransaction(async (transaction) => {
      await lockSeatingTableSequence(transaction, workspaceId);
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      const tables = await seatingSnapshotTables(transaction, workspaceId);
      const table = tables.find((candidate) => candidate.id === tableId);
      if (!table) {
        throw new SeatingRecordNotFoundError();
      }
      if (table.version !== expectedVersion) {
        throw new SeatingTableStaleError();
      }

      validateSeatingFloorPlanCandidate(
        tables.map((candidate) =>
          candidate.id === tableId
            ? {
                ...candidate,
                layoutX: input.layoutX,
                layoutY: input.layoutY,
              }
            : candidate,
        ),
      );

      const update = await transaction.seatingTable.updateMany({
        where: { id: tableId, workspaceId, version: expectedVersion },
        data: {
          layoutX: input.layoutX,
          layoutY: input.layoutY,
          version: { increment: 1 },
        },
      });
      if (update.count !== 1) {
        throw new SeatingTableStaleError();
      }
      await advanceSeatingTableSequence(transaction, workspaceId);
    });
  } catch (error) {
    return capacityOrConflictState(
      error,
      "目前無法更新場地位置，請稍後再試。",
    );
  }

  revalidatePath(tablesPath(workspaceId));
  return input.layoutX === null
    ? { status: "success", message: "已還原自動排列。" }
    : { status: "success", message: "已更新場地位置。" };
}

/**
 * 把所有桌次一次還原成自動排列。
 *
 * 這是絕對語意（最終狀態就是「沒有任何手動座標」），所以不像單桌操作
 * 需要逐桌的 CAS 版本：不管別人同時拖了哪一桌，還原後的結果都一樣。
 * 版本號仍逐桌遞增，其他人正在進行的單桌操作會因版本過期而安全失敗。
 */
export async function resetSeatingTableLayoutsAction(
  workspaceId: string,
  _previousState: SeatingTableMutationState,
  _formData: FormData,
): Promise<SeatingTableMutationState> {
  void _previousState;
  void _formData;
  const authorization = await authorizeSeatingMutation(workspaceId);
  if (typeof authorization !== "string") {
    return authorization;
  }

  let resetCount = 0;
  try {
    await runSerializableTransaction(async (transaction) => {
      await lockSeatingTableSequence(transaction, workspaceId);
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      const update = await transaction.seatingTable.updateMany({
        where: {
          workspaceId,
          OR: [{ layoutX: { not: null } }, { layoutY: { not: null } }],
        },
        data: { layoutX: null, layoutY: null, version: { increment: 1 } },
      });
      resetCount = update.count;
      await advanceSeatingTableSequence(transaction, workspaceId);
    });
  } catch (error) {
    return capacityOrConflictState(
      error,
      "目前無法還原自動排列，請稍後再試。",
    );
  }

  revalidatePath(tablesPath(workspaceId));
  return resetCount === 0
    ? { status: "success", message: "所有桌次都已是自動排列。" }
    : {
        status: "success",
        message: `已將 ${resetCount} 桌還原自動排列。`,
      };
}

/**
 * 固定桌號與場地位置，只交換兩桌的桌名與入座賓客。
 *
 * 桌次 id、position、layout、capacity 與 notes 都代表固定席位；兩張桌與相關
 * 賓客會在同一個 Serializable transaction 內交換。
 */
export async function swapSeatingTableContentsAction(
  workspaceId: string,
  tableId: string,
  _previousState: SeatingTableMutationState,
  formData: FormData,
): Promise<SeatingTableMutationState> {
  void _previousState;
  const authorization = await authorizeSeatingMutation(workspaceId);
  if (typeof authorization !== "string") {
    return authorization;
  }

  const rawTargetTableId = formData.get("targetTableId");
  const targetTableId =
    typeof rawTargetTableId === "string" ? rawTargetTableId.trim() : "";
  let expectedVersion: number;
  let targetExpectedVersion: number;
  try {
    if (targetTableId === "" || targetTableId === tableId) {
      throw new SeatingTableValidationError("請選擇另一張要交換內容的桌次。");
    }
    expectedVersion = normalizeSeatingTableVersion(
      formData.get("expectedVersion"),
    );
    targetExpectedVersion = normalizeSeatingTableVersion(
      formData.get("targetExpectedVersion"),
    );
  } catch (error) {
    return validationState(error);
  }

  try {
    await runSerializableTransaction(async (transaction) => {
      await lockSeatingTableSequence(transaction, workspaceId);
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      await lockSeatingTableRows(transaction, workspaceId);
      const tables = await seatingSnapshotTables(transaction, workspaceId);
      const table = tables.find((candidate) => candidate.id === tableId);
      const target = tables.find(
        (candidate) => candidate.id === targetTableId,
      );
      if (!table || !target) {
        throw new SeatingRecordNotFoundError();
      }
      if (
        table.version !== expectedVersion ||
        target.version !== targetExpectedVersion
      ) {
        throw new SeatingTableStaleError();
      }

      // position、layout、capacity 與 notes 都屬於固定桌位，不參與交換。
      // Serializable 的條件讀取加上帶原桌 id 的 CAS 寫入，會讓同時排座位的
      // 交易安全重試，不會遺漏剛移入任一桌的賓客。
      const guests = (await transaction.guest.findMany({
        where: {
          workspaceId,
          seatingTableId: { in: [tableId, targetTableId] },
        },
        orderBy: [{ id: "asc" }],
        select: {
          id: true,
          version: true,
          partySize: true,
          seatingTableId: true,
        },
      })) as SeatingSnapshotGuest[];
      const tableGuests = guests.filter(
        (guest) => guest.seatingTableId === tableId,
      );
      const targetGuests = guests.filter(
        (guest) => guest.seatingTableId === targetTableId,
      );
      const tablePartySize = tableGuests.reduce(
        (total, guest) => total + guest.partySize,
        0,
      );
      const targetPartySize = targetGuests.reduce(
        (total, guest) => total + guest.partySize,
        0,
      );
      if (
        targetPartySize > table.capacity ||
        tablePartySize > target.capacity
      ) {
        throw new SeatingCapacityError(
          "交換後會超過其中一桌的容量，請先調整座位或桌次容量。",
        );
      }

      const renamed = await transaction.seatingTable.updateMany({
        where: { id: tableId, workspaceId, version: expectedVersion },
        data: { name: target.name, version: { increment: 1 } },
      });
      if (renamed.count !== 1) {
        throw new SeatingTableStaleError();
      }
      const targetRenamed = await transaction.seatingTable.updateMany({
        where: {
          id: targetTableId,
          workspaceId,
          version: targetExpectedVersion,
        },
        data: { name: table.name, version: { increment: 1 } },
      });
      if (targetRenamed.count !== 1) {
        throw new SeatingTableStaleError();
      }

      if (tableGuests.length > 0) {
        const moved = await transaction.guest.updateMany({
          where: {
            workspaceId,
            id: { in: tableGuests.map((guest) => guest.id) },
            seatingTableId: tableId,
          },
          data: {
            seatingTableId: targetTableId,
            version: { increment: 1 },
          },
        });
        if (moved.count !== tableGuests.length) {
          throw new SeatingTableStaleError();
        }
      }
      if (targetGuests.length > 0) {
        const moved = await transaction.guest.updateMany({
          where: {
            workspaceId,
            id: { in: targetGuests.map((guest) => guest.id) },
            seatingTableId: targetTableId,
          },
          data: {
            seatingTableId: tableId,
            version: { increment: 1 },
          },
        });
        if (moved.count !== targetGuests.length) {
          throw new SeatingTableStaleError();
        }
      }
      await advanceSeatingTableSequence(transaction, workspaceId);
    });
  } catch (error) {
    return capacityOrConflictState(
      error,
      "目前無法交換桌名與入座賓客，請稍後再試。",
    );
  }

  revalidateSeatingViews(workspaceId);
  return {
    status: "success",
    message: "已交換兩桌的桌名與入座賓客；桌號保持不變。",
  };
}

export async function deleteSeatingTableAction(
  workspaceId: string,
  tableId: string,
  _previousState: SeatingTableMutationState,
  _formData: FormData,
): Promise<SeatingTableMutationState> {
  void _previousState;

  const authorization = await authorizeSeatingMutation(workspaceId);
  if (typeof authorization !== "string") {
    return authorization;
  }

  const fingerprint = submittedRemovalFingerprint(_formData);
  let result: SeatingTableMutationState;
  try {
    result = await runSeatingSequenceTransaction(async (transaction) => {
      await lockSeatingTableSequence(transaction, workspaceId);
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      await lockSeatingTableRows(transaction, workspaceId);
      return previewOrConfirmSeatingRemoval(
        transaction,
        workspaceId,
        { operation: "delete-table", tableId },
        fingerprint,
      );
    });
  } catch (error) {
    return capacityOrConflictState(
      error,
      "目前無法刪除桌次，請稍後再試。",
    );
  }

  if (result.status === "success") {
    revalidateSeatingViews(workspaceId);
  }
  return result;
}

export async function assignGuestToTableAction(
  workspaceId: string,
  guestId: string,
  _previousState: SeatingTableMutationState,
  formData: FormData,
): Promise<SeatingTableMutationState> {
  const authorization = await authorizeSeatingMutation(workspaceId);
  if (typeof authorization !== "string") {
    return authorization;
  }

  const tableId = assignmentTableId(formData);
  if (!tableId) {
    return { status: "error", message: "請選擇桌次。" };
  }

  let result: "updated" | "unchanged";
  try {
    result = await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      const guest = await transaction.guest.findUnique({
        where: { id_workspaceId: { id: guestId, workspaceId } },
        select: {
          id: true,
          partySize: true,
          attendanceStatus: true,
          seatingTableId: true,
        },
      });
      if (!guest) {
        throw new SeatingRecordNotFoundError();
      }
      if (guest.attendanceStatus === "DECLINED") {
        throw new SeatingGuestDeclinedError();
      }

      const table = await transaction.seatingTable.findUnique({
        where: { id_workspaceId: { id: tableId, workspaceId } },
        select: { id: true, capacity: true },
      });
      if (!table) {
        throw new SeatingRecordNotFoundError();
      }

      if (guest.seatingTableId === tableId) {
        return "unchanged";
      }

      await lockSeatingAssignmentTable(transaction, workspaceId, tableId);
      const assigned = await transaction.guest.aggregate({
        where: { workspaceId, seatingTableId: tableId },
        _sum: { partySize: true },
      });
      const assignedPartySize = assigned._sum.partySize ?? 0;
      if (assignedPartySize + guest.partySize > table.capacity) {
        throw new SeatingCapacityError("此桌剩餘座位不足，請重新安排。");
      }

      await transaction.guest.update({
        where: { id_workspaceId: { id: guestId, workspaceId } },
        data: { seatingTableId: tableId, version: { increment: 1 } },
      });
      return "updated";
    });
  } catch (error) {
    return capacityOrConflictState(
      error,
      "目前無法安排賓客桌次，請稍後再試。",
    );
  }

  if (result === "unchanged") {
    revalidateSeatingViews(workspaceId);
    return { status: "success", message: "桌次安排沒有變更。" };
  }

  revalidateSeatingViews(workspaceId);
  return { status: "success", message: "已安排賓客桌次。" };
}

export async function unassignGuestFromTableAction(
  workspaceId: string,
  guestId: string,
  _previousState: SeatingTableMutationState,
  _formData: FormData,
): Promise<SeatingTableMutationState> {
  void _previousState;
  void _formData;

  const authorization = await authorizeSeatingMutation(workspaceId);
  if (typeof authorization !== "string") {
    return authorization;
  }

  try {
    await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      await transaction.guest.update({
        where: { id_workspaceId: { id: guestId, workspaceId } },
        data: { seatingTableId: null, version: { increment: 1 } },
      });
    });
  } catch (error) {
    return capacityOrConflictState(
      error,
      "目前無法將賓客移出桌次，請稍後再試。",
    );
  }

  revalidateSeatingViews(workspaceId);
  return { status: "success", message: "已將賓客移出桌次。" };
}
