import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { budgetBody, mobileDeleteBudgetPayment } from "@/lib/mobile/budget-items";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ workspaceId: string; budgetItemId: string; paymentId: string }>;
};

export async function DELETE(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, budgetItemId, paymentId } = await context.params;
    const fields = budgetBody(await readMobileJSON(request), ["expectedVersion"]);
    const item = await mobileDeleteBudgetPayment(
      workspaceId,
      user.id,
      budgetItemId,
      paymentId,
      fields.expectedVersion,
    );
    return mobileJSON({ item });
  } catch (error) {
    return mobileError(error);
  }
}
