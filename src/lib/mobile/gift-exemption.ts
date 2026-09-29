import "server-only";

import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { MobileRequestError } from "@/lib/mobile/protocol";
import {
  runSerializableTransaction,
  SerializationConflictError,
} from "@/lib/serializable-transaction";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

export const GIFT_EXEMPTION_FIELDS = ["giftExemptWithCake", "expectedVersion"];

type ExemptionClient = {
  guest: { updateMany(args: unknown): Promise<{ count: number }> };
};

function normalizeVersion(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value >= 2_147_483_647
  ) {
    throw new MobileRequestError(400, "VALIDATION", "請重新整理後再試。");
  }
  return value;
}

/**
 * 不收禮金、改送喜餅的標記。收禮桌當下才發現某位親友不收的情況很常見，
 * 所以手機上要能直接改，改完那位就不會再出現在禮金簿。
 */
export async function mobileSetGiftExemption(
  workspaceId: string,
  userId: string,
  guestId: string,
  fields: Record<string, unknown>,
) {
  try {
    const giftExemptWithCake = fields.giftExemptWithCake;
    if (typeof giftExemptWithCake !== "boolean") {
      throw new MobileRequestError(400, "VALIDATION", "請重新確認不收禮金、會送餅的標記。");
    }
    const expectedVersion = normalizeVersion(fields.expectedVersion);
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as ExemptionClient;
      const result = await client.guest.updateMany({
        where: { id: guestId, workspaceId, version: expectedVersion },
        data: { giftExemptWithCake, version: { increment: 1 } },
      });
      if (result.count !== 1) {
        throw new MobileRequestError(409, "STALE", "這位賓客剛剛被其他人改過，請重新整理後再試。");
      }
      return { id: guestId, giftExemptWithCake, version: expectedVersion + 1 };
    });
  } catch (error) {
    if (error instanceof MobileRequestError) throw error;
    if (error instanceof WorkspaceAccessDeniedError) {
      throw new MobileRequestError(403, "FORBIDDEN", "沒有這場婚宴的編輯權限。");
    }
    if (error instanceof SerializationConflictError) {
      throw new MobileRequestError(409, "CONFLICT", "剛剛有人同時在改，請重新整理後再試。");
    }
    throw new MobileRequestError(503, "UNAVAILABLE", "目前無法完成操作，請稍後再試。");
  }
}
