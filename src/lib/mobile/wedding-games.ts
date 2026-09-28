import "server-only";

import {
  normalizeWeddingGameName,
  normalizeWeddingGameEntries,
  normalizeWeddingGameNote,
  parseWeddingGame,
  WEDDING_GAME_LABELS,
  WEDDING_GAME_MAX_PARTICIPANTS,
  WeddingGameValidationError,
} from "@/domain/wedding-game";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { MobileRequestError } from "@/lib/mobile/protocol";
import {
  runSerializableTransaction,
  SerializationConflictError,
} from "@/lib/serializable-transaction";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

const STALE_MESSAGE = "名單已被其他人更新，請重新整理後再試。";

function failure(error: unknown): never {
  if (error instanceof MobileRequestError) throw error;
  if (error instanceof WeddingGameValidationError) {
    throw new MobileRequestError(400, "VALIDATION", error.message);
  }
  if (error instanceof WorkspaceAccessDeniedError) {
    throw new MobileRequestError(403, "FORBIDDEN", "沒有這場婚宴的編輯權限。");
  }
  if (error instanceof SerializationConflictError) {
    throw new MobileRequestError(409, "CONFLICT", "剛剛有人同時操作，請重新整理後再試。");
  }
  throw new MobileRequestError(503, "UNAVAILABLE", "目前無法完成操作，請稍後再試。");
}

function versionOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "版本資訊無效，請重新整理後再試。");
  }
  return value;
}

type GameTransaction = {
  weddingGameParticipant: {
    findMany(args: unknown): Promise<Array<{ sortOrder: number }>>;
    createMany(args: unknown): Promise<{ count: number }>;
    updateMany(args: unknown): Promise<{ count: number }>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
};

/** 貼上多位姓名一次加入，接在目前名單最後面。 */
export async function mobileAddGameParticipants(
  workspaceId: string,
  userId: string,
  gameInput: unknown,
  namesInput: unknown,
) {
  try {
    const game = parseWeddingGame(gameInput);
    const names = normalizeWeddingGameEntries(namesInput);
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as GameTransaction;
      const existing = await client.weddingGameParticipant.findMany({
        where: { workspaceId, game },
        select: { sortOrder: true },
      });
      if (existing.length + names.length > WEDDING_GAME_MAX_PARTICIPANTS) {
        throw new WeddingGameValidationError(
          `${WEDDING_GAME_LABELS[game]}最多 ${WEDDING_GAME_MAX_PARTICIPANTS} 位，目前已有 ${existing.length} 位。`,
        );
      }
      const start = existing.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
      await client.weddingGameParticipant.createMany({
        data: names.map(({ name, note }, index) => ({ workspaceId, game, name, note, sortOrder: start + index })),
      });
      return { added: names.length };
    });
  } catch (error) {
    return failure(error);
  }
}

export async function mobileUpdateGameParticipant(
  workspaceId: string,
  userId: string,
  participantId: string,
  input: { name: unknown; note: unknown; expectedVersion: unknown },
) {
  try {
    const name = normalizeWeddingGameName(input.name);
    const note = normalizeWeddingGameNote(input.note ?? "");
    const version = versionOf(input.expectedVersion);
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as GameTransaction;
      const updated = await client.weddingGameParticipant.updateMany({
        where: { id: participantId, workspaceId, version },
        data: { name, note, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new MobileRequestError(409, "STALE", STALE_MESSAGE);
      return { id: participantId, name, note, version: version + 1 };
    });
  } catch (error) {
    return failure(error);
  }
}

export async function mobileDeleteGameParticipant(
  workspaceId: string,
  userId: string,
  participantId: string,
  expectedVersion: unknown,
) {
  try {
    const version = versionOf(expectedVersion);
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as GameTransaction;
      const deleted = await client.weddingGameParticipant.deleteMany({
        where: { id: participantId, workspaceId, version },
      });
      if (deleted.count !== 1) throw new MobileRequestError(409, "STALE", STALE_MESSAGE);
      return { removed: true };
    });
  } catch (error) {
    return failure(error);
  }
}
