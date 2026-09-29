import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import {
  INVITATION_ACTION_FIELDS,
  membersBody,
  mobileReinviteInvitation,
  mobileRevokeInvitation,
} from "@/lib/mobile/members";

export const runtime = "nodejs";

/** 撤銷或重新邀請共用一支端點，靠 action 分流，版本不符一律回衝突。 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; invitationId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, invitationId } = await context.params;
    const fields = membersBody(
      await readMobileJSON(request),
      INVITATION_ACTION_FIELDS,
      "邀請操作格式有誤。",
    );
    if (fields.action === "revoke") {
      return mobileJSON(await mobileRevokeInvitation(workspaceId, user.id, invitationId, fields));
    }
    if (fields.action === "reinvite") {
      return mobileJSON(await mobileReinviteInvitation(workspaceId, user.id, invitationId, fields));
    }
    throw new MobileRequestError(400, "INVALID_REQUEST", "沒有指定要做哪一種邀請操作。");
  } catch (error) {
    return mobileError(error);
  }
}
