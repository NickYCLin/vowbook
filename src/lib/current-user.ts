import "server-only";

import type { User } from "@prisma/client";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import { getSignInPath } from "@/lib/base-path";
import {
  findCurrentUserByGoogleSubject,
  hasPendingInvitationAfterProof,
  resolveCurrentUserIdentity,
} from "@/lib/current-user-claim";

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("必須先使用 Google 帳號登入。");
    this.name = "AuthenticationRequiredError";
  }
}

export async function resolveCurrentUser(
  session: Session | null,
): Promise<User> {
  const googleSubject = session?.user?.googleSubject;

  if (!googleSubject) {
    throw new AuthenticationRequiredError();
  }

  const verifiedAt = session.user?.googleEmailVerifiedAt;
  const claimCompletedAt =
    session.user?.googleInvitationClaimCompletedAt;
  const claimAlreadyCompleted =
    typeof verifiedAt === "number" &&
    Number.isFinite(verifiedAt) &&
    typeof claimCompletedAt === "number" &&
    Number.isFinite(claimCompletedAt) &&
    claimCompletedAt === verifiedAt;

  const currentUser = claimAlreadyCompleted
    ? await findCurrentUserByGoogleSubject(googleSubject)
    : await resolveCurrentUserIdentity({
        googleSubject,
        emailVerifiedAt: verifiedAt,
        email: session.user?.email,
        name: session.user?.name ?? null,
        image: session.user?.image ?? null,
      });
  if (!currentUser) {
    throw new AuthenticationRequiredError();
  }
  return currentUser;
}

export type CurrentUserContext = {
  currentUser: User;
  invitationNotice: Session["invitationNotice"] | null;
  pendingInvitationConfirmation: boolean;
};

export async function requireCurrentUserContext(): Promise<CurrentUserContext> {
  const session = await getServerSession(authOptions);

  try {
    const currentUser = await resolveCurrentUser(session);
    const pendingInvitationConfirmation =
      await hasPendingInvitationAfterProof(
        session?.user?.email,
        session?.user?.googleEmailVerifiedAt,
      );
    return {
      currentUser,
      invitationNotice: session?.invitationNotice ?? null,
      pendingInvitationConfirmation,
    };
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      redirect(getSignInPath("/dashboard"));
    }

    throw error;
  }
}

export async function requireCurrentUser(): Promise<User> {
  const session = await getServerSession(authOptions);

  try {
    return await resolveCurrentUser(session);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      redirect(getSignInPath("/dashboard"));
    }

    throw error;
  }
}
