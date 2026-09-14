import "server-only";

import {
  Prisma,
  type GuestManagedField,
  type WeddingWorkspace,
} from "@prisma/client";
import {
  compareGuestsBySeniorityThenSurnameStroke,
  type GuestAttendanceStatusValue,
  type GuestCategoryValue,
  type GuestSeniorityValue,
  type GuestSideValue,
} from "@/domain/guest";
import { withSeatingTableNumbers } from "@/domain/seating-table";
import {
  getWorkspacePermissions,
  WorkspaceAccessDeniedError,
} from "@/domain/workspace";
import { effectiveGuestDetailValue } from "@/domain/guest-detail-value";
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

export type GuestDetailsDto = Pick<
  GuestImportDetailsDto,
  | "relationshipLabel"
  | "contactPhone"
  | "contactEmail"
  | "ceremonyAttendance"
  | "childSeatCount"
  | "vegetarianCount"
  | "invitationDelivery"
  | "mailingAddress"
  | "guestMessage"
  | "attendanceReply"
  | "invitationReply"
>;

export type GuestImportRecordDto = {
  provenanceKey: string;
  source: string;
  sourceLabel: string;
  sourceManaged: boolean;
  managedFields: GuestManagedField[];
  details: GuestImportDetailsDto | null;
};

export type WeddingGiftEntryDto = {
  id: string;
  amount: number;
  notes: string | null;
  createdAt: Date;
  returnGiftSentAt: Date | null;
  returnGiftNote: string | null;
  version: number;
};

export type GuestCheckInEntryDto = {
  id: string;
  headcount: number;
  version: number;
};

export type GuestListItemDto = {
  giftExemptWithCake?: boolean;
  id: string;
  version: number;
  name: string;
  category: GuestCategoryValue;
  seniority: GuestSeniorityValue;
  side: GuestSideValue;
  attendanceStatus: GuestAttendanceStatusValue;
  partySize: number;
  notes: string | null;
  // 桌名可以重複，所以只給名字認不出是哪一桌，桌號才是身分。
  seatingTable: { number: number; name: string } | null;
  weddingGift: WeddingGiftEntryDto | null;
  checkIn: GuestCheckInEntryDto | null;
  details: GuestDetailsDto | null;
  importRecords: GuestImportRecordDto[];
};

const baseGuestSelect = {
  giftExemptWithCake: true,
  id: true,
  version: true,
  name: true,
  category: true,
  seniority: true,
  side: true,
  attendanceStatus: true,
  partySize: true,
  notes: true,
  seatingTable: { select: { id: true, name: true } },
  weddingGift: {
    select: {
      id: true,
      amount: true,
      notes: true,
      createdAt: true,
      returnGiftSentAt: true,
      returnGiftNote: true,
      version: true,
    },
  },
  // 刪除賓客會 cascade 報到紀錄，所以刪除前必須先讓操作者看到它。
  checkIn: { select: { id: true, headcount: true, version: true } },
} as const;

/**
 * 桌號是從整份桌次清單的順位推導的，單看一位賓客關聯到的那一列算不出來，
 * 所以要另外把工作區的桌次照順位撈一次。
 */
async function seatingTableNumbers(
  client: Pick<Prisma.TransactionClient, "seatingTable">,
  workspaceId: string,
): Promise<Map<string, number>> {
  const tables = await client.seatingTable.findMany({
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
  sourceInstance: true,
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

type EditorImportRecord = {
  source: string;
  sourceInstance?: string;
  sourceManaged: boolean;
  relationshipLabel: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  ceremonyAttendance: boolean | null;
  childSeatCount: number | null;
  vegetarianCount: number | null;
  invitationDelivery: GuestDetailsDto["invitationDelivery"];
  mailingAddress: string | null;
  guestMessage: string | null;
  attendanceReply: string | null;
  invitationReply: string | null;
};

const detailFields = [
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
] as const satisfies readonly (keyof GuestDetailsDto)[];

function detailsFromRecords(
  records: readonly EditorImportRecord[],
): GuestDetailsDto | null {
  if (records.length === 0) return null;

  const details = Object.fromEntries(
    detailFields.map((field) => [
      field,
      effectiveGuestDetailValue(records, (record) => record[field]),
    ]),
  ) as GuestDetailsDto;

  return Object.values(details).some((value) => value !== null)
    ? details
    : null;
}

export async function listGuestsForWorkspace(workspaceId: string) {
  const currentUser = await requireCurrentUser();

  try {
    return await prisma.$transaction(
      async (transaction) => {
        const access = await requireWorkspaceAccess<WeddingWorkspace>(
          workspaceId,
          currentUser.id,
          "read",
          transaction,
        );

        if (!getWorkspacePermissions(access.role).canEdit) {
          const [tableNumbers, guests] = await Promise.all([
            seatingTableNumbers(transaction, workspaceId),
            transaction.guest.findMany({
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
            weddingGift: guest.weddingGift ?? null,
            checkIn: guest.checkIn ?? null,
            details: null,
            importRecords: guest.importRecords.map((record) => ({
              provenanceKey: record.id,
              source: record.source,
              sourceLabel: record.sourceLabel,
              sourceManaged: record.sourceManaged,
              managedFields: [],
              details: null,
            })),
          }));
          viewerGuests.sort(compareGuestsBySeniorityThenSurnameStroke);
          return { ...access, guests: viewerGuests };
        }

        const [tableNumbers, guests] = await Promise.all([
          seatingTableNumbers(transaction, workspaceId),
          transaction.guest.findMany({
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
          weddingGift: guest.weddingGift ?? null,
          checkIn: guest.checkIn ?? null,
          details: detailsFromRecords(guest.importRecords),
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

        editorGuests.sort(compareGuestsBySeniorityThenSurnameStroke);
        return { ...access, guests: editorGuests };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      throw error;
    }

    throw new GuestDataError("目前無法載入賓客名單，請稍後再試。");
  }
}
