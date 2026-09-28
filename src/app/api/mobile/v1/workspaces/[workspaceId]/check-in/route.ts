import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON } from "@/lib/mobile/http";
import { mobileCheckInBoard } from "@/lib/mobile/check-in";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    return mobileJSON(await mobileCheckInBoard(workspaceId, user.id));
  } catch (error) {
    return mobileError(error);
  }
}
