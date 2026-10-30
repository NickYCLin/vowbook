"use server";
import { cookies } from "next/headers";
import { getBasePath } from "@/lib/base-path";
import { ACCOUNT_LINK_COOKIE, validateGoogleLinkStart } from "@/lib/mobile/account-links";

export async function beginGoogleLink(nonce: string) {
  await validateGoogleLinkStart(nonce);
  (await cookies()).set(ACCOUNT_LINK_COOKIE, nonce, {
    httpOnly: true, secure: process.env.NEXTAUTH_URL?.startsWith("https://") ?? false,
    sameSite: "lax", path: getBasePath() || "/", maxAge: 300,
  });
}
