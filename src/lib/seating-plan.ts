import "server-only";

import { Prisma, type WeddingWorkspace } from "@prisma/client";
import { withSeatingTableNumbers } from "@/domain/seating-table";
import { effectiveGuestDetailValue } from "@/domain/guest-detail-value";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-access";

export class SeatingPlanDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeatingPlanDataError";
  }
}

/**
 * 未安排賓客可以直接在桌次頁調整邀請人數，所以要多帶 CAS 版本，
 * 以及 updateGuestAction 要求的其餘欄位（原樣回傳、不在這頁修改）。
 */
const unassignedGuestSelect = {
  id: true,
  name: true,
  category: true,
  seniority: true,
  partySize: true,
  version: true,
  side: true,
  attendanceStatus: true,
  notes: true,
} as const;

export async function getSeatingPlan(workspaceId: string) {
  const currentUser = await requireCurrentUser();

  let access;
  try {
    access = await requireWorkspaceAccess<WeddingWorkspace>(
      workspaceId,
      currentUser.id,
      "read",
    );
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      throw error;
    }

    throw new SeatingPlanDataError("目前無法載入桌次安排，請稍後再試。");
  }

  try {
    const [tables, unassignedGuestRows] = await prisma.$transaction(
      async (transaction) =>
        Promise.all([
          transaction.seatingTable.findMany({
            where: { workspaceId },
            orderBy: [{ position: "asc" }],
            select: {
              id: true,
              position: true,
              version: true,
              layoutX: true,
              layoutY: true,
              name: true,
              capacity: true,
              notes: true,
              guests: {
                where: { workspaceId },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                // side 是拿來推「這桌屬於哪一邊」的：桌次本身沒有這個欄位。
                select: {
                  id: true,
                  name: true,
                  partySize: true,
                  side: true,
                  notes: true,
                  importRecords: {
                    orderBy: [{ source: "asc" }, { sourceInstance: "asc" }],
                    select: {
                      source: true,
                      sourceInstance: true,
                      sourceManaged: true,
                      childSeatCount: true,
                    },
                  },
                },
              },
            },
          }),
          transaction.guest.findMany({
            where: {
              workspaceId,
              seatingTableId: null,
              attendanceStatus: { not: "DECLINED" },
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: unassignedGuestSelect,
          }),
        ]),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    // 匯入只保留來源追蹤；目前名單的人數在桌次頁也可以直接調整。
    const unassignedGuests = unassignedGuestRows;

    // 桌次頁只需要有效的兒童椅張數，不把匯入來源與歷史明細送到瀏覽器。
    const tablesWithChildSeats = tables.map((table) => ({
      ...table,
      guests: table.guests.map(({ importRecords, ...guest }) => ({
        ...guest,
        childSeatCount: effectiveGuestDetailValue(
          importRecords,
          (record) => record.childSeatCount,
        ),
      })),
    }));

    // 桌號在這裡才掛上去：它完全由順位決定，查詢的 orderBy 就是那個順位。
    return {
      ...access,
      tables: withSeatingTableNumbers(tablesWithChildSeats),
      unassignedGuests,
    };
  } catch {
    throw new SeatingPlanDataError("目前無法載入桌次安排，請稍後再試。");
  }
}
