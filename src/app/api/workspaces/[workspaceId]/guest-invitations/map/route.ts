import { guestInvitationError, guestInvitationWebUser, uploadGuestVenueMap } from "@/lib/guest-invitation-http";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const user = await guestInvitationWebUser(request), { workspaceId } = await context.params;
    await requireWorkspaceAccess(workspaceId, user.id, "edit");
    return await uploadGuestVenueMap(request, workspaceId, user.id);
  } catch (error) { return guestInvitationError(error); }
}
export { handle as POST, handle as DELETE };
