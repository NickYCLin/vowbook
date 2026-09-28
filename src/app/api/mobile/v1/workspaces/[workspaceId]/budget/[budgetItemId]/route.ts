import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import {
  BUDGET_DETAIL_FIELDS,
  budgetBody,
  mobileDeleteBudgetItem,
  mobileSetBudgetBookingStatus,
  mobileSetBudgetPreparationStatus,
  mobileUpdateBudgetItem,
} from "@/lib/mobile/budget-items";

export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; budgetItemId: string }> };

/**
 * 三種修改分開送：付款狀態、準備方式、內容。一次只改一種，
 * 金額、實付與付款時間一律由伺服器算，不收 client 帶來的值。
 */
export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, budgetItemId } = await context.params;
    const body = await readMobileJSON(request);
    const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
    if (keys.includes("bookingStatus")) {
      const fields = budgetBody(body, ["bookingStatus", "expectedVersion"]);
      const item = await mobileSetBudgetBookingStatus(workspaceId, user.id, budgetItemId, fields.bookingStatus, fields.expectedVersion);
      return mobileJSON({ item });
    }
    if (keys.includes("preparationStatus")) {
      const fields = budgetBody(body, ["preparationStatus", "expectedVersion"]);
      const item = await mobileSetBudgetPreparationStatus(workspaceId, user.id, budgetItemId, fields.preparationStatus, fields.expectedVersion);
      return mobileJSON({ item });
    }
    if (keys.includes("name")) {
      const fields = budgetBody(body, [...BUDGET_DETAIL_FIELDS, "expectedVersion"]);
      return mobileJSON({ item: await mobileUpdateBudgetItem(workspaceId, user.id, budgetItemId, fields) });
    }
    throw new MobileRequestError(400, "INVALID_REQUEST", "花費輸入格式有誤。");
  } catch (error) {
    return mobileError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, budgetItemId } = await context.params;
    const fields = budgetBody(await readMobileJSON(request), ["expectedVersion"]);
    return mobileJSON(await mobileDeleteBudgetItem(workspaceId, user.id, budgetItemId, fields.expectedVersion));
  } catch (error) {
    return mobileError(error);
  }
}
