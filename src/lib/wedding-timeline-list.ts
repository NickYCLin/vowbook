import "server-only";

import { Prisma, type WeddingWorkspace } from "@prisma/client";
import {
  formatWeddingTimelineMinute,
} from "@/domain/wedding-timeline";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-access";

export type WeddingTimelineStaffOption = {
  id: string;
  roleName: string;
  personName: string;
};

export type WeddingTimelineListItem = {
  id: string;
  startTime: string;
  endTime: string | null;
  phase: string;
  title: string;
  location: string | null;
  details: string | null;
  mediaCue: string | null;
  notes: string | null;
  version: number;
  assignedStaff: WeddingTimelineStaffOption[];
};

type TimelineRecord = {
  id: string;
  startMinute: number;
  endMinute: number | null;
  phase: string;
  title: string;
  location: string | null;
  details: string | null;
  mediaCue: string | null;
  notes: string | null;
  version: number;
  staffAssignments: Array<{
    staffAssignment: WeddingTimelineStaffOption;
  }>;
};

type TimelineTransaction = {
  weddingTimelineItem: {
    findMany(args: unknown): Promise<TimelineRecord[]>;
  };
  weddingStaffAssignment: {
    findMany(args: unknown): Promise<WeddingTimelineStaffOption[]>;
  };
};

type TimelinePrismaClient = {
  $transaction<T>(
    callback: (transaction: TimelineTransaction) => Promise<T>,
    options: { isolationLevel: string },
  ): Promise<T>;
};

export class WeddingTimelineDataError extends Error {
  constructor(message = "目前無法載入婚禮總流程，請稍後再試。") {
    super(message);
    this.name = "WeddingTimelineDataError";
  }
}

const staffSelect = {
  id: true,
  roleName: true,
  personName: true,
};

const timelineSelect = {
  id: true,
  startMinute: true,
  endMinute: true,
  phase: true,
  title: true,
  location: true,
  details: true,
  mediaCue: true,
  notes: true,
  version: true,
  staffAssignments: {
    select: { staffAssignment: { select: staffSelect } },
  },
};

function compareStaff(
  left: WeddingTimelineStaffOption,
  right: WeddingTimelineStaffOption,
): number {
  return (
    left.roleName.localeCompare(right.roleName, "zh-Hant") ||
    left.personName.localeCompare(right.personName, "zh-Hant") ||
    left.id.localeCompare(right.id)
  );
}

function itemViewModel(record: TimelineRecord): WeddingTimelineListItem {
  return {
    id: record.id,
    startTime: formatWeddingTimelineMinute(record.startMinute),
    endTime:
      record.endMinute === null
        ? null
        : formatWeddingTimelineMinute(record.endMinute),
    phase: record.phase,
    title: record.title,
    location: record.location,
    details: record.details,
    mediaCue: record.mediaCue,
    notes: record.notes,
    version: record.version,
    assignedStaff: record.staffAssignments
      .map((assignment) => assignment.staffAssignment)
      .sort(compareStaff),
  };
}

export async function getWeddingTimelinePageData(workspaceId: string) {
  const currentUser = await requireCurrentUser();
  let access;
  try {
    access = await requireWorkspaceAccess<
      Pick<WeddingWorkspace, "id" | "name">
    >(workspaceId, currentUser.id, "read");
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) throw error;
    throw new WeddingTimelineDataError();
  }

  try {
    const timelinePrisma = prisma as unknown as TimelinePrismaClient;
    const snapshot = await timelinePrisma.$transaction(
      async (transaction) => {
        const [items, staff] = await Promise.all([
          transaction.weddingTimelineItem.findMany({
            where: { workspaceId },
            orderBy: [
              { startMinute: "asc" },
              { endMinute: { sort: "asc", nulls: "last" } },
              { createdAt: "asc" },
              { id: "asc" },
            ],
            select: timelineSelect,
          }),
          transaction.weddingStaffAssignment.findMany({
            where: { workspaceId },
            orderBy: [
              { roleName: "asc" },
              { personName: "asc" },
              { createdAt: "asc" },
              { id: "asc" },
            ],
            select: staffSelect,
          }),
        ]);
        return { items, staff };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    return {
      role: access.role,
      workspace: { id: access.workspace.id, name: access.workspace.name },
      items: snapshot.items.map(itemViewModel),
      staff: snapshot.staff,
    };
  } catch {
    throw new WeddingTimelineDataError();
  }
}
