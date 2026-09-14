import "server-only";

import { Prisma, type WeddingWorkspace } from "@prisma/client";
import type {
  GuestAttendanceStatusValue,
  GuestCategoryValue,
  GuestSideValue,
} from "@/domain/guest";
import {
  summarizeGuestCheckIns,
  type GuestCheckInSummary,
} from "@/domain/guest-check-in";
import { withSeatingTableNumbers } from "@/domain/seating-table";
import {
  WorkspaceAccessDeniedError,
  type WorkspaceRole,
} from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-access";

export class GuestCheckInBoardDataError extends Error {
  constructor(message = "目前無法載入報到名單，請稍後再試。") {
    super(message);
    this.name = "GuestCheckInBoardDataError";
  }
}

export type GuestCheckInEntryDto = {
  id: string;
  headcount: number;
  notes: string | null;
  checkedInAt: Date;
  version: number;
};

export type GuestCheckInBoardGuestDto = {
  id: string;
  name: string;
  category: GuestCategoryValue;
  side: GuestSideValue;
  attendanceStatus: GuestAttendanceStatusValue;
  partySize: number;
  notes: string | null;
  // 桌名可以重複，所以只給名字認不出是哪一桌，桌號才是身分。
  seatingTable: { number: number; name: string } | null;
  checkIn: GuestCheckInEntryDto | null;
};

export type GuestCheckInBoardTableDto = {
  id: string;
  number: number;
  name: string;
  capacity: number;
  expectedHeadcount: number;
  arrivedHeadcount: number;
  pendingGroups: number;
};

export type GuestCheckInBoardData = {
  role: WorkspaceRole;
  workspace: { id: string; name: string };
  guests: GuestCheckInBoardGuestDto[];
  tables: GuestCheckInBoardTableDto[];
  summary: GuestCheckInSummary;
};

type BoardTableRecord = {
  id: string;
  name: string;
  capacity: number;
};

type BoardGuestRecord = {
  id: string;
  name: string;
  category: GuestCategoryValue;
  side: GuestSideValue;
  attendanceStatus: GuestAttendanceStatusValue;
  partySize: number;
  notes: string | null;
  seatingTableId: string | null;
  checkIn: GuestCheckInEntryDto | null;
};

type GuestCheckInTransactionClient = {
  membership: {
    findUnique(args: unknown): Promise<{
      role: string;
      workspace: Pick<WeddingWorkspace, "id" | "name">;
    } | null>;
  };
  seatingTable: { findMany(args: unknown): Promise<BoardTableRecord[]> };
  guest: { findMany(args: unknown): Promise<BoardGuestRecord[]> };
};

type GuestCheckInPrismaClient = {
  $transaction<T>(
    operation: (transaction: GuestCheckInTransactionClient) => Promise<T>,
    options: { isolationLevel: string },
  ): Promise<T>;
};

const guestSelect = {
  id: true,
  name: true,
  category: true,
  side: true,
  attendanceStatus: true,
  partySize: true,
  notes: true,
  seatingTableId: true,
  checkIn: {
    select: {
      id: true,
      headcount: true,
      notes: true,
      checkedInAt: true,
      version: true,
    },
  },
} as const;

/**
 * 報到桌是照桌次找人的，所以清單先照桌號排、未安排座位的排最後；
 * 同桌內維持建立順序，讓已經印出來的名單和畫面對得起來。
 */
function boardOrder(
  guest: GuestCheckInBoardGuestDto,
): [number, string] {
  return [guest.seatingTable?.number ?? Number.MAX_SAFE_INTEGER, guest.name];
}

export async function getGuestCheckInBoard(
  workspaceId: string,
): Promise<GuestCheckInBoardData> {
  const currentUser = await requireCurrentUser();
  const boardPrisma = prisma as unknown as GuestCheckInPrismaClient;

  try {
    return await boardPrisma.$transaction(
      async (transaction) => {
        const access = await requireWorkspaceAccess<
          Pick<WeddingWorkspace, "id" | "name">
        >(workspaceId, currentUser.id, "read", transaction);

        const tables = await transaction.seatingTable.findMany({
          where: { workspaceId },
          orderBy: [{ position: "asc" }],
          select: { id: true, name: true, capacity: true },
        });
        const numberedTables = withSeatingTableNumbers(tables);
        const tableById = new Map(
          numberedTables.map((table) => [table.id, table]),
        );

        const records = await transaction.guest.findMany({
          where: { workspaceId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: guestSelect,
        });

        const guests: GuestCheckInBoardGuestDto[] = records.map((record) => {
          const table = record.seatingTableId
            ? tableById.get(record.seatingTableId)
            : undefined;
          return {
            id: record.id,
            name: record.name,
            category: record.category,
            side: record.side,
            attendanceStatus: record.attendanceStatus,
            partySize: record.partySize,
            notes: record.notes,
            seatingTable: table
              ? { number: table.number, name: table.name }
              : null,
            checkIn: record.checkIn ?? null,
          };
        });

        guests.sort((left, right) => {
          const [leftNumber, leftName] = boardOrder(left);
          const [rightNumber, rightName] = boardOrder(right);
          if (leftNumber !== rightNumber) return leftNumber - rightNumber;
          return leftName.localeCompare(rightName, "zh-Hant");
        });

        const guestsByTableId = new Map<string, BoardGuestRecord[]>();
        for (const record of records) {
          if (!record.seatingTableId) continue;
          const bucket = guestsByTableId.get(record.seatingTableId) ?? [];
          bucket.push(record);
          guestsByTableId.set(record.seatingTableId, bucket);
        }

        const boardTables: GuestCheckInBoardTableDto[] = numberedTables.map(
          (table) => {
            const seated = guestsByTableId.get(table.id) ?? [];
            const tableSummary = summarizeGuestCheckIns(
              seated.map((guest) => ({
                attendanceStatus: guest.attendanceStatus,
                partySize: guest.partySize,
                checkedInHeadcount: guest.checkIn?.headcount ?? null,
              })),
            );
            return {
              id: table.id,
              number: table.number,
              name: table.name,
              capacity: table.capacity,
              expectedHeadcount: tableSummary.expectedHeadcount,
              arrivedHeadcount: tableSummary.arrivedHeadcount,
              pendingGroups: tableSummary.pendingGroups,
            };
          },
        );

        return {
          role: access.role,
          workspace: { id: access.workspace.id, name: access.workspace.name },
          guests,
          tables: boardTables,
          summary: summarizeGuestCheckIns(
            guests.map((guest) => ({
              attendanceStatus: guest.attendanceStatus,
              partySize: guest.partySize,
              checkedInHeadcount: guest.checkIn?.headcount ?? null,
            })),
          ),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) throw error;
    throw new GuestCheckInBoardDataError();
  }
}
