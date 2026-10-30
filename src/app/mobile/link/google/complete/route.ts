import { cookies } from "next/headers";
import { getBasePath } from "@/lib/base-path";
import { ACCOUNT_LINK_COOKIE, googleLinkCallback } from "@/lib/mobile/account-links";

export async function GET(request: Request) {
  const jar = await cookies();
  const nonce = jar.get(ACCOUNT_LINK_COOKIE)?.value;
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "Content-Type": "text/plain; charset=utf-8" };
  jar.set(ACCOUNT_LINK_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NEXTAUTH_URL?.startsWith("https://") ?? false,
    path: getBasePath() || "/", maxAge: 0 });
  try {
    if (new URL(request.url).searchParams.has("failed")) throw new Error("Verification incomplete");
    return new Response(null, { status: 303, headers: { ...headers, Location: await googleLinkCallback(nonce) } });
  } catch {
    return new Response("Google 連結尚未完成，帳號資料未變更。請關閉視窗並從 App 設定重新開始。", { status: 409, headers });
  }
}
