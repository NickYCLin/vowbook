import NextAuth from "next-auth";
import { authOptions } from "@/auth";
import { createTimedAuthHandler } from "@/lib/auth-route-timing";
import { cookies } from "next/headers";
import { accountLinkAuthOptions } from "@/lib/account-link-auth";
import { ACCOUNT_LINK_COOKIE } from "@/lib/mobile/account-links";

const handler = createTimedAuthHandler(async (request, context) => {
  const nonce = (await cookies()).get(ACCOUNT_LINK_COOKIE)?.value;
  return NextAuth(accountLinkAuthOptions(authOptions, nonce))(request, context);
});

export { handler as GET, handler as POST };
