import { guestInvitationError, uploadGuestVenueMap } from "@/lib/guest-invitation-http";
import { requireMobileUser } from "@/lib/mobile/session";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const user = await requireMobileUser(request), { workspaceId } = await context.params;
    await requireWorkspaceAccess(workspaceId, user.id, "edit");
    return await uploadGuestVenueMap(request, workspaceId, user.id);
  } catch (error) { return guestInvitationError(error); }
}
export { handle as POST, handle as DELETE };
