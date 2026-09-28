import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type SeatingScenarioKind } from "@prisma/client";
import type { GuestAttendanceStatusValue, GuestSideValue } from "@/domain/guest";
import {
  MAX_SEATING_SCENARIO_BACKUPS,
  MAX_SEATING_SCENARIO_DRAFTS,
  normalizeSeatingScenarioName,
  previewSeatingScenarioApply,
  scenarioAssumptions,
  SeatingScenarioValidationError,
  type SeatingArrangement,
  type SeatingScenarioApplyPreview,
  type SeatingScenarioGuest,
} from "@/domain/seating-scenario";
import {
  MAX_SEATING_TABLE_COUNT,
  normalizeSeatingTableInput,
  seatingTableNumbers,
  SeatingTableValidationError,
} from "@/domain/seating-table";
import { WorkspaceAccessDeniedError, getWorkspacePermissions } from "@/domain/workspace";
import { prisma } from "@/lib/prisma";
import { runSerializableTransaction } from "@/lib/serializable-transaction";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

/**
 * 座位方案的資料層。正式安排仍是 seating_tables 與 guests.seating_table_id，
 * 報到、列印、手機與賓客名單全都照舊讀它；方案只是沙盒。
 *
 * 方案永遠不改賓客的出席回覆。套用時以實際回覆為準：方案裡坐了但目前是
 * 不出席的人不會入座（資料庫本來就有同樣的約束）。
 */

export class SeatingScenarioNotFoundError extends Error {
  constructor() {
    super("找不到這個方案，可能已被刪除。");
    this.name = "SeatingScenarioNotFoundError";
  }
}

export class SeatingScenarioStaleError extends Error {
  constructor(message = "方案剛剛被其他人修改，請重新整理後再試。") {
    super(message);
    this.name = "SeatingScenarioStaleError";
  }
}

export class SeatingScenarioDataError extends Error {
  constructor(message = "目前無法載入座位方案，請稍後再試。") {
    super(message);
    this.name = "SeatingScenarioDataError";
  }
}

type Tx = Prisma.TransactionClient;

type TableRow = {
  id: string;
  position: number;
  name: string;
  capacity: number;
  layoutX: number | null;
  layoutY: number | null;
  notes: string | null;
};

type GuestRow = {
  id: string;
  name: string;
  partySize: number;
  attendanceStatus: GuestAttendanceStatusValue;
  side: GuestSideValue;
  seatingTableId: string | null;
};

const tableSelect = {
  id: true,
  position: true,
  name: true,
  capacity: true,
  layoutX: true,
  layoutY: true,
  notes: true,
} as const;

/** 指紋包含桌名、容量、平面位置與誰坐哪桌；任何一項改了都算正式安排被動過。 */
function arrangementFingerprint(tables: TableRow[], seats: Record<string, number>): string {
  const canonical = JSON.stringify({
    tables: tables.map((table, index) => [
      index + 1,
      table.name,
      table.capacity,
      table.layoutX,
      table.layoutY,
      table.notes,
    ]),
    seats: Object.entries(seats).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function toArrangement(tables: TableRow[], seats: Record<string, number>): SeatingArrangement {
  return {
    tables: tables.map((table, index) => ({ rank: index + 1, name: table.name, capacity: table.capacity })),
    seats,
  };
}

/** 套用時不出席的人不會入座，所以比對「是否等於正式安排」要用套用後的實際結果。 */
function effectiveSeats(seats: Record<string, number>, guests: GuestRow[]): Record<string, number> {
  const declined = new Set(guests.filter((guest) => guest.attendanceStatus === "DECLINED").map((guest) => guest.id));
  return Object.fromEntries(Object.entries(seats).filter(([guestId]) => !declined.has(guestId)));
}

async function readGuests(tx: Tx, workspaceId: string): Promise<GuestRow[]> {
  return tx.guest.findMany({
    where: { workspaceId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      partySize: true,
      attendanceStatus: true,
      side: true,
      seatingTableId: true,
    },
  });
}

async function readLive(tx: Tx, workspaceId: string, guests: GuestRow[]) {
  const tables = await tx.seatingTable.findMany({
    where: { workspaceId },
    orderBy: [{ position: "asc" }],
    select: tableSelect,
  });
  const rankByTableId = new Map(tables.map((table, index) => [table.id, index + 1]));
  const seats: Record<string, number> = {};
  for (const guest of guests) {
    const rank = guest.seatingTableId ? rankByTableId.get(guest.seatingTableId) : undefined;
    if (rank !== undefined) seats[guest.id] = rank;
  }
  return {
    tables,
    seats,
    arrangement: toArrangement(tables, seats),
    fingerprint: arrangementFingerprint(tables, seats),
  };
}

async function readScenario(tx: Tx, workspaceId: string, scenarioId: string) {
  const scenario = await tx.seatingScenario.findFirst({
    where: { id: scenarioId, workspaceId },
    select: {
      id: true,
      name: true,
      kind: true,
      version: true,
      baseLiveFingerprint: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!scenario) throw new SeatingScenarioNotFoundError();
  const tables = await tx.seatingScenarioTable.findMany({
    where: { scenarioId, workspaceId },
    orderBy: [{ position: "asc" }],
    select: tableSelect,
  });
  const assignments = await tx.seatingScenarioAssignment.findMany({
    where: { scenarioId, workspaceId },
    select: { guestId: true, tableId: true },
  });
  const rankByTableId = new Map(tables.map((table, index) => [table.id, index + 1]));
  const seats: Record<string, number> = {};
  for (const assignment of assignments) {
    const rank = rankByTableId.get(assignment.tableId);
    if (rank !== undefined) seats[assignment.guestId] = rank;
  }
  return { scenario, tables, seats, arrangement: toArrangement(tables, seats) };
}

function scenarioGuests(guests: GuestRow[]): SeatingScenarioGuest[] {
  return guests.map(({ id, name, partySize, attendanceStatus }) => ({ id, name, partySize, attendanceStatus }));
}

/** 把一份正式安排原封不動複製成方案：草稿的起點，或套用前的自動備份。 */
async function snapshotLive(
  tx: Tx,
  workspaceId: string,
  name: string,
  kind: SeatingScenarioKind,
  live: Awaited<ReturnType<typeof readLive>>,
  guests: GuestRow[],
) {
  const scenario = await tx.seatingScenario.create({
    data: { workspaceId, name, kind, baseLiveFingerprint: live.fingerprint },
    select: { id: true },
  });
  if (live.tables.length > 0) {
    await tx.seatingScenarioTable.createMany({
      data: live.tables.map((table, index) => ({
        scenarioId: scenario.id,
        workspaceId,
        position: index + 1,
        name: table.name,
        capacity: table.capacity,
        layoutX: table.layoutX,
        layoutY: table.layoutY,
        notes: table.notes,
      })),
    });
  }
  const copied = await tx.seatingScenarioTable.findMany({
    where: { scenarioId: scenario.id, workspaceId },
    select: { id: true, position: true },
  });
  const copiedIdByRank = new Map(copied.map((table) => [table.position, table.id]));
  const assignments = guests.flatMap((guest) => {
    const rank = live.seats[guest.id];
    const tableId = rank === undefined ? undefined : copiedIdByRank.get(rank);
    return tableId ? [{ scenarioId: scenario.id, workspaceId, guestId: guest.id, tableId }] : [];
  });
  if (assignments.length > 0) {
    await tx.seatingScenarioAssignment.createMany({ data: assignments });
  }
  return scenario;
}

/** 每個草稿變更先過這一關：版本對得上才繼續，同時把版本往前推。 */
async function claimScenarioVersion(
  tx: Tx,
  workspaceId: string,
  scenarioId: string,
  expectedVersion: number,
) {
  const result = await tx.seatingScenario.updateMany({
    where: { id: scenarioId, workspaceId, version: expectedVersion },
    data: { version: { increment: 1 } },
  });
  if (result.count !== 1) {
    const exists = await tx.seatingScenario.count({ where: { id: scenarioId, workspaceId } });
    throw exists === 0 ? new SeatingScenarioNotFoundError() : new SeatingScenarioStaleError();
  }
}

function numbered<T>(items: T[]): Array<T & { rank: number; number: number }> {
  const numbers = seatingTableNumbers(items.length);
  return items.map((item, index) => ({ ...item, rank: index + 1, number: numbers[index]! }));
}

function backupName(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: timezone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `套用前的安排 ${part("month")}/${part("day")} ${part("hour")}:${part("minute")}`;
}

// ─── 讀取 ────────────────────────────────────────────────────────────────

export type SeatingScenarioSummary = {
  id: string;
  name: string;
  kind: SeatingScenarioKind;
  version: number;
  tableCount: number;
  seatedGroupCount: number;
  /** 正式安排在複製之後被改過；套用時要特別看差異。 */
  liveChangedSinceCopy: boolean;
  /** 內容和目前的正式安排完全相同（例如剛套用過）。 */
  matchesLive: boolean;
  updatedAt: string;
};

export async function loadSeatingScenarioList(workspaceId: string, userId: string) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const access = await requireWorkspaceAccess(workspaceId, userId, "read", tx);
        const guests = await readGuests(tx, workspaceId);
        const live = await readLive(tx, workspaceId, guests);
        const scenarios = await tx.seatingScenario.findMany({
          where: { workspaceId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            name: true,
            kind: true,
            version: true,
            baseLiveFingerprint: true,
            updatedAt: true,
          },
        });
        const summaries: SeatingScenarioSummary[] = [];
        for (const scenario of scenarios) {
          const detail = await readScenario(tx, workspaceId, scenario.id);
          summaries.push({
            id: scenario.id,
            name: scenario.name,
            kind: scenario.kind,
            version: scenario.version,
            tableCount: detail.tables.length,
            seatedGroupCount: Object.keys(detail.seats).length,
            liveChangedSinceCopy:
              scenario.baseLiveFingerprint !== null && scenario.baseLiveFingerprint !== live.fingerprint,
            matchesLive:
              arrangementFingerprint(detail.tables, effectiveSeats(detail.seats, guests)) === live.fingerprint,
            updatedAt: scenario.updatedAt.toISOString(),
          });
        }
        return {
          role: access.role,
          canEdit: getWorkspacePermissions(access.role).canEdit,
          drafts: summaries.filter((item) => item.kind === "DRAFT"),
          // 最新的備份放前面，想換回來時通常是找剛剛那一份。
          backups: summaries.filter((item) => item.kind === "BACKUP").reverse(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) throw error;
    throw new SeatingScenarioDataError();
  }
}

type SeatedGuestDto = {
  id: string;
  name: string;
  partySize: number;
  attendanceStatus: GuestAttendanceStatusValue;
  side: GuestSideValue;
};

export type SeatingScenarioPreviewDto = {
  moved: Array<{ guestId: string; name: string; fromNumber: number; toNumber: number }>;
  newlySeated: Array<{ guestId: string; name: string; toNumber: number }>;
  unseated: Array<{ guestId: string; name: string; fromNumber: number }>;
  willNotSeat: Array<{ guestId: string; name: string; toNumber: number }>;
  addedTableCount: number;
  removedTableCount: number;
  changedTables: Array<{
    number: number;
    before: { name: string; capacity: number };
    after: { name: string; capacity: number };
  }>;
  overCapacity: Array<{ number: number; name: string; capacity: number; seated: number }>;
  canApply: boolean;
  hasChanges: boolean;
};

/** 差異裡的「第幾桌」要換成桌卡上的號碼；兩份安排桌數不同，號碼也要各自推導。 */
function previewDto(
  preview: SeatingScenarioApplyPreview,
  liveCount: number,
  scenarioCount: number,
): SeatingScenarioPreviewDto {
  const liveNumbers = seatingTableNumbers(liveCount);
  const scenarioNumbers = seatingTableNumbers(scenarioCount);
  const live = (rank: number) => liveNumbers[rank - 1] ?? rank;
  const next = (rank: number) => scenarioNumbers[rank - 1] ?? rank;
  const dto: SeatingScenarioPreviewDto = {
    moved: preview.moved.map((item) => ({
      guestId: item.guestId,
      name: item.name,
      fromNumber: live(item.from),
      toNumber: next(item.to),
    })),
    newlySeated: preview.newlySeated.map((item) => ({ guestId: item.guestId, name: item.name, toNumber: next(item.to) })),
    unseated: preview.unseated.map((item) => ({ guestId: item.guestId, name: item.name, fromNumber: live(item.from) })),
    willNotSeat: preview.willNotSeat.map((item) => ({ guestId: item.guestId, name: item.name, toNumber: next(item.to) })),
    addedTableCount: preview.addedTableCount,
    removedTableCount: preview.removedTableCount,
    changedTables: preview.changedTables.map((item) => ({ number: next(item.rank), before: item.before, after: item.after })),
    overCapacity: preview.overCapacity.map((item) => ({
      number: next(item.rank),
      name: item.name,
      capacity: item.capacity,
      seated: item.seated,
    })),
    canApply: preview.canApply,
    hasChanges: false,
  };
  dto.hasChanges =
    dto.moved.length + dto.newlySeated.length + dto.unseated.length + dto.willNotSeat.length +
      dto.addedTableCount + dto.removedTableCount + dto.changedTables.length > 0;
  return dto;
}

export async function loadSeatingScenarioDetail(
  workspaceId: string,
  userId: string,
  scenarioId: string,
) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const access = await requireWorkspaceAccess<{ name: string }>(workspaceId, userId, "read", tx);
        const guests = await readGuests(tx, workspaceId);
        const live = await readLive(tx, workspaceId, guests);
        const detail = await readScenario(tx, workspaceId, scenarioId);
        const guestById = new Map(guests.map((guest) => [guest.id, guest]));
        const preview = previewSeatingScenarioApply({
          live: live.arrangement,
          scenario: detail.arrangement,
          guests: scenarioGuests(guests),
        });

        const seatedByRank = new Map<number, SeatedGuestDto[]>();
        for (const [guestId, rank] of Object.entries(detail.seats)) {
          const guest = guestById.get(guestId);
          if (!guest) continue;
          const list = seatedByRank.get(rank) ?? [];
          list.push({
            id: guest.id,
            name: guest.name,
            partySize: guest.partySize,
            attendanceStatus: guest.attendanceStatus,
            side: guest.side,
          });
          seatedByRank.set(rank, list);
        }
        const liveRankByGuest = live.seats;
        const tables = numbered(detail.tables).map((table) => {
          const seated = (seatedByRank.get(table.rank) ?? []).sort((left, right) =>
            left.name.localeCompare(right.name, "zh-Hant"),
          );
          // 只算會出席的人：不出席者在草稿裡可以先排著，但不佔套用後的座位。
          const seatedHeadcount = seated
            .filter((guest) => guest.attendanceStatus !== "DECLINED")
            .reduce((total, guest) => total + guest.partySize, 0);
          return {
            id: table.id,
            number: table.number,
            name: table.name,
            capacity: table.capacity,
            notes: table.notes,
            seatedHeadcount,
            differsFromLive:
              seated.some((guest) => liveRankByGuest[guest.id] !== table.rank) ||
              Object.entries(liveRankByGuest).some(
                ([guestId, rank]) => rank === table.rank && detail.seats[guestId] !== table.rank,
              ) ||
              live.tables[table.rank - 1]?.name !== table.name ||
              live.tables[table.rank - 1]?.capacity !== table.capacity,
            addedInScenario: table.rank > live.tables.length,
            guests: seated,
          };
        });
        const unseated = guests
          .filter((guest) => detail.seats[guest.id] === undefined)
          .map((guest) => ({
            id: guest.id,
            name: guest.name,
            partySize: guest.partySize,
            attendanceStatus: guest.attendanceStatus,
            side: guest.side,
          }));
        const numbers = seatingTableNumbers(detail.tables.length);
        return {
          role: access.role,
          canEdit: getWorkspacePermissions(access.role).canEdit,
          workspaceName: access.workspace.name,
          scenario: {
            id: detail.scenario.id,
            name: detail.scenario.name,
            kind: detail.scenario.kind,
            version: detail.scenario.version,
            updatedAt: detail.scenario.updatedAt.toISOString(),
            liveChangedSinceCopy:
              detail.scenario.baseLiveFingerprint !== null &&
              detail.scenario.baseLiveFingerprint !== live.fingerprint,
          },
          tables,
          unseated,
          assumptions: scenarioAssumptions(detail.seats, scenarioGuests(guests)).map((item) => ({
            guestId: item.guestId,
            name: item.name,
            attendanceStatus: item.attendanceStatus,
            toNumber: numbers[item.to - 1] ?? item.to,
          })),
          preview: previewDto(preview, live.tables.length, detail.tables.length),
          liveFingerprint: live.fingerprint,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError || error instanceof SeatingScenarioNotFoundError) {
      throw error;
    }
    throw new SeatingScenarioDataError();
  }
}

// ─── 草稿變更 ────────────────────────────────────────────────────────────

export async function createSeatingScenarioFromLive(
  workspaceId: string,
  userId: string,
  nameInput: unknown,
) {
  const name = normalizeSeatingScenarioName(nameInput);
  return runSerializableTransaction(async (tx) => {
    await requireLockedWorkspaceAccess(workspaceId, userId, "edit", tx);
    const drafts = await tx.seatingScenario.count({ where: { workspaceId, kind: "DRAFT" } });
    if (drafts >= MAX_SEATING_SCENARIO_DRAFTS) {
      throw new SeatingScenarioValidationError(
        `方案最多 ${MAX_SEATING_SCENARIO_DRAFTS} 份，請先刪掉用不到的方案。`,
      );
    }
    const guests = await readGuests(tx, workspaceId);
    const live = await readLive(tx, workspaceId, guests);
    return snapshotLive(tx, workspaceId, name, "DRAFT", live, guests);
  });
}

export async function renameSeatingScenario(
  workspaceId: string,
  userId: string,
  scenarioId: string,
  nameInput: unknown,
  expectedVersion: number,
) {
  const name = normalizeSeatingScenarioName(nameInput);
  return runSerializableTransaction(async (tx) => {
    await requireLockedWorkspaceAccess(workspaceId, userId, "edit", tx);
    await claimScenarioVersion(tx, workspaceId, scenarioId, expectedVersion);
    // 備份被改名就代表使用者想留著它，順便轉成一般方案，免得被自動清掉。
    await tx.seatingScenario.updateMany({
      where: { id: scenarioId, workspaceId },
      data: { name, kind: "DRAFT" },
    });
  });
}

export async function deleteSeatingScenario(
  workspaceId: string,
  userId: string,
  scenarioId: string,
  expectedVersion: number,
) {
  return runSerializableTransaction(async (tx) => {
    await requireLockedWorkspaceAccess(workspaceId, userId, "edit", tx);
    const result = await tx.seatingScenario.deleteMany({
      where: { id: scenarioId, workspaceId, version: expectedVersion },
    });
    if (result.count !== 1) {
      const exists = await tx.seatingScenario.count({ where: { id: scenarioId, workspaceId } });
      throw exists === 0 ? new SeatingScenarioNotFoundError() : new SeatingScenarioStaleError();
    }
  });
}

/** tableId 為 null 代表在這個方案裡不入座。草稿允許排不出席的人，也允許暫時超過座位。 */
export async function seatGuestInScenario(
  workspaceId: string,
  userId: string,
  scenarioId: string,
  guestId: string,
  tableId: string | null,
  expectedVersion: number,
) {
  return runSerializableTransaction(async (tx) => {
    await requireLockedWorkspaceAccess(workspaceId, userId, "edit", tx);
    await claimScenarioVersion(tx, workspaceId, scenarioId, expectedVersion);
    // guestId 與 tableId 都來自 client：必須確認屬於這個 workspace 與這個方案。
    const guest = await tx.guest.findFirst({ where: { id: guestId, workspaceId }, select: { id: true } });
    if (!guest) throw new SeatingScenarioStaleError("名單已更新，請重新整理後再試。");
    await tx.seatingScenarioAssignment.deleteMany({ where: { scenarioId, workspaceId, guestId } });
    if (tableId === null) return;
    const table = await tx.seatingScenarioTable.findFirst({
      where: { id: tableId, scenarioId, workspaceId },
      select: { id: true },
    });
    if (!table) throw new SeatingScenarioStaleError("這個方案的桌次已更新，請重新整理後再試。");
    await tx.seatingScenarioAssignment.create({ data: { scenarioId, workspaceId, guestId, tableId } });
  });
}

export async function addScenarioTable(
  workspaceId: string,
  userId: string,
  scenarioId: string,
  input: { name: unknown; capacity: unknown; notes?: unknown },
  expectedVersion: number,
) {
  const normalized = normalizeSeatingTableInput({ name: input.name, capacity: input.capacity, notes: input.notes ?? "" });
  return runSerializableTransaction(async (tx) => {
    await requireLockedWorkspaceAccess(workspaceId, userId, "edit", tx);
    await claimScenarioVersion(tx, workspaceId, scenarioId, expectedVersion);
    const aggregate = await tx.seatingScenarioTable.aggregate({
      where: { scenarioId, workspaceId },
      _count: { _all: true },
      _max: { position: true },
    });
    if (aggregate._count._all >= MAX_SEATING_TABLE_COUNT) {
      throw new SeatingTableValidationError(`桌次最多 ${MAX_SEATING_TABLE_COUNT} 桌。`);
    }
    await tx.seatingScenarioTable.create({
      data: { scenarioId, workspaceId, position: (aggregate._max.position ?? 0) + 1, ...normalized },
    });
  });
}

export async function updateScenarioTable(
  workspaceId: string,
  userId: string,
  scenarioId: string,
  tableId: string,
  input: { name: unknown; capacity: unknown; notes?: unknown },
  expectedVersion: number,
) {
  const normalized = normalizeSeatingTableInput({ name: input.name, capacity: input.capacity, notes: input.notes ?? "" });
  return runSerializableTransaction(async (tx) => {
    await requireLockedWorkspaceAccess(workspaceId, userId, "edit", tx);
    await claimScenarioVersion(tx, workspaceId, scenarioId, expectedVersion);
    const result = await tx.seatingScenarioTable.updateMany({
      where: { id: tableId, scenarioId, workspaceId },
      data: normalized,
    });
    if (result.count !== 1) throw new SeatingScenarioStaleError("這個方案的桌次已更新，請重新整理後再試。");
  });
}

/** 刪掉方案裡的一桌：那桌的人回到「未入座」，不影響正式安排。 */
export async function removeScenarioTable(
  workspaceId: string,
  userId: string,
  scenarioId: string,
  tableId: string,
  expectedVersion: number,
) {
  return runSerializableTransaction(async (tx) => {
    await requireLockedWorkspaceAccess(workspaceId, userId, "edit", tx);
    await claimScenarioVersion(tx, workspaceId, scenarioId, expectedVersion);
    const result = await tx.seatingScenarioTable.deleteMany({ where: { id: tableId, scenarioId, workspaceId } });
    if (result.count !== 1) throw new SeatingScenarioStaleError("這個方案的桌次已更新，請重新整理後再試。");
  });
}

// ─── 套用 ────────────────────────────────────────────────────────────────

/**
 * 把方案寫回正式安排。expectedLiveFingerprint 是使用者看過的差異所依據的正式安排；
 * 只要對不上就拒絕，確保實際套用的就是確認框裡看到的那份差異。
 *
 * 整件事在一個 Serializable 交易內完成：先把目前的正式安排自動備份，再重建
 * 正式桌次與座位，最後清掉超過上限的舊備份。任何一步失敗就全部不算。
 */
export async function applySeatingScenario(
  workspaceId: string,
  userId: string,
  scenarioId: string,
  expectedVersion: number,
  expectedLiveFingerprint: string,
  now = new Date(),
) {
  return runSerializableTransaction(async (tx) => {
    await requireLockedWorkspaceAccess(workspaceId, userId, "edit", tx);
    const workspace = await tx.weddingWorkspace.findUnique({
      where: { id: workspaceId },
      select: { timezone: true },
    });
    if (!workspace) throw new WorkspaceAccessDeniedError();

    const detail = await readScenario(tx, workspaceId, scenarioId);
    if (detail.scenario.version !== expectedVersion) throw new SeatingScenarioStaleError();

    const guests = await readGuests(tx, workspaceId);
    const live = await readLive(tx, workspaceId, guests);
    if (live.fingerprint !== expectedLiveFingerprint) {
      throw new SeatingScenarioStaleError("正式安排剛剛被修改，請重新檢視差異後再套用。");
    }

    const preview = previewSeatingScenarioApply({
      live: live.arrangement,
      scenario: detail.arrangement,
      guests: scenarioGuests(guests),
    });
    if (!preview.canApply) {
      throw new SeatingScenarioValidationError("有桌次超過座位，請先在方案裡調整後再套用。");
    }

    const backupLabel = backupName(now, workspace.timezone);
    const backup = await snapshotLive(tx, workspaceId, backupLabel, "BACKUP", live, guests);

    // 座位有變動的每一位賓客都要推進版本，網站上開著的舊表單才會被擋下。
    const touched = new Set([...Object.keys(live.seats), ...Object.keys(preview.effectiveSeats)]);
    if (touched.size > 0) {
      await tx.guest.updateMany({
        where: { workspaceId, id: { in: [...touched] } },
        data: { seatingTableId: null, version: { increment: 1 } },
      });
    }
    await tx.seatingTable.deleteMany({ where: { workspaceId } });
    if (detail.tables.length > 0) {
      await tx.seatingTable.createMany({
        data: detail.tables.map((table, index) => ({
          workspaceId,
          position: index + 1,
          name: table.name,
          capacity: table.capacity,
          layoutX: table.layoutX,
          layoutY: table.layoutY,
          notes: table.notes,
        })),
      });
    }
    const created = await tx.seatingTable.findMany({
      where: { workspaceId },
      select: { id: true, position: true },
    });
    const liveIdByRank = new Map(created.map((table) => [table.position, table.id]));
    const guestsByRank = new Map<number, string[]>();
    for (const [guestId, rank] of Object.entries(preview.effectiveSeats)) {
      const list = guestsByRank.get(rank) ?? [];
      list.push(guestId);
      guestsByRank.set(rank, list);
    }
    for (const [rank, guestIds] of guestsByRank) {
      const tableId = liveIdByRank.get(rank);
      if (!tableId) continue;
      await tx.guest.updateMany({
        where: { workspaceId, id: { in: guestIds }, attendanceStatus: { not: "DECLINED" } },
        data: { seatingTableId: tableId },
      });
    }

    // 套用後這個方案就和正式安排一致，記下新的指紋。
    const refreshed = await readLive(tx, workspaceId, await readGuests(tx, workspaceId));
    await tx.seatingScenario.updateMany({
      where: { id: scenarioId, workspaceId },
      data: { baseLiveFingerprint: refreshed.fingerprint, version: { increment: 1 } },
    });

    const backups = await tx.seatingScenario.findMany({
      where: { workspaceId, kind: "BACKUP", id: { not: scenarioId } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const expired = backups.slice(MAX_SEATING_SCENARIO_BACKUPS).map((item) => item.id);
    if (expired.length > 0) {
      await tx.seatingScenario.deleteMany({ where: { workspaceId, id: { in: expired } } });
    }

    return {
      backupId: backup.id,
      backupName: backupLabel,
      movedCount: preview.moved.length,
      newlySeatedCount: preview.newlySeated.length,
      unseatedCount: preview.unseated.length,
      willNotSeatCount: preview.willNotSeat.length,
    };
  });
}
