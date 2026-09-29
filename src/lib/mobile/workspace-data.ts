import "server-only";

import { Prisma } from "@prisma/client";
import type { Sql } from "@prisma/client/runtime/library";

import {
  effectiveGuestSeniority,
  GUEST_ATTENDANCE_STATUSES,
  GuestValidationError,
  normalizeGuestInput,
  type GuestAttendanceStatusValue,
  type GuestCategoryValue,
  type NormalizedGuestInput,
} from "@/domain/guest";
import {
  canGuestCheckIn,
  MAX_GUEST_CHECK_IN_HEADCOUNT,
} from "@/domain/guest-check-in";
import { effectiveGuestDetailValue } from "@/domain/guest-detail-value";
import {
  resolveSeatingFloorPlanPositions,
  seatingFloorPlanCoordinateToBoardPercent,
} from "@/domain/seating-floor-plan";
import {
  normalizeGuestDetailsInput,
  validateGuestRequirementsWithinPartySize,
} from "@/domain/guest-details";
import { normalizeWeddingGiftDetails } from "@/domain/wedding-gift";
import { isGiftCollectionExcluded } from "@/domain/wedding-gift-policy";
import {
  normalizeWeddingTaskDetails,
  normalizeWeddingTaskSide,
  normalizeWeddingTaskStatus,
  WeddingTaskValidationError,
  type NormalizedWeddingTaskDetails,
  type WeddingTaskSideValue,
} from "@/domain/wedding-task";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import {
  BUDGET_TAXONOMY_ITEM_KEYS,
  BUDGET_TAXONOMY_ITEM_LABELS,
  BUDGET_TAXONOMY_NODE_BY_KEY,
  isBudgetTaxonomyItemKey,
  type BudgetTaxonomyItemKey,
  type BudgetTaxonomyNodeKey,
} from "@/domain/budget-item";
import {
  GUEST_DETAILS_FIELDS,
  upsertManualGuestDetails,
} from "@/lib/guest-manual-details";
import { loadGuestsForUser } from "@/lib/guest-list";
import { loadSeatingPlanForUser } from "@/lib/seating-plan";
import { loadWeddingTaskList } from "@/lib/wedding-task-list";
import { loadBudgetPageData } from "@/lib/budget-list";
import { loadWeddingStaffList } from "@/lib/wedding-staff-list";
import { loadWeddingTimelinePageData } from "@/lib/wedding-timeline-list";
import {
  WEDDING_SPEECH_LABELS,
  WEDDING_SPEECH_TEMPLATES,
  WEDDING_SPEECHES,
} from "@/domain/wedding-speech";
import { loadWorkspaceMembersForUser } from "@/lib/workspace-invitations";
import { MobileRequestError } from "@/lib/mobile/protocol";
import {
  runSerializableTransaction,
  SerializationConflictError,
} from "@/lib/serializable-transaction";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

const EDITOR_ROLES = new Set(["OWNER", "PARTNER", "PLANNER"]);

function mobileFailure(error: unknown): never {
  if (error instanceof MobileRequestError) throw error;
  if (error instanceof WorkspaceAccessDeniedError) {
    throw new MobileRequestError(403, "FORBIDDEN", "沒有這場婚宴的編輯權限。");
  }
  if (error instanceof SerializationConflictError) {
    throw new MobileRequestError(409, "CONFLICT", "剛剛有人同時操作，請重新整理後再試。");
  }
  throw new MobileRequestError(503, "UNAVAILABLE", "目前無法完成操作，請稍後再試。");
}

function expectedVersionOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "版本資訊無效，請重新整理後再試。");
  }
  return value;
}

/** 手機名單帶當場要判斷的欄位、備註，以及聯絡與飲食細項。 */
export async function mobileGuestList(workspaceId: string, userId: string) {
  const data = await loadGuestsForUser(workspaceId, userId);
  return {
    role: data.role,
    canEdit: EDITOR_ROLES.has(data.role),
    guests: data.guests.map((guest) => ({
      id: guest.id,
      version: guest.version,
      name: guest.name,
      category: guest.category,
      side: guest.side,
      attendanceStatus: guest.attendanceStatus,
      partySize: guest.partySize,
      notes: guest.notes,
      tableNumber: guest.seatingTable?.number ?? null,
      tableName: guest.seatingTable?.name ?? null,
      checkedIn: guest.checkIn !== null,
      details: guest.details,
    })),
  };
}

export async function mobileSetGuestAttendance(
  workspaceId: string,
  userId: string,
  guestId: string,
  status: unknown,
  expectedVersionInput: unknown,
) {
  if (typeof status !== "string" || !(GUEST_ATTENDANCE_STATUSES as readonly string[]).includes(status)) {
    throw new MobileRequestError(400, "VALIDATION", "出席狀態無效。");
  }
  const expectedVersion = expectedVersionOf(expectedVersionInput);

  try {
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as {
        guest: {
          findFirst(args: unknown): Promise<{ id: string; seatingTableId: string | null } | null>;
          updateMany(args: unknown): Promise<{ count: number }>;
        };
      };
      // guestId 來自 client，必須先確認屬於這個 workspace。
      const guest = await client.guest.findFirst({
        where: { id: guestId, workspaceId },
        select: { id: true, seatingTableId: true },
      });
      if (!guest) {
        throw new MobileRequestError(409, "STALE", "名單已更新，請重新整理後再試。");
      }
      // 不出席的人不能佔著座位，資料庫有同樣的約束；這裡和網站一樣先移出桌次。
      const removesFromTable = status === "DECLINED" && guest.seatingTableId !== null;
      const result = await client.guest.updateMany({
        where: { id: guestId, workspaceId, version: expectedVersion },
        data: {
          attendanceStatus: status,
          ...(removesFromTable ? { seatingTableId: null } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new MobileRequestError(409, "STALE", "這位賓客剛剛被其他人更新，請重新整理後再試。");
      }
      return { id: guestId, attendanceStatus: status, version: expectedVersion + 1, removedFromTable: removesFromTable };
    });
  } catch (error) {
    return mobileFailure(error);
  }
}

export async function mobileTaskList(workspaceId: string, userId: string) {
  const data = await loadWeddingTaskList(workspaceId, userId);
  return {
    role: data.role,
    canEdit: EDITOR_ROLES.has(data.role),
    workspaceToday: data.workspaceToday,
    tasks: data.tasks,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

type GuestEditClient = {
  guest: {
    findFirst(args: unknown): Promise<{
      id: string;
      version: number;
      category: GuestCategoryValue;
      partySize: number;
      seatingTableId: string | null;
      checkIn: { id: string } | null;
    } | null>;
    aggregate(args: unknown): Promise<{ _sum: { partySize: number | null } }>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  guestImportRecord: {
    findMany(args: unknown): Promise<Array<{
      source: string;
      sourceInstance: string;
      sourceManaged: boolean;
      childSeatCount: number | null;
      vegetarianCount: number | null;
    }>>;
  };
  seatingTable: { findFirst(args: unknown): Promise<{ id: string; capacity: number } | null> };
};

/**
 * 細項是選填的：有帶任何一個欄位才會動到「自行填寫」那筆紀錄，
 * 沒帶就完全不碰，免得 App 舊版本送出的請求把網站填好的資料洗掉。
 */
function guestDetailsFromFields(fields: Record<string, unknown>, partySize: number) {
  if (!GUEST_DETAILS_FIELDS.some((field) => field in fields)) return null;
  const details = normalizeGuestDetailsInput(
    Object.fromEntries(GUEST_DETAILS_FIELDS.map((field) => [field, fields[field] ?? null])),
  );
  validateGuestRequirementsWithinPartySize(details, partySize);
  // 全部清空也要寫回去，使用者本來就可能是想把填錯的資料刪掉。
  return details;
}

/**
 * 手機改賓客的核心欄位與細項。名單身份與輩份不在手機上改，沿用資料庫現值，
 * 其餘檢查照網站：報到紀錄、兒童座椅／素食人數、桌次容量、不出席移出桌次。
 */
export async function mobileUpdateGuest(
  workspaceId: string,
  userId: string,
  guestId: string,
  fields: Record<string, unknown>,
) {
  const expectedVersion = expectedVersionOf(fields.expectedVersion);
  try {
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as GuestEditClient;
      const guest = await client.guest.findFirst({
        where: { id: guestId, workspaceId },
        select: {
          id: true, version: true, category: true, partySize: true, seatingTableId: true,
          checkIn: { select: { id: true } },
        },
      });
      if (!guest || guest.version !== expectedVersion) {
        throw new MobileRequestError(409, "STALE", "這位賓客剛剛被其他人更新，請重新整理後再試。");
      }
      const input = normalizeGuestInput({
        name: fields.name,
        category: guest.category,
        side: fields.side,
        attendanceStatus: fields.attendanceStatus,
        partySize: fields.partySize,
        notes: fields.notes,
      });
      const details = guestDetailsFromFields(fields, input.partySize);
      if (guest.checkIn && !canGuestCheckIn(input)) {
        throw new MobileRequestError(400, "VALIDATION", "這位已經報到了，要改成未回覆或不出席，請先取消報到。");
      }
      if (input.partySize < guest.partySize) {
        const records = await client.guestImportRecord.findMany({
          where: { guestId, workspaceId },
          orderBy: [{ source: "asc" }, { sourceInstance: "asc" }],
          select: { source: true, sourceInstance: true, sourceManaged: true, childSeatCount: true, vegetarianCount: true },
        });
        validateGuestRequirementsWithinPartySize({
          childSeatCount: effectiveGuestDetailValue(records, (record) => record.childSeatCount),
          vegetarianCount: effectiveGuestDetailValue(records, (record) => record.vegetarianCount),
        }, input.partySize);
      }

      const removesFromTable = input.attendanceStatus === "DECLINED" && guest.seatingTableId !== null;
      if (guest.seatingTableId && !removesFromTable && input.partySize > guest.partySize) {
        const table = await client.seatingTable.findFirst({
          where: { id: guest.seatingTableId, workspaceId },
          select: { id: true, capacity: true },
        });
        const others = await client.guest.aggregate({
          where: { workspaceId, seatingTableId: guest.seatingTableId, NOT: { id: guestId } },
          _sum: { partySize: true },
        });
        if (!table || (others._sum.partySize ?? 0) + input.partySize > table.capacity) {
          throw new MobileRequestError(409, "CAPACITY", "人數加上去會超過這桌的位子，請先換桌再改人數。");
        }
      }

      const result = await client.guest.updateMany({
        where: { id: guestId, workspaceId, version: expectedVersion },
        data: {
          ...input,
          ...(removesFromTable ? { seatingTableId: null } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new MobileRequestError(409, "STALE", "這位賓客剛剛被其他人更新，請重新整理後再試。");
      }
      if (details) {
        await upsertManualGuestDetails(
          transaction as unknown as Prisma.TransactionClient,
          workspaceId,
          guestId,
          details,
        );
      }
      return { id: guestId, name: input.name, version: expectedVersion + 1, removedFromTable: removesFromTable };
    });
  } catch (error) {
    if (error instanceof GuestValidationError) {
      throw new MobileRequestError(400, "VALIDATION", error.message);
    }
    return mobileFailure(error);
  }
}

/** 臨時多一位賓客時在手機上先加進名單；聯絡資訊與飲食細節之後再到網站補。 */
export async function mobileCreateGuest(
  workspaceId: string,
  userId: string,
  fields: Record<string, unknown>,
) {
  let input: NormalizedGuestInput;
  try {
    input = normalizeGuestInput({
      name: fields.name,
      category: fields.category,
      seniority: fields.seniority,
      side: fields.side,
      attendanceStatus: fields.attendanceStatus,
      partySize: fields.partySize,
      notes: fields.notes,
    });
  } catch (error) {
    if (error instanceof GuestValidationError) {
      throw new MobileRequestError(400, "VALIDATION", error.message);
    }
    throw error;
  }

  try {
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as {
        guest: { create(args: unknown): Promise<{ id: string; version: number }> };
      };
      const guest = await client.guest.create({
        data: { workspaceId, ...input, seniority: effectiveGuestSeniority(input.seniority) },
        select: { id: true, version: true },
      });
      return { id: guest.id, name: input.name, version: guest.version };
    });
  } catch (error) {
    if (input.category === "COUPLE" && isUniqueConstraintError(error)) {
      const role = input.side === "PARTNER_A" ? "新郎" : "新娘";
      throw new MobileRequestError(409, "CONFLICT", `這場婚宴已經有${role}了，請直接改原本那筆。`);
    }
    return mobileFailure(error);
  }
}

type TaskFields = NormalizedWeddingTaskDetails & { side: WeddingTaskSideValue };

function taskFieldsOf(fields: Record<string, unknown>): TaskFields {
  try {
    return {
      ...normalizeWeddingTaskDetails({
        title: fields.title,
        description: fields.description,
        dueDate: fields.dueDate,
      }),
      side: normalizeWeddingTaskSide(fields.side),
    };
  } catch (error) {
    if (error instanceof WeddingTaskValidationError) {
      throw new MobileRequestError(400, "VALIDATION", error.message);
    }
    throw error;
  }
}

type TaskMutationClient = {
  weddingTask: {
    create(args: unknown): Promise<{ id: string; version: number }>;
    updateMany(args: unknown): Promise<{ count: number }>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
};

export async function mobileCreateTask(
  workspaceId: string,
  userId: string,
  fields: Record<string, unknown>,
) {
  const details = taskFieldsOf(fields);
  try {
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as TaskMutationClient;
      const task = await client.weddingTask.create({
        data: { workspaceId, ...details, status: "TODO", completedAt: null },
        select: { id: true, version: true },
      });
      return { id: task.id, title: details.title, version: task.version };
    });
  } catch (error) {
    return mobileFailure(error);
  }
}

export async function mobileUpdateTask(
  workspaceId: string,
  userId: string,
  taskId: string,
  fields: Record<string, unknown>,
) {
  const details = taskFieldsOf(fields);
  const expectedVersion = expectedVersionOf(fields.expectedVersion);
  try {
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as TaskMutationClient;
      const result = await client.weddingTask.updateMany({
        where: { id: taskId, workspaceId, version: expectedVersion },
        data: { ...details, version: { increment: 1 } },
      });
      if (result.count !== 1) {
        throw new MobileRequestError(409, "STALE", "這項任務剛剛被其他人更新，請重新整理後再試。");
      }
      return { id: taskId, title: details.title, version: expectedVersion + 1 };
    });
  } catch (error) {
    return mobileFailure(error);
  }
}

export async function mobileDeleteTask(
  workspaceId: string,
  userId: string,
  taskId: string,
  expectedVersionInput: unknown,
) {
  const expectedVersion = expectedVersionOf(expectedVersionInput);
  try {
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as TaskMutationClient;
      const result = await client.weddingTask.deleteMany({
        where: { id: taskId, workspaceId, version: expectedVersion },
      });
      if (result.count !== 1) {
        throw new MobileRequestError(409, "STALE", "這項任務剛剛被其他人更新，請重新整理後再試。");
      }
      return { id: taskId, removed: true };
    });
  } catch (error) {
    return mobileFailure(error);
  }
}

export async function mobileSetTaskStatus(
  workspaceId: string,
  userId: string,
  taskId: string,
  statusInput: unknown,
  expectedVersionInput: unknown,
) {
  let status: string;
  try {
    status = normalizeWeddingTaskStatus(statusInput);
  } catch {
    throw new MobileRequestError(400, "VALIDATION", "任務狀態無效。");
  }
  const expectedVersion = expectedVersionOf(expectedVersionInput);

  try {
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as {
        weddingTask: { updateMany(args: unknown): Promise<{ count: number }> };
      };
      const result = await client.weddingTask.updateMany({
        where: { id: taskId, workspaceId, version: expectedVersion },
        data: {
          status,
          completedAt: status === "DONE" ? new Date() : null,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new MobileRequestError(409, "STALE", "這項任務剛剛被其他人更新，請重新整理後再試。");
      }
      return { id: taskId, status, version: expectedVersion + 1 };
    });
  } catch (error) {
    return mobileFailure(error);
  }
}

type MobileSeatingChartPoint = { x: number; y: number };

type MobileSeatingChartInput = {
  id: string;
  position: number;
  name: string | null;
  layoutX: number | null;
  layoutY: number | null;
};

/**
 * App 的桌圖用百分比定位，換算留在伺服器：擺位規則和網站同一份 domain，
 * 手機端只要照著百分比畫圓點就好。座標排不出來時回空的，桌次清單照樣能看。
 */
function resolveMobileSeatingChart(
  tables: readonly MobileSeatingChartInput[],
): Map<string, MobileSeatingChartPoint> {
  const chart = new Map<string, MobileSeatingChartPoint>();
  if (tables.length === 0) return chart;
  try {
    const positions = resolveSeatingFloorPlanPositions(
      tables.map((table) => ({
        id: table.id,
        position: table.position,
        name: table.name ?? "",
        layoutX: table.layoutX,
        layoutY: table.layoutY,
      })),
    );
    for (const position of positions) {
      const percent = seatingFloorPlanCoordinateToBoardPercent(position);
      chart.set(position.tableId, { x: percent.x, y: percent.y });
    }
  } catch {
    return new Map();
  }
  return chart;
}

/** 桌次：找人坐哪桌、看還有幾個位子，臨時有人加入也能當場安排。 */
export async function mobileSeatingPlan(workspaceId: string, userId: string) {
  const plan = await loadSeatingPlanForUser(workspaceId, userId);
  const chart = resolveMobileSeatingChart(plan.tables);
  return {
    role: plan.role,
    canEdit: EDITOR_ROLES.has(plan.role),
    tables: plan.tables.map((table) => {
      const seated = table.guests.reduce((total, guest) => total + guest.partySize, 0);
      return {
        id: table.id,
        chart: chart.get(table.id) ?? null,
        version: table.version,
        number: table.number,
        name: table.name,
        capacity: table.capacity,
        notes: table.notes,
        seatedHeadcount: seated,
        remainingSeats: Math.max(0, table.capacity - seated),
        guests: table.guests.map((guest) => ({
          id: guest.id,
          version: guest.version,
          name: guest.name,
          partySize: guest.partySize,
          side: guest.side,
          tableId: table.id,
        })),
      };
    }),
    unassignedGuests: plan.unassignedGuests.map((guest) => ({
      id: guest.id,
      version: guest.version,
      name: guest.name,
      partySize: guest.partySize,
      side: guest.side,
      tableId: null,
    })),
  };
}

type SeatingMutationClient = {
  $queryRaw<Row>(query: Sql): Promise<Row[]>;
  guest: {
    findFirst(args: unknown): Promise<{
      id: string;
      partySize: number;
      attendanceStatus: GuestAttendanceStatusValue;
      seatingTableId: string | null;
      version: number;
    } | null>;
    aggregate(args: unknown): Promise<{ _sum: { partySize: number | null } }>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  seatingTable: {
    findFirst(args: unknown): Promise<{ id: string; capacity: number } | null>;
  };
};

/**
 * 把賓客安排到某一桌，或從原本的桌次移出（tableId 傳 null）。
 * 容量、不出席不得入座這兩條規則和網站同一份，差別只在這裡用版本號擋覆蓋。
 */
export async function mobileAssignGuestToTable(
  workspaceId: string,
  userId: string,
  guestId: string,
  input: { tableId: unknown; expectedVersion: unknown; expectedTableId: unknown },
) {
  if (input.tableId !== null && (typeof input.tableId !== "string" || !input.tableId)) {
    throw new MobileRequestError(400, "VALIDATION", "請選擇桌次。");
  }
  if (input.expectedTableId !== null && (typeof input.expectedTableId !== "string" || !input.expectedTableId)) {
    throw new MobileRequestError(400, "VALIDATION", "原本的桌次資訊無效，請重新整理後再試。");
  }
  const tableId = input.tableId as string | null;
  const expectedTableId = input.expectedTableId as string | null;
  const expectedVersion = expectedVersionOf(input.expectedVersion);

  try {
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as SeatingMutationClient;
      // guestId 來自 client，必須先確認屬於這個 workspace。
      const guest = await client.guest.findFirst({
        where: { id: guestId, workspaceId },
        select: { id: true, partySize: true, attendanceStatus: true, seatingTableId: true, version: true },
      });
      if (!guest) {
        throw new MobileRequestError(409, "STALE", "名單已更新，請重新整理後再試。");
      }
      if (guest.version !== expectedVersion || guest.seatingTableId !== expectedTableId) {
        throw new MobileRequestError(409, "STALE", "這位賓客剛剛被其他人安排過，請重新整理後再試。");
      }
      if (guest.attendanceStatus === "DECLINED" && tableId !== null) {
        throw new MobileRequestError(400, "VALIDATION", "不出席的賓客不需要安排座位。");
      }
      if (guest.seatingTableId === tableId) {
        return { id: guestId, tableId, version: guest.version, changed: false };
      }

      if (tableId !== null) {
        const table = await client.seatingTable.findFirst({
          where: { id: tableId, workspaceId },
          select: { id: true, capacity: true },
        });
        if (!table) {
          throw new MobileRequestError(409, "STALE", "桌次已更新，請重新整理後再試。");
        }
        // 先鎖住這桌，才不會兩支手機同時把最後一個位子塞滿。
        const locked = await client.$queryRaw<{ id: string }>(Prisma.sql`
          SELECT "id"
          FROM "seating_tables"
          WHERE "workspace_id" = ${workspaceId}
            AND "id" = ${tableId}
          FOR KEY SHARE
        `);
        if (locked.length !== 1) {
          throw new MobileRequestError(409, "STALE", "桌次已更新，請重新整理後再試。");
        }
        const seated = await client.guest.aggregate({
          where: { workspaceId, seatingTableId: tableId },
          _sum: { partySize: true },
        });
        if ((seated._sum.partySize ?? 0) + guest.partySize > table.capacity) {
          throw new MobileRequestError(409, "CONFLICT", "這桌剩下的位子不夠，請換一桌。");
        }
      }

      const moved = await client.guest.updateMany({
        where: { id: guestId, workspaceId, version: expectedVersion, seatingTableId: expectedTableId },
        data: { seatingTableId: tableId, version: { increment: 1 } },
      });
      if (moved.count !== 1) {
        throw new MobileRequestError(409, "STALE", "這位賓客剛剛被其他人安排過，請重新整理後再試。");
      }
      return { id: guestId, tableId, version: expectedVersion + 1, changed: true };
    });
  } catch (error) {
    return mobileFailure(error);
  }
}

/**
 * 禮金簿：收禮桌上就是照名字找人、填金額。不收禮金的親友（新人、雙方父母手足、
 * 已設定不收）不列出來，和網站一致；但已經登記過的仍要留著，才能查看或更正。
 */
export async function mobileGiftBook(workspaceId: string, userId: string) {
  const data = await loadGuestsForUser(workspaceId, userId);
  const entries = data.guests.map((guest) => {
    // 名單已經算好有效的稱謂，這裡不必再從匯入明細推一次。
    const excluded = isGiftCollectionExcluded({
      category: guest.category,
      giftExemptWithCake: guest.giftExemptWithCake,
      relationshipLabel: guest.details?.relationshipLabel ?? null,
    });
    return {
      id: guest.id,
      version: guest.version,
      name: guest.name,
      side: guest.side,
      attendanceStatus: guest.attendanceStatus,
      tableNumber: guest.seatingTable?.number ?? null,
      excluded,
      gift: guest.weddingGift
        ? {
            id: guest.weddingGift.id,
            amount: guest.weddingGift.amount,
            notes: guest.weddingGift.notes,
            version: guest.weddingGift.version,
          }
        : null,
    };
  });
  // 不收禮金又沒登記過的不必出現在收禮桌上，免得現場一直滑過用不到的名字。
  const visible = entries.filter((entry) => !entry.excluded || entry.gift !== null);
  const recorded = entries.filter((entry) => entry.gift !== null);
  return {
    role: data.role,
    canEdit: EDITOR_ROLES.has(data.role),
    summary: {
      recordedCount: recorded.length,
      totalAmount: recorded.reduce((total, entry) => total + (entry.gift?.amount ?? 0), 0),
      pendingCount: entries.filter((entry) => !entry.excluded && entry.gift === null).length,
    },
    entries: visible,
  };
}

type GiftMutationClient = {
  guest: {
    findFirst(args: unknown): Promise<{
      id: string;
      category: GuestCategoryValue;
      attendanceStatus: GuestAttendanceStatusValue;
      partySize: number;
      checkIn: { id: string } | null;
      giftExemptWithCake: boolean;
      importRecords: Array<{ source: string; sourceInstance: string; sourceManaged: boolean; relationshipLabel: string | null }>;
    } | null>;
  };
  guestCheckIn: {
    create(args: unknown): Promise<{ id: string }>;
  };
  weddingGift: {
    create(args: unknown): Promise<{ id: string; amount: number; version: number }>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

export async function mobileRecordGift(
  workspaceId: string,
  userId: string,
  guestId: string,
  input: { amount: unknown; notes: unknown },
) {
  let details;
  try {
    details = normalizeWeddingGiftDetails(input);
  } catch (error) {
    throw new MobileRequestError(400, "VALIDATION", (error as Error).message);
  }

  try {
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as GiftMutationClient;
      const guest = await client.guest.findFirst({
        where: { id: guestId, workspaceId },
        select: {
          id: true,
          category: true,
          attendanceStatus: true,
          partySize: true,
          checkIn: { select: { id: true } },
          giftExemptWithCake: true,
          importRecords: {
            orderBy: [{ source: "asc" }, { sourceInstance: "asc" }],
            select: { source: true, sourceInstance: true, sourceManaged: true, relationshipLabel: true },
          },
        },
      });
      if (!guest) {
        throw new MobileRequestError(409, "STALE", "名單已更新，請重新整理後再試。");
      }
      const relationshipLabel = effectiveGuestDetailValue(
        guest.importRecords,
        (record) => record.relationshipLabel,
      );
      if (isGiftCollectionExcluded({ ...guest, relationshipLabel })) {
        throw new MobileRequestError(400, "VALIDATION", "此親友不收禮金，無法登記。");
      }
      const created = await client.weddingGift.create({
        data: { workspaceId, guestId, ...details },
        select: { id: true, amount: true, version: true },
      });
      // 網站與手機端一致：收到禮金就當作人已經到了。
      if (guest.checkIn === null && canGuestCheckIn(guest)) {
        await client.guestCheckIn.create({
          data: {
            workspaceId,
            guestId,
            headcount: Math.min(guest.partySize, MAX_GUEST_CHECK_IN_HEADCOUNT),
          },
          select: { id: true },
        });
      }
      return created;
    });
  } catch (error) {
    return mobileFailure(error);
  }
}

export async function mobileUpdateGift(
  workspaceId: string,
  userId: string,
  giftId: string,
  input: { amount: unknown; notes: unknown },
  expectedVersionInput: unknown,
) {
  let details;
  try {
    details = normalizeWeddingGiftDetails(input);
  } catch (error) {
    throw new MobileRequestError(400, "VALIDATION", (error as Error).message);
  }
  const expectedVersion = expectedVersionOf(expectedVersionInput);

  try {
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as GiftMutationClient;
      const result = await client.weddingGift.updateMany({
        where: { id: giftId, workspaceId, version: expectedVersion },
        data: { ...details, version: { increment: 1 } },
      });
      if (result.count !== 1) {
        throw new MobileRequestError(409, "STALE", "這筆禮金剛剛被其他人更新，請重新整理後再試。");
      }
      return { id: giftId, amount: details.amount, version: expectedVersion + 1 };
    });
  } catch (error) {
    return mobileFailure(error);
  }
}

/**
 * 花費：總額、依名單換算的項目、當天要付的尾款，以及每一筆花費的明細。
 * 搬分類、群組整理與附件仍在網站處理。
 */
export async function mobileBudget(workspaceId: string, userId: string) {
  const data = await loadBudgetPageData(workspaceId, userId);
  const balanceDue = data.items
    // 已有自備或決定不準備的項目不用付錢，和網站的尾款統計同一個口徑。
    .filter((item) =>
      item.kind === "EXPENSE" &&
      item.preparationStatus === "NEEDS_ACTION" &&
      item.bookingStatus === "BOOKED_BALANCE_DUE")
    .map((item) => ({
      id: item.id,
      version: item.version,
      name: item.name,
      parentName: item.directParentName,
      vendor: item.confirmedVendor,
      balanceAmount: item.balanceAmount,
      // 加購通常跟尾款一起結，App 要能顯示同一個金額口徑。
      additionalAmount: item.additionalAmount,
      balancePaymentMethod: item.balancePaymentMethod,
      dueDate: item.dueDate,
      // 逾期用婚宴所在時區的「今天」判斷，和網站同一個口徑。
      overdue: item.dueDate !== null && item.dueDate < data.workspaceToday,
    }))
    .sort((left, right) => {
      if (left.dueDate === right.dueDate) return left.name.localeCompare(right.name, "zh-Hant");
      if (left.dueDate === null) return 1;
      if (right.dueDate === null) return -1;
      return left.dueDate < right.dueDate ? -1 : 1;
    });
  return {
    canEdit: data.canEdit,
    workspaceToday: data.workspaceToday,
    // 這兩組設定會決定花費頁列出哪些分類、以及衍生費用怎麼算。
    ceremony: {
      hasEngagementCeremony: data.hasEngagementCeremony,
      hasProcessionCeremony: data.hasProcessionCeremony,
      version: data.ceremonyPreferencesVersion,
    },
    mealPricing: {
      staffMealUnitPrice: data.mealPricing.staffMealUnitPrice,
      vegetarianMealUnitPrice: data.mealPricing.vegetarianMealUnitPrice,
      serviceChargePercent: data.mealPricing.serviceChargePercent,
    },
    summary: {
      plannedTotal: Number(data.summary.plannedTotal),
      actualTotal: Number(data.summary.actualTotal),
      balanceDueTotal: Number(data.summary.balanceDueTotal),
      balanceDueCount: data.summary.balanceDueCount,
      overdueBalanceDueCount: data.summary.overdueBalanceDueCount,
      balanceDueMissingAmountCount: data.summary.balanceDueMissingAmountCount,
      paidCount: data.summary.paidCount,
      itemCount: data.summary.itemCount,
    },
    derivedCosts: data.derivedCosts.map((cost) => ({
      key: cost.key,
      name: cost.name,
      detail: cost.detail,
      amount: cost.amount,
    })),
    balanceDue,
    items: mobileBudgetItems(data.items),
    // 新增時能選的分類：只列這場婚宴真的有的（沒辦文定就不會有文定分類）。
    categories: BUDGET_TAXONOMY_ITEM_KEYS
      .filter((key) => data.items.some((item) => item.kind === "GROUP" && item.systemTaxonomyKey === key))
      .map((key) => ({
        key,
        label: BUDGET_TAXONOMY_ITEM_LABELS[key],
        stageLabel: BUDGET_TAXONOMY_NODE_BY_KEY[BUDGET_TAXONOMY_NODE_BY_KEY[key].parentKey as BudgetTaxonomyNodeKey].label,
      })),
  };
}

type BudgetListItem = Awaited<ReturnType<typeof loadBudgetPageData>>["items"][number];

/** 每一筆花費往上找到所屬的系統分類，手機用分類分組顯示。 */
function mobileBudgetItems(items: BudgetListItem[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const categoryOf = (item: BudgetListItem): BudgetTaxonomyItemKey | null => {
    let cursor: BudgetListItem | undefined = item;
    for (let depth = 0; cursor && depth < 32; depth += 1) {
      if (isBudgetTaxonomyItemKey(cursor.systemTaxonomyKey)) return cursor.systemTaxonomyKey;
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return null;
  };
  return items
    .filter((item) => item.kind === "EXPENSE")
    .map((item) => {
      const key = categoryOf(item);
      return {
        id: item.id,
        version: item.version,
        name: item.name,
        categoryKey: key,
        categoryLabel: key ? BUDGET_TAXONOMY_ITEM_LABELS[key] : "未分類",
        parentName: item.directParentName,
        hasChildren: item.hasChildren,
        bookingStatus: item.bookingStatus,
        preparationStatus: item.preparationStatus ?? "NEEDS_ACTION",
        plannedAmount: item.plannedAmount,
        depositAmount: item.depositAmount,
        balanceAmount: item.balanceAmount,
        additionalAmount: item.additionalAmount,
        actualAmount: item.actualAmount,
        dueDate: item.dueDate,
        notes: item.notes,
        confirmedVendor: item.confirmedVendor,
        vendorContact: item.vendorContact,
        balancePaymentMethod: item.balancePaymentMethod === "RED_ENVELOPE" ? "CASH" : item.balancePaymentMethod,
        // 收據本身的上傳與瀏覽留在網站；App 先讓人知道哪幾筆有存收據。
        attachments: (item.attachments ?? []).map((attachment) => ({
          id: attachment.id,
          originalName: attachment.originalName,
        })),
      };
    });
}

/**
 * 當天付掉尾款就直接在手機上結案。條件和網站的付款狀態同一份：
 * 只有還在追的支出項目可以改，金額由原本的預算帶入，付款時間一律由伺服器決定。
 */
export async function mobileMarkBudgetItemPaid(
  workspaceId: string,
  userId: string,
  itemId: string,
  expectedVersionInput: unknown,
) {
  const expectedVersion = expectedVersionOf(expectedVersionInput);

  try {
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as {
        $executeRaw(query: Sql): Promise<number>;
      };
      const paidAt = new Date();
      const count = await client.$executeRaw(Prisma.sql`
        UPDATE "budget_items"
        SET
          "booking_status" = 'PAID'::"BudgetBookingStatus",
          "paid" = TRUE,
          "actual_amount" = "planned_amount",
          "paid_at" = CASE WHEN "booking_status" = 'PAID' THEN "paid_at" ELSE ${paidAt} END,
          "version" = "version" + 1,
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${itemId}
          AND "workspace_id" = ${workspaceId}
          AND "version" = ${expectedVersion}
          AND "kind" = 'EXPENSE'
          AND "preparation_status" = 'NEEDS_ACTION'::"BudgetPreparationStatus"
      `);
      if (count !== 1) {
        throw new MobileRequestError(409, "STALE", "這筆花費剛剛被其他人更新，請重新整理後再試。");
      }
      return { id: itemId, bookingStatus: "PAID", version: expectedVersion + 1 };
    });
  } catch (error) {
    return mobileFailure(error);
  }
}

/**
 * 工作人員名單。這裡刻意帶聯絡電話：婚宴當天找主持、攝影、接待就是要能一按就撥，
 * 和賓客名單不送聯絡資訊的考量不同——這些是新人自己要聯繫的協力者。
 */
export async function mobileStaffList(workspaceId: string, userId: string) {
  const data = await loadWeddingStaffList(workspaceId, userId);
  return {
    canEdit: EDITOR_ROLES.has(data.role),
    staff: data.staff.map((person) => ({
      id: person.id,
      version: person.version,
      roleName: person.roleName,
      personName: person.personName,
      contactPhone: person.contactPhone,
      mealCount: person.mealCount,
      vegetarianMealCount: person.vegetarianMealCount,
      redEnvelopeAmount: person.redEnvelopeAmount,
      redEnvelopeSent: person.redEnvelopeSentAt !== null,
    })),
  };
}

export async function mobileSetRedEnvelopeSent(
  workspaceId: string,
  userId: string,
  staffId: string,
  sent: unknown,
  expectedVersionInput: unknown,
) {
  if (typeof sent !== "boolean") {
    throw new MobileRequestError(400, "VALIDATION", "紅包發放狀態無效。");
  }
  const expectedVersion = expectedVersionOf(expectedVersionInput);

  try {
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as {
        weddingStaffAssignment: {
          findFirst(args: unknown): Promise<{
            redEnvelopeAmount: number | null;
            redEnvelopeSentAt: Date | null;
            version: number;
          } | null>;
          updateMany(args: unknown): Promise<{ count: number }>;
        };
      };
      const current = await client.weddingStaffAssignment.findFirst({
        where: { id: staffId, workspaceId },
        select: { redEnvelopeAmount: true, redEnvelopeSentAt: true, version: true },
      });
      if (!current || current.version !== expectedVersion) {
        throw new MobileRequestError(409, "STALE", "這位工作人員剛剛被其他人更新，請重新整理後再試。");
      }
      // 沒有金額就沒有東西可發，資料庫也有同樣的約束。
      if (sent && current.redEnvelopeAmount === null) {
        throw new MobileRequestError(400, "VALIDATION", "請先在網站填寫紅包金額，再標記為已發放。");
      }
      const result = await client.weddingStaffAssignment.updateMany({
        where: { id: staffId, workspaceId, version: expectedVersion },
        data: {
          // 已發過就保留原本的時間，時間一律由伺服器決定。
          redEnvelopeSentAt: sent ? (current.redEnvelopeSentAt ?? new Date()) : null,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new MobileRequestError(409, "STALE", "這位工作人員剛剛被其他人更新，請重新整理後再試。");
      }
      return { id: staffId, redEnvelopeSent: sent, version: expectedVersion + 1 };
    });
  } catch (error) {
    return mobileFailure(error);
  }
}

/** 當天流程與兩個遊戲名單；手機只讀流程，名單可以直接在現場補。 */
export async function mobileTimeline(workspaceId: string, userId: string) {
  const data = await loadWeddingTimelinePageData(workspaceId, userId);
  return {
    canEdit: EDITOR_ROLES.has(data.role),
    items: data.items.map((item) => ({
      id: item.id,
      startTime: item.startTime,
      endTime: item.endTime,
      phase: item.phase,
      title: item.title,
      location: item.location,
      details: item.details,
      mediaCue: item.mediaCue,
      notes: item.notes,
      version: item.version,
      staff: item.assignedStaff.map((person) => `${person.roleName} ${person.personName}`),
    })),
    games: data.games,
    // 稿子沒寫時附上草稿，手機可以一鍵帶入再改。
    speeches: WEDDING_SPEECHES.map((kind) => ({
      kind,
      label: WEDDING_SPEECH_LABELS[kind],
      content: data.speeches[kind]?.content ?? null,
      version: data.speeches[kind]?.version ?? null,
      template: WEDDING_SPEECH_TEMPLATES[kind],
    })),
  };
}

/**
 * 協作者：誰能看、誰能改。Email 與等待中的邀請只給擁有者看，和網站一樣；
 * 邀請、改角色、移除仍在網站做，那些操作需要再三確認。
 */
export async function mobileMembers(workspaceId: string, userId: string) {
  const data = await loadWorkspaceMembersForUser(workspaceId, userId);
  const isOwner = data.role === "OWNER";
  return {
    role: data.role,
    members: data.members.map((member) => ({
      displayName: member.displayName,
      role: member.role,
      email: isOwner ? member.email ?? null : null,
    })),
    pendingInvitations: isOwner
      ? (data.pendingInvitations ?? []).map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
        }))
      : [],
  };
}
