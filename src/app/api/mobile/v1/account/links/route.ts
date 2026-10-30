import { requireMobileUser, mobileSessionHash } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { confirmAccountLink, inspectAccountLink, prepareAccountLink, stageAppleAccountLink } from "@/lib/mobile/account-links";

export const runtime = "nodejs";

function input(body: unknown, allowed: string[]): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "連結要求格式有誤。");
  }
  return body as Record<string, unknown>;
}

export async function GET(request: Request) {
  try {
    const user = await requireMobileUser(request);
    return mobileJSON({ email: user.email, google: !!user.googleSubject, apple: !!user.appleSubject });
  } catch (error) { return mobileError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireMobileUser(request);
    const body = input(await readMobileJSON(request), ["provider"]);
    if (body.provider !== "GOOGLE" && body.provider !== "APPLE") throw new MobileRequestError(400, "INVALID_REQUEST", "請選擇登入方式。");
    return mobileJSON(await prepareAccountLink(user.id, mobileSessionHash(request), body.provider));
  } catch (error) { return mobileError(error); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireMobileUser(request);
    const body = input(await readMobileJSON(request), ["nonce", "identityToken"]);
    const sessionHash = mobileSessionHash(request);
    if ("identityToken" in body) await stageAppleAccountLink(user.id, sessionHash, body.nonce, body.identityToken);
    return mobileJSON(await inspectAccountLink(user.id, sessionHash, body.nonce));
  } catch (error) { return mobileError(error); }
}

export async function PUT(request: Request) {
  try {
    const user = await requireMobileUser(request);
    const body = input(await readMobileJSON(request), ["nonce"]);
    return mobileJSON(await confirmAccountLink(user.id, mobileSessionHash(request), body.nonce));
  } catch (error) { return mobileError(error); }
}
