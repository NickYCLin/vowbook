import "server-only";

import { Prisma, type WeddingWorkspace } from "@prisma/client";
import { weddingStaffTimelineAssignmentFingerprint } from "@/domain/wedding-staff-timeline-snapshot";
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
  mealCount: number | null;
  vegetarianMealCount: number | null;
  redEnvelopeAmount: number | null;
  redEnvelopeSentAt: Date | null;
  version: number;
  timelineAssignmentFingerprint: string;
};

type RawWeddingStaffListItem = Omit<
  WeddingStaffListItem,
  "timelineAssignmentFingerprint"
> & {
  timelineAssignments: Array<{ timelineItemId: string }>;
};

type WeddingStaffTransactionClient = {
  membership: {
    findUnique(args: unknown): Promise<{
      role: string;
      workspace: Pick<WeddingWorkspace, "id" | "name">;
    } | null>;
  };
  weddingStaffAssignment: {
    findMany(args: unknown): Promise<RawWeddingStaffListItem[]>;
  };
};

type WeddingStaffPrismaClient = {
  $transaction<T>(
    operation: (transaction: WeddingStaffTransactionClient) => Promise<T>,
    options: { isolationLevel: string },
  ): Promise<T>;
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
  mealCount: true,
  vegetarianMealCount: true,
  redEnvelopeAmount: true,
  redEnvelopeSentAt: true,
  version: true,
  timelineAssignments: {
    orderBy: [{ timelineItemId: "asc" }],
    select: { timelineItemId: true },
  },
};

const deterministicOrder = [
  { roleName: "asc" },
  { personName: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
];

export async function getWeddingStaffList(workspaceId: string) {
  const currentUser = await requireCurrentUser();
  const staffPrisma = prisma as unknown as WeddingStaffPrismaClient;

  try {
    return await staffPrisma.$transaction(
      async (transaction) => {
        const access = await requireWorkspaceAccess<
          Pick<WeddingWorkspace, "id" | "name">
        >(workspaceId, currentUser.id, "read", transaction);
        const records = await transaction.weddingStaffAssignment.findMany({
          where: { workspaceId },
          orderBy: deterministicOrder,
          select: staffSelect,
        });
        const staff: WeddingStaffListItem[] = records.map(
          ({ timelineAssignments, ...record }) => ({
            ...record,
            timelineAssignmentFingerprint:
              weddingStaffTimelineAssignmentFingerprint(
                timelineAssignments.map((assignment) =>
                  assignment.timelineItemId,
                ),
              ),
          }),
        );
        return {
          role: access.role,
          workspace: { id: access.workspace.id, name: access.workspace.name },
          staff,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      throw error;
    }
    throw new WeddingStaffDataError();
  }
}
