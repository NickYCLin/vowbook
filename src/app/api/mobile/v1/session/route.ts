import { revokeMobileSession } from "@/lib/mobile/session";
import { mobileError, mobileJSON } from "@/lib/mobile/http";
export const runtime = "nodejs";
export async function DELETE(request: Request) {
  try { await revokeMobileSession(request); return mobileJSON({ signedOut: true }); }
  catch (error) { return mobileError(error); }
}
