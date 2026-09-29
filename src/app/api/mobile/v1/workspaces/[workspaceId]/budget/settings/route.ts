import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import {
  bodyWithin,
  CEREMONY_FIELDS,
  MEAL_PRICING_FIELDS,
  mobileUpdateCeremonyPreferences,
  mobileUpdateMealPricing,
} from "@/lib/mobile/budget-settings";

export const runtime = "nodejs";

/**
 * 花費頁的兩組設定共用一支端點：帶中式儀式欄位就是改儀式，
 * 帶餐費欄位就是改單價。workspaceId 與身分只認路徑與已驗證的使用者。
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    const body = await readMobileJSON(request);
    if (body && typeof body === "object" && !Array.isArray(body) && "expectedVersion" in body) {
      const fields = bodyWithin(body, CEREMONY_FIELDS, "中式儀式設定格式有誤。");
      return mobileJSON({ ceremony: await mobileUpdateCeremonyPreferences(workspaceId, user.id, fields) });
    }
    if (body && typeof body === "object" && !Array.isArray(body) &&
        MEAL_PRICING_FIELDS.some((field) => field in body)) {
      const fields = bodyWithin(body, MEAL_PRICING_FIELDS, "餐費設定格式有誤。");
      return mobileJSON({ mealPricing: await mobileUpdateMealPricing(workspaceId, user.id, fields) });
    }
    throw new MobileRequestError(400, "INVALID_REQUEST", "沒有指定要改哪一組設定。");
  } catch (error) {
    return mobileError(error);
  }
}
