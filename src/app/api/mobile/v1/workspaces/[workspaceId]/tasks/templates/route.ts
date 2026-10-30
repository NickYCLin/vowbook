import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { applyWeddingTaskTemplate } from "@/lib/wedding-task-templates";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    return mobileJSON(await applyWeddingTaskTemplate(workspaceId, user.id, await readMobileJSON(request)));
  } catch (error) { return mobileError(error); }
}
