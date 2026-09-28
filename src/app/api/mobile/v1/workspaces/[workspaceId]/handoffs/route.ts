import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import {
  HANDOFF_FIELDS,
  handoffBody,
  mobileCreateHandoff,
  mobileHandoffs,
} from "@/lib/mobile/coordinator-handoffs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    return mobileJSON(await mobileHandoffs(workspaceId, user.id));
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
    const fields = handoffBody(await readMobileJSON(request), HANDOFF_FIELDS);
    return mobileJSON({ handoff: await mobileCreateHandoff(workspaceId, user.id, fields) }, 201);
  } catch (error) {
    return mobileError(error);
  }
}
