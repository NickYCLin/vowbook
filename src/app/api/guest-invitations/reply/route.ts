import { guestInvitationError, guestInvitationToken } from "@/lib/guest-invitation-http";
import { submitGuestInvitationReply } from "@/lib/guest-invitations";
import { mobileJSON, readMobileJSON } from "@/lib/mobile/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { const token = guestInvitationToken(request); return mobileJSON(await submitGuestInvitationReply(token, await readMobileJSON(request, 16384))); }
  catch (error) { return guestInvitationError(error); }
}
