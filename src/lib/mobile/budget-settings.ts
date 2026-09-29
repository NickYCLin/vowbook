import "server-only";

import {
  normalizeWeddingMealPricing,
  WeddingMealPricingError,
} from "@/domain/budget-derived-cost";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { MobileRequestError } from "@/lib/mobile/protocol";
import {
  runSerializableTransaction,
  SerializationConflictError,
} from "@/lib/serializable-transaction";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

export const MEAL_PRICING_FIELDS = [
  "staffMealUnitPrice",
  "vegetarianMealUnitPrice",
  "serviceChargePercent",
];
export const CEREMONY_FIELDS = [
  "hasEngagementCeremony",
  "hasProcessionCeremony",
  "expectedVersion",
];

type PricingClient = {
  weddingWorkspace: { updateMany(args: unknown): Promise<{ count: number }> };
};

function failure(error: unknown): never {
  if (error instanceof MobileRequestError) throw error;
  if (error instanceof WeddingMealPricingError) {
    throw new MobileRequestError(400, "VALIDATION", error.message);
  }
  if (error instanceof WorkspaceAccessDeniedError) {
    throw new MobileRequestError(403, "FORBIDDEN", "沒有這場婚宴的編輯權限。");
  }
  if (error instanceof SerializationConflictError) {
    throw new MobileRequestError(409, "CONFLICT", "剛剛有人同時調整設定，請重新整理後再試。");
  }
  throw new MobileRequestError(503, "UNAVAILABLE", "目前無法完成操作，請稍後再試。");
}

export function bodyWithin(body: unknown, allowed: string[], message: string): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new MobileRequestError(400, "INVALID_REQUEST", message);
  }
  return body as Record<string, unknown>;
}

/** App 送數字，網站送表單字串；都換成字串再交給同一份 domain 規則檢查。 */
function asFormText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value;
  throw new WeddingMealPricingError("餐費設定無效，請確認後再試。");
}

export async function mobileUpdateMealPricing(
  workspaceId: string,
  userId: string,
  fields: Record<string, unknown>,
) {
  try {
    const pricing = normalizeWeddingMealPricing({
      staffMealUnitPrice: asFormText(fields.staffMealUnitPrice),
      vegetarianMealUnitPrice: asFormText(fields.vegetarianMealUnitPrice),
      serviceChargePercent: asFormText(fields.serviceChargePercent),
    });
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as PricingClient;
      const result = await client.weddingWorkspace.updateMany({
        where: { id: workspaceId },
        data: pricing,
      });
      if (result.count !== 1) {
        throw new MobileRequestError(404, "NOT_FOUND", "找不到這場婚宴。");
      }
      return pricing;
    });
  } catch (error) {
    return failure(error);
  }
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new MobileRequestError(400, "VALIDATION", "中式儀式設定無效，請重新整理後再試。");
  }
  return value;
}

function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= 2_147_483_647) {
    throw new MobileRequestError(400, "VALIDATION", "中式儀式設定無效，請重新整理後再試。");
  }
  return value;
}

/** 有沒有辦文定、迎娶會決定花費頁列出哪些分類，改動要跟網站用同一個版本欄位。 */
export async function mobileUpdateCeremonyPreferences(
  workspaceId: string,
  userId: string,
  fields: Record<string, unknown>,
) {
  try {
    const hasEngagementCeremony = boolean(fields.hasEngagementCeremony);
    const hasProcessionCeremony = boolean(fields.hasProcessionCeremony);
    const expectedVersion = version(fields.expectedVersion);
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as PricingClient;
      const result = await client.weddingWorkspace.updateMany({
        where: { id: workspaceId, ceremonyPreferencesVersion: expectedVersion },
        data: {
          hasEngagementCeremony,
          hasProcessionCeremony,
          ceremonyPreferencesVersion: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new MobileRequestError(409, "STALE", "中式儀式設定已被更新，請重新整理後再試。");
      }
      return { hasEngagementCeremony, hasProcessionCeremony, version: expectedVersion + 1 };
    });
  } catch (error) {
    return failure(error);
  }
}
