import "server-only";

import type { WeddingWorkspace } from "@prisma/client";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-access";

export type WeddingStaffListItem = {
  id: string;
  roleName: string;
  personName: string;
  contactPhone: string | null;
  notes: string | null;
  version: number;
};

type WeddingStaffPrismaClient = {
  weddingStaffAssignment: {
    findMany(args: unknown): Promise<WeddingStaffListItem[]>;
  };
};

export class WeddingStaffDataError extends Error {
  constructor(message = "目前無法載入婚禮工作人員，請稍後再試。") {
    super(message);
    this.name = "WeddingStaffDataError";
  }
}

const staffSelect = {
  id: true,
  roleName: true,
  personName: true,
  contactPhone: true,
  notes: true,
  version: true,
};

const deterministicOrder = [
  { roleName: "asc" },
  { personName: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
];

export async function getWeddingStaffList(workspaceId: string) {
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
    throw new WeddingStaffDataError();
  }

  try {
    const staffPrisma = prisma as unknown as WeddingStaffPrismaClient;
    const staff = await staffPrisma.weddingStaffAssignment.findMany({
      where: { workspaceId },
      orderBy: deterministicOrder,
      select: staffSelect,
    });
    return {
      role: access.role,
      workspace: { id: access.workspace.id, name: access.workspace.name },
      staff,
    };
  } catch {
    throw new WeddingStaffDataError();
  }
}
