import "server-only";

import type { GuestManagedField, WeddingWorkspace } from "@prisma/client";
import type {
  GuestAttendanceStatusValue,
  GuestCategoryValue,
  GuestSideValue,
} from "@/domain/guest";
import { withSeatingTableNumbers } from "@/domain/seating-table";
import {
  getWorkspacePermissions,
  WorkspaceAccessDeniedError,
} from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-access";

export class GuestDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuestDataError";
  }
}

export type GuestImportDetailsDto = {
  sourcePartySize: number | null;
  relationshipLabel: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  ceremonyAttendance: boolean | null;
  childSeatCount: number | null;
  vegetarianCount: number | null;
  invitationDelivery: "PAPER" | "DIGITAL" | "NONE" | "UNKNOWN" | null;
  mailingAddress: string | null;
  guestMessage: string | null;
  attendanceReply: string | null;
  invitationReply: string | null;
  sourceSubmittedAt: Date | null;
};

export type GuestImportRecordDto = {
  provenanceKey: string;
  source: string;
  sourceLabel: string;
  sourceManaged: boolean;
  managedFields: GuestManagedField[];
  details: GuestImportDetailsDto | null;
};

export type GuestListItemDto = {
  id: string;
  version: number;
  name: string;
  category: GuestCategoryValue;
  side: GuestSideValue;
  attendanceStatus: GuestAttendanceStatusValue;
  partySize: number;
  notes: string | null;
  // 桌名可以重複，所以只給名字認不出是哪一桌，桌號才是身分。
  seatingTable: { number: number; name: string } | null;
  importRecords: GuestImportRecordDto[];
};

const baseGuestSelect = {
  id: true,
  version: true,
  name: true,
  category: true,
  side: true,
  attendanceStatus: true,
  partySize: true,
  notes: true,
  seatingTable: { select: { id: true, name: true } },
} as const;

/**
 * 桌號是從整份桌次清單的順位推導的，單看一位賓客關聯到的那一列算不出來，
 * 所以要另外把工作區的桌次照順位撈一次。
 */
async function seatingTableNumbers(
  workspaceId: string,
): Promise<Map<string, number>> {
  const tables = await prisma.seatingTable.findMany({
    where: { workspaceId },
    orderBy: [{ position: "asc" }],
    select: { id: true },
  });
  return new Map(
    withSeatingTableNumbers(tables).map((table) => [table.id, table.number]),
  );
}

function seatingTableOf(
  guest: { seatingTable: { id: string; name: string } | null },
  numbers: Map<string, number>,
): GuestListItemDto["seatingTable"] {
  if (!guest.seatingTable) {
    return null;
  }
  const number = numbers.get(guest.seatingTable.id);
  // 號碼查不到就當作沒安排：寧可顯示「尚未安排」，也不要印一個錯的桌號讓
  // 賓客走到別桌去。
  return number === undefined
    ? null
    : { number, name: guest.seatingTable.name };
}

const editorImportRecordSelect = {
  id: true,
  source: true,
  sourceLabel: true,
  sourceManaged: true,
  managedFields: true,
  sourcePartySize: true,
  relationshipLabel: true,
  contactPhone: true,
  contactEmail: true,
  ceremonyAttendance: true,
  childSeatCount: true,
  vegetarianCount: true,
  invitationDelivery: true,
  mailingAddress: true,
  guestMessage: true,
  attendanceReply: true,
  invitationReply: true,
  sourceSubmittedAt: true,
} as const;

export async function listGuestsForWorkspace(workspaceId: string) {
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

    throw new GuestDataError("目前無法載入賓客名單，請稍後再試。");
  }

  try {
    if (!getWorkspacePermissions(access.role).canEdit) {
      const [tableNumbers, guests] = await Promise.all([
        seatingTableNumbers(workspaceId),
        prisma.guest.findMany({
          where: { workspaceId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            ...baseGuestSelect,
            importRecords: {
              orderBy: [{ source: "asc" }, { sourceInstance: "asc" }],
              select: {
                id: true,
                source: true,
                sourceLabel: true,
                sourceManaged: true,
              },
            },
          },
        }),
      ]);

      const viewerGuests: GuestListItemDto[] = guests.map((guest) => ({
        ...guest,
        seatingTable: seatingTableOf(guest, tableNumbers),
        importRecords: guest.importRecords.map((record) => ({
          provenanceKey: record.id,
          source: record.source,
          sourceLabel: record.sourceLabel,
          sourceManaged: record.sourceManaged,
          managedFields: [],
          details: null,
        })),
      }));
      return { ...access, guests: viewerGuests };
    }

    const [tableNumbers, guests] = await Promise.all([
      seatingTableNumbers(workspaceId),
      prisma.guest.findMany({
        where: { workspaceId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          ...baseGuestSelect,
          importRecords: {
            orderBy: [{ source: "asc" }, { sourceInstance: "asc" }],
            select: editorImportRecordSelect,
          },
        },
      }),
    ]);

    const editorGuests: GuestListItemDto[] = guests.map((guest) => ({
      ...guest,
      seatingTable: seatingTableOf(guest, tableNumbers),
      importRecords: guest.importRecords.map((record) => ({
        provenanceKey: record.id,
        source: record.source,
        sourceLabel: record.sourceLabel,
        sourceManaged: record.sourceManaged,
        managedFields: record.managedFields,
        details: {
          sourcePartySize: record.sourcePartySize,
          relationshipLabel: record.relationshipLabel,
          contactPhone: record.contactPhone,
          contactEmail: record.contactEmail,
          ceremonyAttendance: record.ceremonyAttendance,
          childSeatCount: record.childSeatCount,
          vegetarianCount: record.vegetarianCount,
          invitationDelivery: record.invitationDelivery,
          mailingAddress: record.mailingAddress,
          guestMessage: record.guestMessage,
          attendanceReply: record.attendanceReply,
          invitationReply: record.invitationReply,
          sourceSubmittedAt: record.sourceSubmittedAt,
        },
      })),
    }));

    return { ...access, guests: editorGuests };
  } catch {
    throw new GuestDataError("目前無法載入賓客名單，請稍後再試。");
  }
}
