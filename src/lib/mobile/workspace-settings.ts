import "server-only";

import type { WeddingWorkspace } from "@prisma/client";
import {
  normalizeWorkspaceDetails,
  normalizeWorkspaceUpdatedAt,
  WorkspaceAccessDeniedError,
  WorkspaceValidationError,
} from "@/domain/workspace";
import { MobileRequestError } from "@/lib/mobile/protocol";
import {
  runSerializableTransaction,
  SerializationConflictError,
} from "@/lib/serializable-transaction";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

export const SETTINGS_FIELDS = ["name", "weddingDate", "expectedUpdatedAt"];

function failure(error: unknown): never {
  if (error instanceof MobileRequestError) throw error;
  if (error instanceof WorkspaceValidationError) {
    throw new MobileRequestError(400, "VALIDATION", error.message);
  }
  if (error instanceof WorkspaceAccessDeniedError) {
    throw new MobileRequestError(403, "FORBIDDEN", "婚宴名稱與日期只有擁有者能改。");
  }
  if (error instanceof SerializationConflictError) {
    throw new MobileRequestError(409, "CONFLICT", "剛剛有人同時操作，請重新整理後再試。");
  }
  throw new MobileRequestError(503, "UNAVAILABLE", "目前無法完成操作，請稍後再試。");
}

export function settingsBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !SETTINGS_FIELDS.includes(key))) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "婚宴設定輸入格式有誤。");
  }
  return body as Record<string, unknown>;
}

/** 婚宴基本資料。expectedUpdatedAt 就是寫回時要帶的版本依據。 */
export async function mobileWorkspaceSettings(workspaceId: string, userId: string) {
  const access = await requireWorkspaceAccess<WeddingWorkspace>(workspaceId, userId, "read");
  const { workspace, role } = access;
  return {
    role,
    canEdit: role === "OWNER",
    name: workspace.name,
    weddingDate: workspace.weddingDate ? workspace.weddingDate.toISOString().slice(0, 10) : null,
    timezone: workspace.timezone,
    expectedUpdatedAt: workspace.updatedAt.toISOString(),
  };
}

export async function mobileUpdateWorkspaceSettings(workspaceId: string, userId: string, fields: Record<string, unknown>) {
  try {
    const details = normalizeWorkspaceDetails({
      name: fields.name,
      weddingDate: fields.weddingDate ?? null,
      timezone: "Asia/Taipei",
    });
    const expectedUpdatedAt = normalizeWorkspaceUpdatedAt(fields.expectedUpdatedAt);
    return await runSerializableTransaction(async (transaction) => {
      // 改名與改日期是擁有者的事，和網站同一條線。
      await requireLockedWorkspaceAccess(workspaceId, userId, "manageMembers", transaction);
      const client = transaction as unknown as {
        weddingWorkspace: {
          updateMany(args: unknown): Promise<{ count: number }>;
          findFirst(args: unknown): Promise<{ updatedAt: Date } | null>;
        };
      };
      const result = await client.weddingWorkspace.updateMany({
        where: { id: workspaceId, updatedAt: expectedUpdatedAt },
        data: details,
      });
      if (result.count !== 1) {
        throw new MobileRequestError(409, "STALE", "婚宴資料剛剛被更新過，請重新整理後再改。");
      }
      const refreshed = await client.weddingWorkspace.findFirst({
        where: { id: workspaceId },
        select: { updatedAt: true },
      });
      return {
        name: details.name,
        weddingDate: details.weddingDate ? details.weddingDate.toISOString().slice(0, 10) : null,
        expectedUpdatedAt: (refreshed?.updatedAt ?? new Date()).toISOString(),
      };
    });
  } catch (error) {
    return failure(error);
  }
}
