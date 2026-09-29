import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import {
  MEMBER_REMOVE_FIELDS,
  MEMBER_ROLE_FIELDS,
  membersBody,
  mobileRemoveMember,
  mobileUpdateMemberRole,
} from "@/lib/mobile/members";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; membershipId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, membershipId } = await context.params;
    const fields = membersBody(await readMobileJSON(request), MEMBER_ROLE_FIELDS, "成員格式有誤。");
    return mobileJSON(await mobileUpdateMemberRole(workspaceId, user.id, membershipId, fields));
  } catch (error) {
    return mobileError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ workspaceId: string; membershipId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, membershipId } = await context.params;
    const fields = membersBody(await readMobileJSON(request), MEMBER_REMOVE_FIELDS, "成員格式有誤。");
    return mobileJSON(await mobileRemoveMember(workspaceId, user.id, membershipId, fields));
  } catch (error) {
    return mobileError(error);
  }
}
