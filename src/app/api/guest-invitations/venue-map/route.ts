import { guestInvitationError, guestInvitationToken } from "@/lib/guest-invitation-http";
import { readGuestVenueMap } from "@/lib/guest-invitations";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { return new Response(new Uint8Array(await readGuestVenueMap(guestInvitationToken(request))), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" },
  }); } catch (error) { return guestInvitationError(error); }
}
