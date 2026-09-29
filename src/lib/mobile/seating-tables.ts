import "server-only";

import { Prisma } from "@prisma/client";

import {
  resolveSeatingFloorPlanPositions,
  SeatingFloorPlanLayoutConflictError,
} from "@/domain/seating-floor-plan";
import {
  MAX_SEATING_TABLE_COUNT,
  normalizeSeatingTableInput,
  SeatingTableValidationError,
} from "@/domain/seating-table";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { MobileRequestError } from "@/lib/mobile/protocol";
import {
  runSerializableTransaction,
  SerializationConflictError,
} from "@/lib/serializable-transaction";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

const STALE_MESSAGE = "這桌剛剛被其他人更新，請重新整理後再試。";

export const TABLE_FIELDS = ["name", "capacity", "notes"];

export function tableBody(body: unknown, allowed: string[]): Record<string, unknown> {
  // workspace、桌次 id 與身分只看路徑和已驗證的使用者；桌位順序由伺服器排。
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "桌次輸入格式有誤。");
  }
  return body as Record<string, unknown>;
}

function failure(error: unknown): never {
  if (error instanceof MobileRequestError) throw error;
  if (error instanceof SeatingTableValidationError) {
    throw new MobileRequestError(400, "VALIDATION", error.message);
  }
  if (error instanceof SeatingFloorPlanLayoutConflictError) {
    throw new MobileRequestError(409, "CONFLICT", "場地配置排不下這一桌，請到網站調整桌位後再試。");
  }
  if (error instanceof WorkspaceAccessDeniedError) {
    throw new MobileRequestError(403, "FORBIDDEN", "沒有這場婚宴的編輯權限。");
  }
  if (error instanceof SerializationConflictError ||
      (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) {
    throw new MobileRequestError(409, "CONFLICT", "剛剛有人同時調整桌次，請重新整理後再試。");
  }
  throw new MobileRequestError(503, "UNAVAILABLE", "目前無法完成操作，請稍後再試。");
}

function versionOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "版本資訊無效，請重新整理後再試。");
  }
  return value;
}

type SnapshotTable = {
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

/** 和網站同一把鎖：同一場婚宴的桌次變更一次只跑一個。 */
async function lockSeating(transaction: Prisma.TransactionClient, workspaceId: string) {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`vowbook:seating:${workspaceId}`}, 0))`;
  const fence = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "wedding_workspaces" WHERE "id" = ${workspaceId} FOR UPDATE
  `);
  if (fence.length !== 1) throw new MobileRequestError(404, "NOT_FOUND", "找不到這場婚宴。");
}

async function advanceSeating(transaction: Prisma.TransactionClient, workspaceId: string) {
  await transaction.$executeRaw(Prisma.sql`
    UPDATE "wedding_workspaces" SET "updated_at" = CURRENT_TIMESTAMP WHERE "id" = ${workspaceId}
  `);
}

async function snapshot(transaction: Prisma.TransactionClient, workspaceId: string) {
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
  })) as SnapshotTable[];
}

/** 新的一桌排在最後面，平面圖位置交給網站自動排。 */
export async function mobileCreateSeatingTable(
  workspaceId: string,
  userId: string,
  fields: Record<string, unknown>,
) {
  try {
    const input = normalizeSeatingTableInput({
      name: fields.name,
      capacity: fields.capacity,
      notes: fields.notes ?? "",
    });
    return await runSerializableTransaction(async (transaction) => {
      await lockSeating(transaction, workspaceId);
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const tables = await snapshot(transaction, workspaceId);
      if (tables.length >= MAX_SEATING_TABLE_COUNT) {
        throw new SeatingTableValidationError(`總桌數不可超過 ${MAX_SEATING_TABLE_COUNT} 桌。`);
      }
      const position = tables.reduce((maximum, table) => Math.max(maximum, table.position), 0) + 1;
      resolveSeatingFloorPlanPositions([
        ...tables,
        { id: `candidate:${position}`, workspaceId, position, version: 0, ...input, layoutX: null, layoutY: null },
      ]);
      const table = await transaction.seatingTable.create({
        data: { workspaceId, position, ...input },
        select: { id: true, version: true },
      });
      await advanceSeating(transaction, workspaceId);
      return { id: table.id, name: input.name, capacity: input.capacity, version: table.version };
    });
  } catch (error) {
    return failure(error);
  }
}

/** 改桌名、座位數、備註；座位數不能少於已經坐進去的人。 */
export async function mobileUpdateSeatingTable(
  workspaceId: string,
  userId: string,
  tableId: string,
  fields: Record<string, unknown>,
) {
  try {
    const input = normalizeSeatingTableInput({
      name: fields.name,
      capacity: fields.capacity,
      notes: fields.notes ?? "",
    });
    const version = versionOf(fields.expectedVersion);
    return await runSerializableTransaction(async (transaction) => {
      await lockSeating(transaction, workspaceId);
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const tables = await snapshot(transaction, workspaceId);
      const table = tables.find((candidate) => candidate.id === tableId);
      if (!table || table.version !== version) throw new MobileRequestError(409, "STALE", STALE_MESSAGE);
      const assigned = await transaction.guest.aggregate({
        where: { workspaceId, seatingTableId: tableId },
        _sum: { partySize: true },
      });
      const seated = assigned._sum.partySize ?? 0;
      if (input.capacity < seated) {
        throw new MobileRequestError(400, "VALIDATION", `這桌已經坐了 ${seated} 位，座位數不能再少。`);
      }
      resolveSeatingFloorPlanPositions(
        tables.map((candidate) => (candidate.id === tableId ? { ...candidate, ...input } : candidate)),
      );
      const updated = await transaction.seatingTable.updateMany({
        where: { id: tableId, workspaceId, version },
        data: { ...input, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new MobileRequestError(409, "STALE", STALE_MESSAGE);
      await advanceSeating(transaction, workspaceId);
      return { id: tableId, name: input.name, capacity: input.capacity, version: version + 1 };
    });
  } catch (error) {
    return failure(error);
  }
}

/**
 * 刪一桌。和網站一樣只讓空桌被刪：桌上還有人就先請他們換桌，
 * 免得一個誤觸就把整桌的安排清掉。
 */
export async function mobileDeleteSeatingTable(
  workspaceId: string,
  userId: string,
  tableId: string,
  fields: Record<string, unknown>,
) {
  try {
    const version = versionOf(fields.expectedVersion);
    return await runSerializableTransaction(async (transaction) => {
      await lockSeating(transaction, workspaceId);
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const tables = await snapshot(transaction, workspaceId);
      const table = tables.find((candidate) => candidate.id === tableId);
      if (!table || table.version !== version) throw new MobileRequestError(409, "STALE", STALE_MESSAGE);
      const seated = await transaction.guest.aggregate({
        where: { workspaceId, seatingTableId: tableId },
        _sum: { partySize: true },
        _count: { _all: true },
      });
      if ((seated._count._all ?? 0) > 0) {
        throw new MobileRequestError(409, "OCCUPIED",
          `這桌還坐著 ${seated._sum.partySize ?? 0} 位，請先把他們換到別桌再刪。`);
      }
      const removed = await transaction.seatingTable.deleteMany({
        where: { id: tableId, workspaceId, version },
      });
      if (removed.count !== 1) throw new MobileRequestError(409, "STALE", STALE_MESSAGE);
      await advanceSeating(transaction, workspaceId);
      return { deleted: true };
    });
  } catch (error) {
    return failure(error);
  }
}
