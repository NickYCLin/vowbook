import { requireMobileUser } from "@/lib/mobile/session";
import { mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { guestInvitationError } from "@/lib/guest-invitation-http";
import { resolveGuestCheckInCode } from "@/lib/guest-invitations";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const user = await requireMobileUser(request), { workspaceId } = await context.params;
    return mobileJSON(await resolveGuestCheckInCode(workspaceId, user.id, await readMobileJSON(request)));
  } catch (error) { return guestInvitationError(error); }
}
