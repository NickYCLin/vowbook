import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { BUDGET_DETAIL_FIELDS, budgetBody, mobileCreateBudgetItem } from "@/lib/mobile/budget-items";
import { mobileBudget } from "@/lib/mobile/workspace-data";

export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    return mobileJSON(await mobileBudget(workspaceId, user.id));
  } catch (error) {
    return mobileError(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    const fields = budgetBody(await readMobileJSON(request), ["taxonomyItemKey", ...BUDGET_DETAIL_FIELDS]);
    return mobileJSON({ item: await mobileCreateBudgetItem(workspaceId, user.id, fields) }, 201);
  } catch (error) {
    return mobileError(error);
  }
}
