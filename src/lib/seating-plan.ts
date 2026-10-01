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
  importRecords: {
    orderBy: [{ source: "asc" }, { sourceInstance: "asc" }],
    select: { source: true, sourceInstance: true, sourceManaged: true, vegetarianCount: true, childSeatCount: true },
  },
} satisfies Prisma.GuestSelect;

export async function getSeatingPlan(workspaceId: string) {
  const currentUser = await requireCurrentUser();
  return loadSeatingPlanForUser(workspaceId, currentUser.id);
}

/** 手機端沿用同一份桌次資料；Membership 仍在交易內驗證。 */
export async function loadSeatingPlanForUser(workspaceId: string, userId: string) {
  try {
    return await prisma.$transaction(
      async (transaction) => {
        const access = await requireWorkspaceAccess<WeddingWorkspace>(
          workspaceId,
          userId,
          "read",
          transaction,
        );

        const [tables, unassignedGuestRows] = await Promise.all([
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
                  version: true,
                  name: true,
                  category: true,
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
                      vegetarianCount: true,
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
        ]);

        // 匯入只保留來源追蹤；目前名單的人數在桌次頁也可以直接調整。
        const unassignedGuests = unassignedGuestRows.map(({ importRecords, ...guest }) => ({
          ...guest,
          vegetarianCount: effectiveGuestDetailValue(importRecords, (record) => record.vegetarianCount),
          childSeatCount: effectiveGuestDetailValue(importRecords, (record) => record.childSeatCount),
        }));

        // 桌次頁只需要有效的兒童椅與素食人數，不把匯入來源與歷史明細送到瀏覽器。
        const tablesWithRequirements = tables.map((table) => ({
          ...table,
          guests: table.guests.map(({ importRecords, ...guest }) => ({
            ...guest,
            vegetarianCount: effectiveGuestDetailValue(importRecords, (record) => record.vegetarianCount),
            childSeatCount: effectiveGuestDetailValue(
              importRecords,
              (record) => record.childSeatCount,
            ),
          })),
        }));

        // 桌號在這裡才掛上去：它完全由順位決定，查詢的 orderBy 就是那個順位。
        return {
          ...access,
          tables: withSeatingTableNumbers(tablesWithRequirements),
          unassignedGuests,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      throw error;
    }

    throw new SeatingPlanDataError("目前無法載入桌次安排，請稍後再試。");
  }
}

/** 稱謂與同一戶設定屬於賓客明細，沿用 editor 邊界；只給帶位紙本使用，不併入桌次共用資料。 */
export type SeatingPrintDetails = { relationships: Map<string, string>; households: Map<string, string> };
export async function getSeatingPrintDetails(workspaceId: string): Promise<SeatingPrintDetails> {
  const currentUser = await requireCurrentUser();
  return prisma.$transaction(
    async (transaction) => {
      await requireWorkspaceAccess(workspaceId, currentUser.id, "edit", transaction);
      const guests = await transaction.guest.findMany({
        where: { workspaceId },
        select: {
          id: true,
          cakeHouseholdId: true,
          importRecords: {
            orderBy: [{ source: "asc" }, { sourceInstance: "asc" }],
            select: { source: true, sourceInstance: true, sourceManaged: true, relationshipLabel: true },
          },
        },
      });
      const relationships = new Map<string, string>();
      const households = new Map<string, string>();
      for (const guest of guests) {
        const label = effectiveGuestDetailValue(guest.importRecords, (record) => record.relationshipLabel)?.trim();
        if (label) relationships.set(guest.id, label);
        if (guest.cakeHouseholdId) households.set(guest.id, guest.cakeHouseholdId);
      }
      return { relationships, households };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
