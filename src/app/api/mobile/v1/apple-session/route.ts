import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { signInWithApple } from "@/lib/mobile/apple-sign-in";

export const runtime = "nodejs";

/** App 內 Sign in with Apple：驗過 Apple 的 identity token 才發 App 登入憑證。 */
export async function POST(request: Request) {
  try {
    return mobileJSON(await signInWithApple(await readMobileJSON(request)));
  } catch (error) {
    return mobileError(error);
  }
}
