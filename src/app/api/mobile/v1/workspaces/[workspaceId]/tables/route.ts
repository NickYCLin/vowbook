import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON } from "@/lib/mobile/http";
import { mobileSeatingPlan } from "@/lib/mobile/workspace-data";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    return mobileJSON(await mobileSeatingPlan(workspaceId, user.id));
  } catch (error) {
    return mobileError(error);
  }
}
