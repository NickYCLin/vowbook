import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { mobileAddBudgetPayment } from "@/lib/mobile/budget-items";

export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; budgetItemId: string }> };

/** 記一筆尾款付款；workspace、項目與記錄人只看路徑和已驗證的使用者。 */
export async function POST(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, budgetItemId } = await context.params;
    const item = await mobileAddBudgetPayment(
      workspaceId,
      user.id,
      budgetItemId,
      await readMobileJSON(request),
    );
    return mobileJSON({ item }, 201);
  } catch (error) {
    return mobileError(error);
  }
}
