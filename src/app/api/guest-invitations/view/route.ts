import { guestInvitationError, guestInvitationToken } from "@/lib/guest-invitation-http";
import { readGuestInvitation } from "@/lib/guest-invitations";
import { mobileJSON } from "@/lib/mobile/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { return mobileJSON(await readGuestInvitation(guestInvitationToken(request))); }
  catch (error) { return guestInvitationError(error); }
}
