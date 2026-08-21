import "server-only";

import {
  assertWorkspacePermission,
  isWorkspaceRole,
  type WorkspacePermission,
  type WorkspaceRole,
  WorkspaceAccessDeniedError,
} from "@/domain/workspace";
import { prisma } from "@/lib/prisma";

type MembershipWithWorkspace<TWorkspace = unknown> = {
  role: string;
  workspace: TWorkspace;
};

type WorkspaceAccessClient<TWorkspace = unknown> = {
  membership: {
    findUnique(args: {
      where: {
        workspaceId_userId: { workspaceId: string; userId: string };
      };
      include: { workspace: true };
    }): Promise<MembershipWithWorkspace<TWorkspace> | null>;
  };
};

export async function requireWorkspaceAccess<TWorkspace = unknown>(
  workspaceId: string,
  currentUserId: string,
  permission: WorkspacePermission,
  client?: WorkspaceAccessClient<TWorkspace>,
): Promise<{ role: WorkspaceRole; workspace: TWorkspace }> {
  const accessClient =
    client ?? (prisma as unknown as WorkspaceAccessClient<TWorkspace>);
  const membership = await accessClient.membership.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId: currentUserId,
      },
    },
    include: { workspace: true },
  });

  if (!membership || !isWorkspaceRole(membership.role)) {
    throw new WorkspaceAccessDeniedError();
  }

  assertWorkspacePermission(membership.role, permission);

  return {
    role: membership.role,
    workspace: membership.workspace,
  };
}
