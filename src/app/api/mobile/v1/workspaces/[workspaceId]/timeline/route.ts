import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { mobileCreateTimelineItem, TIMELINE_FIELDS, timelineBody } from "@/lib/mobile/wedding-timeline";
import { mobileTimeline } from "@/lib/mobile/workspace-data";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    return mobileJSON(await mobileTimeline(workspaceId, user.id));
  } catch (error) {
    return mobileError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    const fields = timelineBody(await readMobileJSON(request), TIMELINE_FIELDS);
    return mobileJSON({ item: await mobileCreateTimelineItem(workspaceId, user.id, fields) }, 201);
  } catch (error) {
    return mobileError(error);
  }
}
