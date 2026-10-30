import { guestInvitationError, manageGuestInvitations } from "@/lib/guest-invitation-http";
import { requireMobileUser } from "@/lib/mobile/session";
export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const user = await requireMobileUser(request);
    return await manageGuestInvitations(request, (await context.params).workspaceId, user.id);
  } catch (error) { return guestInvitationError(error); }
}
export { handle as GET, handle as POST };
