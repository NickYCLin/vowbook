import "server-only";

import type { Prisma } from "@prisma/client";

import { effectiveGuestDetailValue } from "@/domain/guest-detail-value";
import type { NormalizedGuestDetailsInput } from "@/domain/guest-details";

export const MANUAL_DETAILS_SOURCE = "MANUAL";
export const MANUAL_DETAILS_SOURCE_INSTANCE = "guest-details";
export const MANUAL_DETAILS_SOURCE_LABEL = "自行填寫";

/** 網站表單與 App 都會改到的細項欄位，兩邊共用同一份清單。 */
export const GUEST_DETAILS_FIELDS = [
  "relationshipLabel",
  "contactPhone",
  "contactEmail",
  "childSeatCount",
  "vegetarianCount",
  "invitationDelivery",
  "mailingAddress",
  "guestMessage",
  "attendanceReply",
  "invitationReply",
] as const;

/**
 * 把手動填的賓客細項寫進同一筆 MANUAL 匯入紀錄。網站與 App 都走這裡，
 * 兩邊才不會各寫各的。ceremonyAttendance 是舊版離線匯入才有的欄位，
 * 即使呼叫端硬塞也只沿用資料庫現值。
 */
export async function upsertManualGuestDetails(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  guestId: string,
  details: NormalizedGuestDetailsInput,
) {
  const identity = {
    workspaceId,
    source: MANUAL_DETAILS_SOURCE,
    sourceInstance: MANUAL_DETAILS_SOURCE_INSTANCE,
    externalId: guestId,
  };
  const provenance = {
    guestId,
    workspaceId,
    source: MANUAL_DETAILS_SOURCE,
    sourceInstance: MANUAL_DETAILS_SOURCE_INSTANCE,
    sourceLabel: MANUAL_DETAILS_SOURCE_LABEL,
    sourceManaged: false,
    managedFields: [],
    externalId: guestId,
    sourcePartySize: null,
    sourceSubmittedAt: null,
  };

  const patchedDetails = {
    ...details,
    ceremonyAttendance: effectiveGuestDetailValue(
      await transaction.guestImportRecord.findMany({
        where: { guestId, workspaceId },
        orderBy: [{ source: "asc" }, { sourceInstance: "asc" }],
        select: {
          source: true,
          sourceInstance: true,
          sourceManaged: true,
          ceremonyAttendance: true,
        },
      }),
      (record) => record.ceremonyAttendance,
    ),
  };

  await transaction.guestImportRecord.upsert({
    where: { workspaceId_source_sourceInstance_externalId: identity },
    create: { ...provenance, ...patchedDetails },
    update: { ...provenance, ...patchedDetails },
  });
}
