import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import {
  mobileDeleteTimelineItem,
  mobileUpdateTimelineItem,
  TIMELINE_FIELDS,
  timelineBody,
} from "@/lib/mobile/wedding-timeline";

export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; itemId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, itemId } = await context.params;
    const fields = timelineBody(await readMobileJSON(request), [...TIMELINE_FIELDS, "expectedVersion"]);
    return mobileJSON({ item: await mobileUpdateTimelineItem(workspaceId, user.id, itemId, fields) });
  } catch (error) {
    return mobileError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, itemId } = await context.params;
    const fields = timelineBody(await readMobileJSON(request), ["expectedVersion"]);
    return mobileJSON(await mobileDeleteTimelineItem(workspaceId, user.id, itemId, fields.expectedVersion));
  } catch (error) {
    return mobileError(error);
  }
}
