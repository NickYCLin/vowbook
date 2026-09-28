import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import {
  HANDOFF_FIELDS,
  handoffBody,
  mobileDeleteHandoff,
  mobileSetHandoffStatus,
  mobileUpdateHandoff,
} from "@/lib/mobile/coordinator-handoffs";

export const runtime = "nodejs";

/** 現場最常用：按一下把狀態往前推。改內容請用 PUT。 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; handoffId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, handoffId } = await context.params;
    const fields = handoffBody(await readMobileJSON(request), ["status", "expectedVersion"]);
    return mobileJSON({
      handoff: await mobileSetHandoffStatus(workspaceId, user.id, handoffId, fields.status, fields.expectedVersion),
    });
  } catch (error) {
    return mobileError(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ workspaceId: string; handoffId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, handoffId } = await context.params;
    const fields = handoffBody(await readMobileJSON(request), [...HANDOFF_FIELDS, "expectedVersion"]);
    return mobileJSON({ handoff: await mobileUpdateHandoff(workspaceId, user.id, handoffId, fields) });
  } catch (error) {
    return mobileError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ workspaceId: string; handoffId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, handoffId } = await context.params;
    const fields = handoffBody(await readMobileJSON(request), ["expectedVersion"]);
    return mobileJSON(await mobileDeleteHandoff(workspaceId, user.id, handoffId, fields.expectedVersion));
  } catch (error) {
    return mobileError(error);
  }
}
