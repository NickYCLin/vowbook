import "server-only";

import { randomUUID } from "node:crypto";
import type {
  MembershipRole,
  Prisma,
  PrismaClient,
  WeddingWorkspace,
  WorkspaceInvitationStatus,
} from "@prisma/client";
import {
  INVITABLE_WORKSPACE_ROLES,
  normalizeInvitationEmail,
  normalizeInvitationOperationKey,
  normalizeInvitationRole,
  normalizeInvitationVersion,
  type InvitableWorkspaceRole,
  WorkspaceInvitationValidationError,
} from "@/domain/workspace-invitation";
import {
  isWorkspaceRole,
  type WorkspaceRole,
  WorkspaceAccessDeniedError,
} from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { runSerializableTransaction } from "@/lib/serializable-transaction";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

export type WorkspaceMemberItem = {
  role: WorkspaceRole;
  displayName: string;
  email?: string;
  management?: {
    membershipId: string;
    updatedAt: string;
  };
};

export type PendingWorkspaceInvitationItem = {
  id: string;
  email: string;
  role: InvitableWorkspaceRole;
  version: number;
  createdAt: string;
  expiresAt: string;
};

export type RenewableWorkspaceInvitationItem =
  PendingWorkspaceInvitationItem & {
    reason: "EXPIRED" | "REVOKED";
  };

export type WorkspaceMembersData = {
  role: WorkspaceRole;
  workspace: Pick<WeddingWorkspace, "id" | "name">;
  members: WorkspaceMemberItem[];
  pendingInvitations?: PendingWorkspaceInvitationItem[];
  renewableInvitations?: RenewableWorkspaceInvitationItem[];
};

type MemberRow = {
  id?: string;
  role: string;
  updatedAt?: Date;
  user: {
    name: string | null;
    email?: string;
  };
};

type InvitationRow = {
  id: string;
  email: string;
  role: MembershipRole;
  status: WorkspaceInvitationStatus;
  version: number;
  createdAt: Date;
  expiresAt: Date;
  active: boolean;
};

type WorkspaceMembersClient = {
  membership: {
    findMany(args: unknown): Promise<MemberRow[]>;
  };
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

export class WorkspaceMembersDataError extends Error {
  constructor() {
    super("目前無法載入協作者，請稍後再試。");
    this.name = "WorkspaceMembersDataError";
  }
}

export class WorkspaceMemberValidationError extends Error {
  constructor(message = "成員資料無效，請重新整理後再試。") {
    super(message);
    this.name = "WorkspaceMemberValidationError";
  }
}

type LockedOwnerMembershipRow = {
  id: string;
  role: string;
};

type LockedTargetMembershipRow = {
  id: string;
  role: string;
  userId: string;
  updatedAt: Date;
};

type WorkspaceMemberMutationClient = Pick<
  Prisma.TransactionClient,
  "$queryRaw"
>;

function normalizeTargetMembershipId(input: unknown): string {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.length > 191 ||
    input.trim() !== input
  ) {
    throw new WorkspaceMemberValidationError();
  }
  return input;
}

function normalizeExpectedMemberUpdatedAt(input: unknown): Date {
  if (input instanceof Date) {
    if (!Number.isFinite(input.getTime())) {
      throw new WorkspaceMemberValidationError();
    }
    return new Date(input.getTime());
  }

  if (typeof input !== "string") {
    throw new WorkspaceMemberValidationError();
  }
  const updatedAt = new Date(input);
  if (
    !Number.isFinite(updatedAt.getTime()) ||
    updatedAt.toISOString() !== input
  ) {
    throw new WorkspaceMemberValidationError();
  }
  return updatedAt;
}

function normalizeWorkspaceMemberRole(input: unknown): InvitableWorkspaceRole {
  if (
    typeof input !== "string" ||
    !(INVITABLE_WORKSPACE_ROLES as readonly string[]).includes(input)
  ) {
    throw new WorkspaceMemberValidationError(
      "請選擇伴侶、婚顧或檢視者角色。",
    );
  }
  return input as InvitableWorkspaceRole;
}

async function lockAuthoritativeOwnerMembership(
  transaction: WorkspaceMemberMutationClient,
  workspaceId: string,
  currentUserId: string,
): Promise<void> {
  const rows = await transaction.$queryRaw<LockedOwnerMembershipRow[]>`
    SELECT "id", "role"::text AS "role"
    FROM "memberships"
    WHERE "workspace_id" = ${workspaceId}
      AND "user_id" = ${currentUserId}
      AND "role" = 'OWNER'::"MembershipRole"
    FOR SHARE
  `;

  if (rows.length !== 1 || rows[0]?.role !== "OWNER") {
    throw new WorkspaceAccessDeniedError();
  }
}

async function lockMutableTargetMembership(
  transaction: WorkspaceMemberMutationClient,
  input: {
    workspaceId: string;
    currentUserId: string;
    targetMembershipId: string;
    expectedUpdatedAt: Date;
  },
): Promise<LockedTargetMembershipRow | null> {
  const rows = await transaction.$queryRaw<LockedTargetMembershipRow[]>`
    SELECT
      "id",
      "role"::text AS "role",
      "user_id" AS "userId",
      "updated_at" AS "updatedAt"
    FROM "memberships"
    WHERE "workspace_id" = ${input.workspaceId}
      AND "id" = ${input.targetMembershipId}
      AND "updated_at" = ${input.expectedUpdatedAt}
    FOR UPDATE
  `;
  const target = rows[0];
  if (
    rows.length !== 1 ||
    !target ||
    target.role === "OWNER" ||
    target.userId === input.currentUserId
  ) {
    return null;
  }
  return target;
}

function displayName(name: string | null): string {
  const normalized = name?.trim();
  return normalized || "未設定顯示名稱";
}

function invitationItem(
  invitation: InvitationRow,
): PendingWorkspaceInvitationItem {
  return {
    id: invitation.id,
    email: invitation.email,
    role: normalizeInvitationRole(invitation.role),
    version: invitation.version,
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

export async function getWorkspaceMembersData(
  workspaceId: string,
  client: WorkspaceMembersClient = prisma as unknown as WorkspaceMembersClient,
): Promise<WorkspaceMembersData> {
  const currentUser = await requireCurrentUser();

  let access;
  try {
    access = await requireWorkspaceAccess<
      Pick<WeddingWorkspace, "id" | "name">
    >(workspaceId, currentUser.id, "read");
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      throw error;
    }
    throw new WorkspaceMembersDataError();
  }

  try {
    if (access.role === "OWNER") {
      const [memberRows, invitationRows] = await Promise.all([
        client.membership.findMany({
          where: { workspaceId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            role: true,
            updatedAt: true,
            user: { select: { name: true, email: true } },
          },
        }),
        client.$queryRaw<InvitationRow[]>`
          SELECT
            "id",
            "email",
            "role",
            "status",
            "version",
            "created_at" AS "createdAt",
            "expires_at" AS "expiresAt",
            ("expires_at" > CURRENT_TIMESTAMP) AS "active"
          FROM "workspace_invitations"
          WHERE "workspace_id" = ${workspaceId}
            AND "superseded_by_invitation_id" IS NULL
            AND "status" IN (
              'PENDING'::"WorkspaceInvitationStatus",
              'REVOKED'::"WorkspaceInvitationStatus",
              'EXPIRED'::"WorkspaceInvitationStatus"
            )
          ORDER BY "created_at" ASC, "id" ASC
        `,
      ]);

      const pendingInvitations: PendingWorkspaceInvitationItem[] = [];
      const renewableInvitations: RenewableWorkspaceInvitationItem[] = [];
      for (const invitation of invitationRows) {
        const item = invitationItem(invitation);
        if (
          invitation.status === "PENDING" && invitation.active
        ) {
          pendingInvitations.push(item);
        } else {
          renewableInvitations.push({
            ...item,
            reason:
              invitation.status === "REVOKED" ? "REVOKED" : "EXPIRED",
          });
        }
      }

      return {
        role: access.role,
        workspace: {
          id: access.workspace.id,
          name: access.workspace.name,
        },
        members: memberRows.map((member) => {
          if (
            !isWorkspaceRole(member.role) ||
            typeof member.id !== "string" ||
            !member.id ||
            !(member.updatedAt instanceof Date) ||
            !Number.isFinite(member.updatedAt.getTime())
          ) {
            throw new WorkspaceMembersDataError();
          }
          return {
            role: member.role,
            displayName: displayName(member.user.name),
            email: member.user.email ?? "",
            management: {
              membershipId: member.id,
              updatedAt: member.updatedAt.toISOString(),
            },
          };
        }),
        pendingInvitations,
        renewableInvitations,
      };
    }

    const memberRows = await client.membership.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        role: true,
        user: { select: { name: true } },
      },
    });

    return {
      role: access.role,
      workspace: {
        id: access.workspace.id,
        name: access.workspace.name,
      },
      members: memberRows.map((member) => {
        if (!isWorkspaceRole(member.role)) {
          throw new WorkspaceMembersDataError();
        }
        return {
          role: member.role,
          displayName: displayName(member.user.name),
        };
      }),
    };
  } catch (error) {
    if (error instanceof WorkspaceMembersDataError) {
      throw error;
    }
    throw new WorkspaceMembersDataError();
  }
}

export type UpdateWorkspaceMemberRoleOutcome =
  | { outcome: "UPDATED"; updatedAt: Date }
  | { outcome: "NOT_MUTABLE" };

export async function updateWorkspaceMemberRole(
  input: {
    workspaceId: string;
    currentUserId: string;
    targetMembershipId: unknown;
    expectedUpdatedAt: unknown;
    role: unknown;
  },
  client: Pick<PrismaClient, "$transaction"> = prisma,
): Promise<UpdateWorkspaceMemberRoleOutcome> {
  return runSerializableTransaction(async (transaction) => {
    await lockAuthoritativeOwnerMembership(
      transaction,
      input.workspaceId,
      input.currentUserId,
    );

    const targetMembershipId = normalizeTargetMembershipId(
      input.targetMembershipId,
    );
    const expectedUpdatedAt = normalizeExpectedMemberUpdatedAt(
      input.expectedUpdatedAt,
    );
    const role = normalizeWorkspaceMemberRole(input.role);
    const target = await lockMutableTargetMembership(transaction, {
      workspaceId: input.workspaceId,
      currentUserId: input.currentUserId,
      targetMembershipId,
      expectedUpdatedAt,
    });
    if (!target) return { outcome: "NOT_MUTABLE" };

    const rows = await transaction.$queryRaw<Array<{ updatedAt: Date }>>`
      UPDATE "memberships"
      SET
        "role" = ${role}::"MembershipRole",
        "updated_at" = GREATEST(
          clock_timestamp(),
          "updated_at" + INTERVAL '1 millisecond'
        )
      WHERE "workspace_id" = ${input.workspaceId}
        AND "id" = ${targetMembershipId}
        AND "updated_at" = ${expectedUpdatedAt}
        AND "role" <> 'OWNER'::"MembershipRole"
      RETURNING "updated_at" AS "updatedAt"
    `;
    const updatedAt = rows[0]?.updatedAt;
    if (
      rows.length !== 1 ||
      !(updatedAt instanceof Date) ||
      !Number.isFinite(updatedAt.getTime())
    ) {
      return { outcome: "NOT_MUTABLE" };
    }
    return { outcome: "UPDATED", updatedAt };
  }, client);
}

export async function removeWorkspaceMember(
  input: {
    workspaceId: string;
    currentUserId: string;
    targetMembershipId: unknown;
    expectedUpdatedAt: unknown;
  },
  client: Pick<PrismaClient, "$transaction"> = prisma,
): Promise<{ outcome: "REMOVED" | "NOT_MUTABLE" }> {
  return runSerializableTransaction(async (transaction) => {
    await lockAuthoritativeOwnerMembership(
      transaction,
      input.workspaceId,
      input.currentUserId,
    );

    const targetMembershipId = normalizeTargetMembershipId(
      input.targetMembershipId,
    );
    const expectedUpdatedAt = normalizeExpectedMemberUpdatedAt(
      input.expectedUpdatedAt,
    );
    const target = await lockMutableTargetMembership(transaction, {
      workspaceId: input.workspaceId,
      currentUserId: input.currentUserId,
      targetMembershipId,
      expectedUpdatedAt,
    });
    if (!target) return { outcome: "NOT_MUTABLE" };

    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      DELETE FROM "memberships"
      WHERE "workspace_id" = ${input.workspaceId}
        AND "id" = ${targetMembershipId}
        AND "updated_at" = ${expectedUpdatedAt}
        AND "role" <> 'OWNER'::"MembershipRole"
      RETURNING "id"
    `;
    return {
      outcome: rows.length === 1 ? "REMOVED" : "NOT_MUTABLE",
    };
  }, client);
}

export type CreateWorkspaceInvitationOutcome =
  | { outcome: "CREATED" }
  | { outcome: "REPLAYED" }
  | { outcome: "ALREADY_PENDING" }
  | { outcome: "REINVITE_REQUIRED" };

type ExistingPendingRow = {
  status: WorkspaceInvitationStatus;
  active: boolean;
};

export async function createWorkspaceInvitation(
  input: {
    workspaceId: string;
    currentUserId: string;
    operationKey: unknown;
    email: unknown;
    role: unknown;
  },
  client: Pick<PrismaClient, "$transaction"> = prisma,
): Promise<CreateWorkspaceInvitationOutcome> {
  return runSerializableTransaction(async (transaction) => {
    await requireLockedWorkspaceAccess(
      input.workspaceId,
      input.currentUserId,
      "manageMembers",
      transaction,
    );

    const operationKey = normalizeInvitationOperationKey(input.operationKey);
    const email = normalizeInvitationEmail(input.email);
    const role = normalizeInvitationRole(input.role);

    await transaction.$queryRaw<Array<{ locked: number }>>`
      SELECT 1 AS "locked"
      FROM (
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`${input.workspaceId}\u001f${email}`}, 0)
        )
      ) AS "acquired_lock"
    `;

    const invitationId = randomUUID();
    const inserted = await transaction.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "workspace_invitations" (
        "id",
        "workspace_id",
        "email",
        "role",
        "status",
        "operation_key",
        "invited_by_user_id",
        "expires_at",
        "version",
        "created_at",
        "updated_at"
      )
      VALUES (
        ${invitationId},
        ${input.workspaceId},
        ${email},
        ${role}::"MembershipRole",
        'PENDING'::"WorkspaceInvitationStatus",
        ${operationKey}::uuid,
        ${input.currentUserId},
        CURRENT_TIMESTAMP + INTERVAL '7 days',
        1,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT DO NOTHING
      RETURNING "id"
    `;
    if (inserted.length === 1) {
      return { outcome: "CREATED" };
    }

    const replayed = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "workspace_invitations"
      WHERE "operation_key" = ${operationKey}::uuid
      LIMIT 1
    `;
    if (replayed.length === 1) {
      return { outcome: "REPLAYED" };
    }

    const pending = await transaction.$queryRaw<ExistingPendingRow[]>`
      SELECT
        "status",
        ("expires_at" > CURRENT_TIMESTAMP) AS "active"
      FROM "workspace_invitations"
      WHERE "workspace_id" = ${input.workspaceId}
        AND "email" = ${email}
        AND "status" = 'PENDING'::"WorkspaceInvitationStatus"
        AND "superseded_by_invitation_id" IS NULL
      LIMIT 1
    `;
    if (pending[0]?.active) {
      return { outcome: "ALREADY_PENDING" };
    }
    if (pending[0]?.status === "PENDING") {
      return { outcome: "REINVITE_REQUIRED" };
    }

    throw new Error("Invitation create conflict could not be resolved.");
  }, client);
}

function validateInvitationId(input: unknown): string {
  if (typeof input !== "string" || !input) {
    throw new WorkspaceInvitationValidationError(
      "邀請不存在或已無法操作。",
    );
  }
  return input;
}

export async function revokePendingWorkspaceInvitation(
  input: {
    workspaceId: string;
    currentUserId: string;
    invitationId: unknown;
    version: unknown;
  },
  client: Pick<PrismaClient, "$transaction"> = prisma,
): Promise<{ outcome: "REVOKED" | "NOT_REVOCABLE" }> {
  return runSerializableTransaction(async (transaction) => {
    await requireLockedWorkspaceAccess(
      input.workspaceId,
      input.currentUserId,
      "manageMembers",
      transaction,
    );

    const invitationId = validateInvitationId(input.invitationId);
    const version = normalizeInvitationVersion(input.version);
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      UPDATE "workspace_invitations"
      SET
        "status" = 'REVOKED'::"WorkspaceInvitationStatus",
        "revoked_at" = CURRENT_TIMESTAMP,
        "version" = "version" + 1,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "workspace_id" = ${input.workspaceId}
        AND "id" = ${invitationId}
        AND "status" = 'PENDING'::"WorkspaceInvitationStatus"
        AND "version" = ${version}
        AND "superseded_by_invitation_id" IS NULL
        AND "expires_at" > CURRENT_TIMESTAMP
      RETURNING "id"
    `;

    return {
      outcome: rows.length === 1 ? "REVOKED" : "NOT_REVOCABLE",
    };
  }, client);
}

class InvitationLifecycleConflictError extends Error {}

type ReinviteSourceRow = {
  id: string;
  email: string;
  status: WorkspaceInvitationStatus;
  expired: boolean;
  version: number;
};

export async function reinviteWorkspaceInvitation(
  input: {
    workspaceId: string;
    currentUserId: string;
    invitationId: unknown;
    version: unknown;
    role: unknown;
  },
  client: Pick<PrismaClient, "$transaction"> = prisma,
): Promise<{ outcome: "REINVITED" | "NOT_REINVITABLE" }> {
  try {
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        input.workspaceId,
        input.currentUserId,
        "manageMembers",
        transaction,
      );

      const invitationId = validateInvitationId(input.invitationId);
      const version = normalizeInvitationVersion(input.version);
      const role = normalizeInvitationRole(input.role);
      const sourceRows = await transaction.$queryRaw<ReinviteSourceRow[]>`
        SELECT
          "id",
          "email",
          "status",
          ("expires_at" <= CURRENT_TIMESTAMP) AS "expired",
          "version"
        FROM "workspace_invitations"
        WHERE "workspace_id" = ${input.workspaceId}
          AND "id" = ${invitationId}
          AND "version" = ${version}
          AND "superseded_by_invitation_id" IS NULL
          AND (
            "status" IN (
              'REVOKED'::"WorkspaceInvitationStatus",
              'EXPIRED'::"WorkspaceInvitationStatus"
            )
            OR (
              "status" = 'PENDING'::"WorkspaceInvitationStatus"
              AND "expires_at" <= CURRENT_TIMESTAMP
            )
          )
        FOR UPDATE
      `;
      const source = sourceRows[0];
      if (!source) {
        return { outcome: "NOT_REINVITABLE" };
      }

      await transaction.$queryRaw<Array<{ locked: number }>>`
        SELECT 1 AS "locked"
        FROM (
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`${input.workspaceId}\u001f${source.email}`}, 0)
          )
        ) AS "acquired_lock"
      `;

      let lineageVersion = source.version;
      if (source.status === "PENDING") {
        if (!source.expired) {
          return { outcome: "NOT_REINVITABLE" };
        }
        const expiredRows = await transaction.$queryRaw<
          Array<{ id: string; version: number }>
        >`
          UPDATE "workspace_invitations"
          SET
            "status" = 'EXPIRED'::"WorkspaceInvitationStatus",
            "version" = "version" + 1,
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "workspace_id" = ${input.workspaceId}
            AND "id" = ${source.id}
            AND "status" = 'PENDING'::"WorkspaceInvitationStatus"
            AND "version" = ${source.version}
            AND "superseded_by_invitation_id" IS NULL
            AND "expires_at" <= CURRENT_TIMESTAMP
          RETURNING "id", "version"
        `;
        if (expiredRows.length !== 1) {
          return { outcome: "NOT_REINVITABLE" };
        }
        lineageVersion = expiredRows[0].version;
      }

      const successorId = randomUUID();
      const successorOperationKey = randomUUID();
      const inserted = await transaction.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "workspace_invitations" (
          "id",
          "workspace_id",
          "email",
          "role",
          "status",
          "operation_key",
          "invited_by_user_id",
          "expires_at",
          "version",
          "created_at",
          "updated_at"
        )
        VALUES (
          ${successorId},
          ${input.workspaceId},
          ${source.email},
          ${role}::"MembershipRole",
          'PENDING'::"WorkspaceInvitationStatus",
          ${successorOperationKey}::uuid,
          ${input.currentUserId},
          CURRENT_TIMESTAMP + INTERVAL '7 days',
          1,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT DO NOTHING
        RETURNING "id"
      `;
      if (inserted.length !== 1) {
        return { outcome: "NOT_REINVITABLE" };
      }

      const lineageRows = await transaction.$queryRaw<Array<{ id: string }>>`
        UPDATE "workspace_invitations"
        SET
          "superseded_by_invitation_id" = ${successorId},
          "superseded_at" = CURRENT_TIMESTAMP,
          "version" = "version" + 1,
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "workspace_id" = ${input.workspaceId}
          AND "id" = ${source.id}
          AND "version" = ${lineageVersion}
          AND "superseded_by_invitation_id" IS NULL
          AND "status" IN (
            'REVOKED'::"WorkspaceInvitationStatus",
            'EXPIRED'::"WorkspaceInvitationStatus"
          )
        RETURNING "id"
      `;
      if (lineageRows.length !== 1) {
        throw new InvitationLifecycleConflictError();
      }

      return { outcome: "REINVITED" };
    }, client);
  } catch (error) {
    if (error instanceof InvitationLifecycleConflictError) {
      return { outcome: "NOT_REINVITABLE" };
    }
    throw error;
  }
}
