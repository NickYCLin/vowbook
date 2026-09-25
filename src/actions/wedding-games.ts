"use server";

import { revalidatePath } from "next/cache";
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
import { requireCurrentUser } from "@/lib/current-user";
import { runSerializableTransaction } from "@/lib/serializable-transaction";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

export type WeddingGameMutationState = {
  status: "idle" | "success" | "error";
  code?: "VALIDATION" | "FORBIDDEN" | "STALE" | "UNAVAILABLE";
  message?: string;
};

class GameParticipantStaleError extends Error {}

async function authorize(
  workspaceId: string,
): Promise<string | WeddingGameMutationState> {
  const currentUser = await requireCurrentUser();
  try {
    await requireWorkspaceAccess(workspaceId, currentUser.id, "edit");
    return currentUser.id;
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return { status: "error", code: "FORBIDDEN", message: error.message };
    }
    return {
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法確認工作區權限，請稍後再試。",
    };
  }
}

function expectedVersion(formData: FormData): number {
  const raw = formData.get("expectedVersion");
  const value = typeof raw === "string" && /^\d+$/u.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value)) {
    throw new WeddingGameValidationError("版本資訊無效，請重新整理後再試。");
  }
  return value;
}

function failure(error: unknown, fallback: string): WeddingGameMutationState {
  if (error instanceof WorkspaceAccessDeniedError) {
    return { status: "error", code: "FORBIDDEN", message: error.message };
  }
  if (error instanceof WeddingGameValidationError) {
    return { status: "error", code: "VALIDATION", message: error.message };
  }
  if (error instanceof GameParticipantStaleError) {
    return {
      status: "error",
      code: "STALE",
      message: "名單已被其他人更新，請重新整理後再試。",
    };
  }
  return { status: "error", code: "UNAVAILABLE", message: fallback };
}

async function success(
  workspaceId: string,
  message: string,
): Promise<WeddingGameMutationState> {
  try {
    await revalidatePath(`/workspaces/${workspaceId}/timeline`);
    return { status: "success", message };
  } catch {
    console.error("遊戲名單頁面重新驗證失敗。");
    return {
      status: "success",
      message: `${message.replace(/。$/u, "")}；畫面未自動更新，請重新整理。`,
    };
  }
}

export async function addWeddingGameParticipantsAction(
  workspaceId: string,
  _previousState: WeddingGameMutationState,
  formData: FormData,
): Promise<WeddingGameMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let game: ReturnType<typeof parseWeddingGame>;
  let names: ReturnType<typeof normalizeWeddingGameEntries>;
  try {
    game = parseWeddingGame(formData.get("game"));
    names = normalizeWeddingGameEntries(formData.get("names"));
  } catch (error) {
    return failure(error, "輸入內容有誤，請重新確認。");
  }

  try {
    await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      const existing = await transaction.weddingGameParticipant.findMany({
        where: { workspaceId, game },
        select: { sortOrder: true },
      });
      if (existing.length + names.length > WEDDING_GAME_MAX_PARTICIPANTS) {
        throw new WeddingGameValidationError(
          `${WEDDING_GAME_LABELS[game]}最多 ${WEDDING_GAME_MAX_PARTICIPANTS} 位，目前已有 ${existing.length} 位。`,
        );
      }
      const start =
        existing.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
      await transaction.weddingGameParticipant.createMany({
        data: names.map(({ name, note }, index) => ({
          workspaceId,
          game,
          name,
          note,
          sortOrder: start + index,
        })),
      });
    });
  } catch (error) {
    return failure(error, "目前無法新增名單，請稍後再試。");
  }

  return success(workspaceId, `已加入 ${names.length} 位。`);
}

export async function updateWeddingGameParticipantAction(
  workspaceId: string,
  participantId: string,
  _previousState: WeddingGameMutationState,
  formData: FormData,
): Promise<WeddingGameMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let name: string;
  let note: string | null;
  let version: number;
  try {
    name = normalizeWeddingGameName(formData.get("name"));
    note = normalizeWeddingGameNote(formData.get("note"));
    version = expectedVersion(formData);
  } catch (error) {
    return failure(error, "輸入內容有誤，請重新確認。");
  }

  try {
    await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      const updated = await transaction.weddingGameParticipant.updateMany({
        where: { id: participantId, workspaceId, version },
        data: { name, note, version: { increment: 1 } },
      });
      if (updated.count === 0) throw new GameParticipantStaleError();
    });
  } catch (error) {
    return failure(error, "目前無法更新名單，請稍後再試。");
  }

  return success(workspaceId, "已更新。");
}

export async function deleteWeddingGameParticipantAction(
  workspaceId: string,
  participantId: string,
  _previousState: WeddingGameMutationState,
  formData: FormData,
): Promise<WeddingGameMutationState> {
  const authorization = await authorize(workspaceId);
  if (typeof authorization !== "string") return authorization;

  let version: number;
  try {
    version = expectedVersion(formData);
  } catch (error) {
    return failure(error, "輸入內容有誤，請重新確認。");
  }

  try {
    await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        authorization,
        "edit",
        transaction,
      );
      const deleted = await transaction.weddingGameParticipant.deleteMany({
        where: { id: participantId, workspaceId, version },
      });
      if (deleted.count === 0) throw new GameParticipantStaleError();
    });
  } catch (error) {
    return failure(error, "目前無法移除名單，請稍後再試。");
  }

  return success(workspaceId, "已移除。");
}
