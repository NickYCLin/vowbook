import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { INVITE_FIELDS, membersBody, mobileInviteMember } from "@/lib/mobile/members";

export const runtime = "nodejs";

/** 建立協作邀請；workspaceId 只認路徑，身分只認已驗證的 token。 */
export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    const fields = membersBody(await readMobileJSON(request), INVITE_FIELDS, "邀請格式有誤。");
    return mobileJSON(await mobileInviteMember(workspaceId, user.id, fields));
  } catch (error) {
    return mobileError(error);
  }
}
