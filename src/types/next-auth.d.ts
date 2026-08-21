import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    invitationNotice?: {
      id: string;
      count: number;
    };
    user?: DefaultSession["user"] & {
      googleSubject?: string;
      googleEmailVerifiedAt?: number;
      googleInvitationClaimCompletedAt?: number;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    googleSubject?: string;
    googleEmailVerifiedAt?: number;
    googleVerifiedEmail?: string;
    googleInvitationClaimCompletedAt?: number;
    invitationNotice?: {
      id: string;
      count: number;
    };
  }
}
