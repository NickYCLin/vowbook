import "server-only";

import {
  guestCheckInBlockReason,
  GuestCheckInValidationError,
  normalizeGuestCheckInDetails,
} from "@/domain/guest-check-in";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import {
  loadGuestCheckInBoard,
  type GuestCheckInBoardData,
} from "@/lib/guest-check-in-board";
import { MobileRequestError } from "@/lib/mobile/protocol";
import {
  runSerializableTransaction,
  SerializationConflictError,
} from "@/lib/serializable-transaction";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

/**
 * 手機報到只送當天要看的欄位：名字、桌號、預計人數與目前報到狀態。
 * 備註與聯絡資訊留在網站，手機在會場人多眼雜，少一個外洩面。
 */
export type MobileCheckInGuest = {
  id: string;
  name: string;
  partySize: number;
  attendanceStatus: string;
  blockedReason: string | null;
  tableNumber: number | null;
  tableName: string | null;
  checkIn: { id: string; headcount: number; checkedInAt: string; version: number } | null;
};

export type MobileCheckInBoard = {
  workspace: { id: string; name: string };
  role: string;
  canEdit: boolean;
  summary: { expectedHeadcount: number; arrivedHeadcount: number; arrivedGroups: number; pendingGroups: number };
  guests: MobileCheckInGuest[];
};

const EDITOR_ROLES = new Set(["OWNER", "PARTNER", "PLANNER", "COORDINATOR"]);

function toMobileGuest(
  guest: GuestCheckInBoardData["guests"][number],
): MobileCheckInGuest {
  return {
    id: guest.id,
    name: guest.name,
    partySize: guest.partySize,
    attendanceStatus: guest.attendanceStatus,
    blockedReason: guestCheckInBlockReason(guest),
    tableNumber: guest.seatingTable?.number ?? null,
    tableName: guest.seatingTable?.name ?? null,
    checkIn: guest.checkIn
      ? {
          id: guest.checkIn.id,
          headcount: guest.checkIn.headcount,
          checkedInAt: guest.checkIn.checkedInAt.toISOString(),
          version: guest.checkIn.version,
        }
      : null,
  };
}

export async function mobileCheckInBoard(
  workspaceId: string,
  userId: string,
): Promise<MobileCheckInBoard> {
  const board = await loadGuestCheckInBoard(workspaceId, userId);
  const guests = board.guests.map(toMobileGuest);
  const eligible = guests.filter((guest) => guest.blockedReason === null);
  return {
    workspace: board.workspace,
    role: board.role,
    canEdit: EDITOR_ROLES.has(board.role),
    summary: {
      expectedHeadcount: eligible.reduce((total, guest) => total + guest.partySize, 0),
      arrivedHeadcount: eligible.reduce(
        (total, guest) => total + (guest.checkIn?.headcount ?? 0),
        0,
      ),
      arrivedGroups: eligible.filter((guest) => guest.checkIn !== null).length,
      pendingGroups: eligible.filter((guest) => guest.checkIn === null).length,
    },
    guests,
  };
}

type CheckInMutationClient = {
  guest: {
    findFirst(args: unknown): Promise<{ id: string; category: string; attendanceStatus: string } | null>;
  };
  guestCheckIn: {
    create(args: unknown): Promise<{ id: string; headcount: number; checkedInAt: Date; version: number }>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
};

function asMobileError(error: unknown): never {
  if (error instanceof GuestCheckInValidationError) {
    throw new MobileRequestError(400, "VALIDATION", error.message);
  }
  if (error instanceof WorkspaceAccessDeniedError) {
    throw new MobileRequestError(403, "FORBIDDEN", "沒有這場婚宴的編輯權限。");
  }
  if (error instanceof SerializationConflictError) {
    throw new MobileRequestError(409, "CONFLICT", "剛剛有人同時操作，請重新整理後再試。");
  }
  if (error instanceof MobileRequestError) throw error;
  throw new MobileRequestError(503, "UNAVAILABLE", "目前無法完成報到，請稍後再試。");
}

export async function mobileCheckInGuest(
  workspaceId: string,
  userId: string,
  guestId: string,
  input: { headcount: unknown; notes: unknown },
) {
  const details = (() => {
    try {
      return normalizeGuestCheckInDetails(input);
    } catch (error) {
      return asMobileError(error);
    }
  })();

  try {
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as CheckInMutationClient;
      // client 傳來的 guestId 不可信，先確認它屬於這個 workspace。
      const guest = await client.guest.findFirst({
        where: { id: guestId, workspaceId },
        select: { id: true, category: true, attendanceStatus: true },
      });
      if (!guest) {
        throw new MobileRequestError(409, "STALE", "名單已更新，請重新整理後再試。");
      }
      const blocked = guestCheckInBlockReason(
        guest as unknown as Parameters<typeof guestCheckInBlockReason>[0],
      );
      if (blocked) throw new GuestCheckInValidationError(blocked);
      const created = await client.guestCheckIn.create({
        data: { workspaceId, guestId, ...details },
        select: { id: true, headcount: true, checkedInAt: true, version: true },
      });
      return {
        id: created.id,
        headcount: created.headcount,
        checkedInAt: created.checkedInAt.toISOString(),
        version: created.version,
      };
    });
  } catch (error) {
    return asMobileError(error);
  }
}

export async function mobileCancelCheckIn(
  workspaceId: string,
  userId: string,
  checkInId: string,
  expectedVersion: number,
) {
  try {
    await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as CheckInMutationClient;
      const result = await client.guestCheckIn.deleteMany({
        where: { id: checkInId, workspaceId, version: expectedVersion },
      });
      if (result.count !== 1) {
        throw new MobileRequestError(409, "STALE", "報到狀態已變更，請重新整理後再試。");
      }
    });
  } catch (error) {
    asMobileError(error);
  }
}
