import { exchangeGrant } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { return mobileJSON(await exchangeGrant(await readMobileJSON(request))); }
  catch (error) { return mobileError(error); }
}
