import "server-only";

import { Prisma, type MembershipRole } from "@prisma/client";
import {
  assertWorkspacePermission,
  isWorkspaceRole,
  type WorkspacePermission,
  type WorkspaceRole,
  WorkspaceAccessDeniedError,
} from "@/domain/workspace";

type LockedMembershipRow = { role: MembershipRole | string };

type WorkspaceMutationAccessClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function requireLockedWorkspaceAccess(
  workspaceId: string,
  currentUserId: string,
  permission: WorkspacePermission,
  transaction: WorkspaceMutationAccessClient,
): Promise<WorkspaceRole> {
  const rows = await transaction.$queryRaw<LockedMembershipRow[]>(Prisma.sql`
    SELECT "role"::text AS "role"
    FROM "memberships"
    WHERE "workspace_id" = ${workspaceId}
      AND "user_id" = ${currentUserId}
    FOR SHARE
  `);

  if (rows.length !== 1 || !isWorkspaceRole(rows[0]?.role)) {
    throw new WorkspaceAccessDeniedError();
  }

  const role = rows[0].role;
  assertWorkspacePermission(role, permission);
  return role;
}
