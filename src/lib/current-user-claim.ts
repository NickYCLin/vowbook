import "server-only";

import type { PrismaClient, User } from "@prisma/client";
import { normalizeInvitationEmail } from "@/domain/workspace-invitation";
import { prisma } from "@/lib/prisma";
import { runSerializableTransaction } from "@/lib/serializable-transaction";

export type GoogleOAuthIdentity = {
  googleSubject: string;
  emailVerifiedAt?: number;
  email?: string | null;
  name: string | null;
  image: string | null;
};

type ProofFreshnessRow = {
  database_now: Date;
  fresh: boolean;
};

type PendingInvitationRow = {
  pending: boolean;
};

function proofTimestamp(input: unknown): Date | null {
  if (typeof input !== "number" || !Number.isFinite(input)) return null;
  const timestamp = new Date(input);
  return Number.isFinite(timestamp.getTime()) ? timestamp : null;
}

export type CurrentUserIdentityResolution = {
  acceptedInvitationCount: number;
  user: User | null;
};

export async function findCurrentUserByGoogleSubject(
  googleSubject: string,
  client: Pick<PrismaClient, "user"> = prisma,
): Promise<User | null> {
  return client.user.findUnique({ where: { googleSubject } });
}

export async function hasPendingInvitationAfterProof(
  inputEmail: unknown,
  inputVerifiedAt: unknown,
  client: Pick<PrismaClient, "$queryRaw"> = prisma,
): Promise<boolean> {
  const verifiedAt = proofTimestamp(inputVerifiedAt);
  if (!verifiedAt || typeof inputEmail !== "string" || !inputEmail.trim()) {
    return false;
  }

  let email: string;
  try {
    email = normalizeInvitationEmail(inputEmail);
  } catch {
    return false;
  }

  const rows = await client.$queryRaw<PendingInvitationRow[]>`
    SELECT EXISTS (
      SELECT 1
      FROM "workspace_invitations"
      WHERE "email" = ${email}
        AND "status" = 'PENDING'::"WorkspaceInvitationStatus"
        AND "superseded_by_invitation_id" IS NULL
        AND "created_at" > ${verifiedAt}::timestamptz
        AND "expires_at" > CURRENT_TIMESTAMP
    ) AS "pending"
  `;
  if (typeof rows[0]?.pending !== "boolean") {
    throw new Error("Pending invitation check unavailable.");
  }
  return rows[0].pending;
}

export async function resolveCurrentUserIdentityWithClaims(
  identity: GoogleOAuthIdentity,
  client: Pick<PrismaClient, "$transaction"> = prisma,
): Promise<CurrentUserIdentityResolution> {
  const verifiedAt = proofTimestamp(identity.emailVerifiedAt);

  return runSerializableTransaction(async (transaction) => {
    const proofRows = await transaction.$queryRaw<ProofFreshnessRow[]>`
      SELECT
        CURRENT_TIMESTAMP AS "database_now",
        (
          ${verifiedAt}::timestamptz IS NOT NULL
          AND ${verifiedAt}::timestamptz <= CURRENT_TIMESTAMP
          AND ${verifiedAt}::timestamptz >=
            CURRENT_TIMESTAMP - INTERVAL '5 minutes'
        ) AS "fresh"
    `;
    const proof = proofRows[0];
    if (
      !proof ||
      !(proof.database_now instanceof Date) ||
      typeof proof.fresh !== "boolean"
    ) {
      throw new Error("Google verification proof check unavailable.");
    }

    if (!proof.fresh || !verifiedAt || !identity.email) {
      const user = await transaction.user.findUnique({
        where: { googleSubject: identity.googleSubject },
      });
      return { acceptedInvitationCount: 0, user };
    }

    const email = normalizeInvitationEmail(identity.email);
    const user = await transaction.user.upsert({
      where: { googleSubject: identity.googleSubject },
      create: {
        googleSubject: identity.googleSubject,
        email,
        name: identity.name,
        image: identity.image,
      },
      update: {
        email,
        name: identity.name,
        image: identity.image,
      },
    });

    const invitations = await transaction.$queryRaw<
      Array<{
        id: string;
        workspace_id: string;
        role: "PARTNER" | "PLANNER" | "VIEWER";
      }>
    >`
      UPDATE "workspace_invitations"
      SET
        "status" = 'ACCEPTED'::"WorkspaceInvitationStatus",
        "accepted_by_user_id" = ${user.id},
        "accepted_at" = CURRENT_TIMESTAMP,
        "version" = "version" + 1,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "email" = ${email}
        AND "status" = 'PENDING'::"WorkspaceInvitationStatus"
        AND "superseded_by_invitation_id" IS NULL
        AND ${verifiedAt}::timestamptz <= CURRENT_TIMESTAMP
        AND ${verifiedAt}::timestamptz >=
          CURRENT_TIMESTAMP - INTERVAL '5 minutes'
        AND "created_at" <= ${verifiedAt}::timestamptz
        AND "expires_at" > CURRENT_TIMESTAMP
      RETURNING "id", "workspace_id", "role"
    `;

    if (invitations.length > 0) {
      await transaction.membership.createMany({
        data: invitations.map((invitation) => ({
          workspaceId: invitation.workspace_id,
          userId: user.id,
          role: invitation.role,
        })),
        skipDuplicates: true,
      });
    }

    return { acceptedInvitationCount: invitations.length, user };
  }, client);
}

export async function resolveCurrentUserIdentity(
  identity: GoogleOAuthIdentity,
  client: Pick<PrismaClient, "$transaction"> = prisma,
): Promise<User | null> {
  const resolution = await resolveCurrentUserIdentityWithClaims(identity, client);
  return resolution.user;
}
