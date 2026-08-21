import { randomUUID } from "node:crypto";
import type { NextAuthOptions, Profile } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getBasePath, withBasePath } from "@/lib/base-path";
import { resolveCurrentUserIdentityWithClaims } from "@/lib/current-user-claim";
import { prisma } from "@/lib/prisma";

function hasVerifiedGoogleEmail(profile: Profile | undefined): boolean {
  return Boolean(
    profile &&
      typeof profile.email === "string" &&
      profile.email.trim() &&
      "email_verified" in profile &&
      profile.email_verified === true,
  );
}

async function getDatabaseVerificationTimestamp(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ databaseNow: Date }>>`
    SELECT CURRENT_TIMESTAMP AS "databaseNow"
  `;
  const databaseNow = rows[0]?.databaseNow;
  if (
    !(databaseNow instanceof Date) ||
    !Number.isFinite(databaseNow.getTime())
  ) {
    throw new Error("Database verification timestamp unavailable.");
  }
  return databaseNow.getTime();
}

function roundedDuration(startedAt: number, completedAt = performance.now()) {
  return Math.round(Math.max(0, completedAt - startedAt) * 10) / 10;
}

function createScopedCookies(): NextAuthOptions["cookies"] {
  const basePath = getBasePath();

  if (!basePath) {
    return undefined;
  }

  const secure = process.env.NEXTAUTH_URL?.startsWith("https://") ?? false;
  const prefix = secure ? "__Secure-" : "";
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: basePath,
    secure,
  };
  const temporaryOptions = { ...options, maxAge: 60 * 15 };

  return {
    sessionToken: {
      name: `${prefix}vowbook.session-token`,
      options,
    },
    callbackUrl: {
      name: `${prefix}vowbook.callback-url`,
      options,
    },
    csrfToken: {
      name: `${prefix}vowbook.csrf-token`,
      options,
    },
    pkceCodeVerifier: {
      name: `${prefix}vowbook.pkce.code_verifier`,
      options: temporaryOptions,
    },
    state: {
      name: `${prefix}vowbook.state`,
      options: temporaryOptions,
    },
    nonce: {
      name: `${prefix}vowbook.nonce`,
      options,
    },
  };
}

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  cookies: createScopedCookies(),
  session: {
    strategy: "jwt",
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  pages: {
    signIn: withBasePath("/signin"),
  },
  callbacks: {
    async signIn({ account, profile }) {
      return Boolean(
        account?.provider === "google" &&
          account.providerAccountId &&
          hasVerifiedGoogleEmail(profile),
      );
    },
    async jwt({ token, account, profile, user, trigger, session }) {
      const issuedNotice = token.invitationNotice;
      if (
        trigger === "update" &&
        session &&
        typeof session === "object" &&
        "dismissedInvitationNoticeId" in session &&
        typeof session.dismissedInvitationNoticeId === "string" &&
        issuedNotice &&
        typeof issuedNotice === "object" &&
        "id" in issuedNotice &&
        session.dismissedInvitationNoticeId === issuedNotice.id
      ) {
        delete token.invitationNotice;
      }

      if (
        account?.provider === "google" &&
        account.providerAccountId &&
        hasVerifiedGoogleEmail(profile)
      ) {
        const startedAt = performance.now();
        let timestampCompletedAt = startedAt;
        try {
          const verifiedAt = await getDatabaseVerificationTimestamp();
          timestampCompletedAt = performance.now();
          const verifiedEmail = profile?.email?.trim();
          const resolution = await resolveCurrentUserIdentityWithClaims({
            googleSubject: account.providerAccountId,
            emailVerifiedAt: verifiedAt,
            email: verifiedEmail,
            name: user?.name ?? null,
            image: user?.image ?? null,
          });
          if (!resolution.user) {
            throw new Error("Verified Google identity could not be persisted.");
          }

          const completedAt = performance.now();
          console.info("auth_signin_timing", {
            claimMs: roundedDuration(timestampCompletedAt, completedAt),
            status: "success",
            timestampMs: roundedDuration(startedAt, timestampCompletedAt),
            totalMs: roundedDuration(startedAt, completedAt),
          });

          token.googleSubject = account.providerAccountId;
          token.googleEmailVerifiedAt = verifiedAt;
          token.googleVerifiedEmail = verifiedEmail;
          token.googleInvitationClaimCompletedAt = verifiedAt;
          if (resolution.acceptedInvitationCount > 0) {
            token.invitationNotice = {
              id: randomUUID(),
              count: resolution.acceptedInvitationCount,
            };
          } else {
            delete token.invitationNotice;
          }
        } catch (error) {
          const completedAt = performance.now();
          console.info("auth_signin_timing", {
            claimMs: roundedDuration(timestampCompletedAt, completedAt),
            status: "error",
            timestampMs: roundedDuration(startedAt, timestampCompletedAt),
            totalMs: roundedDuration(startedAt, completedAt),
          });
          throw error;
        }
      }

      if (
        typeof token.googleSubject === "string" &&
        token.googleInvitationClaimCompletedAt !== token.googleEmailVerifiedAt
      ) {
        delete token.googleSubject;
        delete token.googleEmailVerifiedAt;
        delete token.googleVerifiedEmail;
        delete token.googleInvitationClaimCompletedAt;
        delete token.invitationNotice;
      }

      return token;
    },
    async session({ session, token }) {
      delete session.invitationNotice;
      if (session.user) {
        delete session.user.googleSubject;
        delete session.user.googleEmailVerifiedAt;
        delete session.user.googleInvitationClaimCompletedAt;
      }
      if (session.user && typeof token.googleSubject === "string") {
        session.user.googleSubject = token.googleSubject;
      }
      if (
        session.user &&
        typeof token.googleEmailVerifiedAt === "number" &&
        Number.isFinite(token.googleEmailVerifiedAt) &&
        typeof token.googleVerifiedEmail === "string" &&
        token.googleVerifiedEmail.trim()
      ) {
        session.user.googleEmailVerifiedAt = token.googleEmailVerifiedAt;
        session.user.email = token.googleVerifiedEmail;
      }
      if (
        session.user &&
        typeof token.googleInvitationClaimCompletedAt === "number" &&
        Number.isFinite(token.googleInvitationClaimCompletedAt) &&
        token.googleInvitationClaimCompletedAt ===
          token.googleEmailVerifiedAt
      ) {
        session.user.googleInvitationClaimCompletedAt =
          token.googleInvitationClaimCompletedAt;
      }
      if (
        token.invitationNotice &&
        typeof token.invitationNotice.id === "string" &&
        token.invitationNotice.id &&
        Number.isSafeInteger(token.invitationNotice.count) &&
        token.invitationNotice.count > 0
      ) {
        session.invitationNotice = token.invitationNotice;
      }

      return session;
    },
  },
};
