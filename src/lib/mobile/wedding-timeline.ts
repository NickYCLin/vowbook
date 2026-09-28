import "server-only";

import {
  normalizeWeddingTimelineDetails,
  WeddingTimelineValidationError,
} from "@/domain/wedding-timeline";
import {
  normalizeWeddingSpeechContent,
  parseWeddingSpeech,
  WeddingSpeechValidationError,
} from "@/domain/wedding-speech";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { MobileRequestError } from "@/lib/mobile/protocol";
import {
  runSerializableTransaction,
  SerializationConflictError,
} from "@/lib/serializable-transaction";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

const STALE_MESSAGE = "流程已被其他人更新，請重新整理後再試。";

function failure(error: unknown): never {
  if (error instanceof MobileRequestError) throw error;
  if (error instanceof WeddingTimelineValidationError || error instanceof WeddingSpeechValidationError) {
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

function details(fields: Record<string, unknown>) {
  return normalizeWeddingTimelineDetails({
    startTime: fields.startTime,
    endTime: fields.endTime ?? "",
    phase: fields.phase,
    title: fields.title,
    location: fields.location ?? "",
    details: fields.details ?? "",
    mediaCue: fields.mediaCue ?? "",
    notes: fields.notes ?? "",
  });
}

export const TIMELINE_FIELDS = ["startTime", "endTime", "phase", "title", "location", "details", "mediaCue", "notes"];

export function timelineBody(body: unknown, allowed: string[]): Record<string, unknown> {
  // workspaceId、itemId 與身分只看路徑和已驗證的使用者；工作人員指派不從手機收。
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "流程輸入格式有誤。");
  }
  return body as Record<string, unknown>;
}

type TimelineTransaction = {
  weddingTimelineItem: {
    create(args: unknown): Promise<{ id: string; version: number }>;
    updateMany(args: unknown): Promise<{ count: number }>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  weddingSpeech: {
    create(args: unknown): Promise<{ version: number }>;
    updateMany(args: unknown): Promise<{ count: number }>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
};

/** 手機新增流程不指派工作人員；要排人到網站做，跟桌次一樣。 */
export async function mobileCreateTimelineItem(
  workspaceId: string,
  userId: string,
  fields: Record<string, unknown>,
) {
  try {
    const input = details(fields);
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as TimelineTransaction;
      const item = await client.weddingTimelineItem.create({
        data: { workspaceId, ...input },
        select: { id: true, version: true },
      });
      return { id: item.id, title: input.title, version: item.version };
    });
  } catch (error) {
    return failure(error);
  }
}

/** 只改文字與時間，已指派的工作人員保持原樣。 */
export async function mobileUpdateTimelineItem(
  workspaceId: string,
  userId: string,
  itemId: string,
  fields: Record<string, unknown>,
) {
  try {
    const input = details(fields);
    const version = versionOf(fields.expectedVersion);
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as TimelineTransaction;
      const updated = await client.weddingTimelineItem.updateMany({
        where: { id: itemId, workspaceId, version },
        data: { ...input, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new MobileRequestError(409, "STALE", STALE_MESSAGE);
      return { id: itemId, title: input.title, version: version + 1 };
    });
  } catch (error) {
    return failure(error);
  }
}

export async function mobileDeleteTimelineItem(
  workspaceId: string,
  userId: string,
  itemId: string,
  expectedVersion: unknown,
) {
  try {
    const version = versionOf(expectedVersion);
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as TimelineTransaction;
      const deleted = await client.weddingTimelineItem.deleteMany({
        where: { id: itemId, workspaceId, version },
      });
      if (deleted.count !== 1) throw new MobileRequestError(409, "STALE", STALE_MESSAGE);
      return { removed: true };
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2003") {
      throw new MobileRequestError(409, "IN_USE", "這段流程還掛著總召交辦，請先到網站解除，再刪除。");
    }
    return failure(error);
  }
}

/**
 * 謝親恩稿子：expectedVersion 為 null 代表手機上還沒有稿子；
 * 內容清空等於刪掉，和網站同一套規則。
 */
export async function mobileSaveWeddingSpeech(
  workspaceId: string,
  userId: string,
  kindInput: unknown,
  contentInput: unknown,
  expectedVersion: unknown,
) {
  try {
    const kind = parseWeddingSpeech(kindInput);
    if (typeof contentInput !== "string") {
      throw new MobileRequestError(400, "INVALID_REQUEST", "致詞稿格式有誤。");
    }
    const content = normalizeWeddingSpeechContent(contentInput);
    const version = expectedVersion === null ? null : versionOf(expectedVersion);
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as TimelineTransaction;
      if (version === null) {
        if (content === null) return { kind, content: null, version: null };
        const created = await client.weddingSpeech.create({
          data: { workspaceId, kind, content },
          select: { version: true },
        });
        return { kind, content, version: created.version };
      }
      const where = { workspaceId, kind, version };
      const result = content === null
        ? await client.weddingSpeech.deleteMany({ where })
        : await client.weddingSpeech.updateMany({ where, data: { content, version: { increment: 1 } } });
      if (result.count !== 1) {
        throw new MobileRequestError(409, "STALE", "稿子已被其他人更新，請先複製你的內容，重新整理後再改。");
      }
      return { kind, content, version: content === null ? null : version + 1 };
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      throw new MobileRequestError(409, "STALE", "稿子已被其他人更新，請先複製你的內容，重新整理後再改。");
    }
    return failure(error);
  }
}
