import type { NextAuthOptions } from "next-auth";
import { withBasePath } from "@/lib/base-path";
import { stageGoogleAccountLink } from "@/lib/mobile/account-links";

export function accountLinkAuthOptions(options: NextAuthOptions, nonce: string | undefined): NextAuthOptions {
  if (nonce === undefined) return options;
  return {
    ...options,
    callbacks: {
      ...options.callbacks,
      async signIn({ account, profile }) {
        const complete = withBasePath("/mobile/link/google/complete");
        if (account?.provider !== "google" || !account.providerAccountId ||
            !profile || !("email_verified" in profile) || profile.email_verified !== true ||
            typeof profile.email !== "string" || !profile.email.trim()) return `${complete}?failed=1`;
        try {
          await stageGoogleAccountLink(nonce, account.providerAccountId, profile.email.trim());
          return complete;
        } catch { return `${complete}?failed=1`; }
      },
    },
  };
}
