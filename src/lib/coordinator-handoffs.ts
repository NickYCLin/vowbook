import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/current-user";
import { requireWorkspaceAccess } from "@/lib/workspace-access";

export async function getCoordinatorHandoffs(workspaceId: string) {
  const user = await requireCurrentUser();
  return prisma.$transaction(async (tx) => {
    const access = await requireWorkspaceAccess<{ id: string; name: string }>(workspaceId, user.id, "read", tx);
    const [items, staff, timeline] = await Promise.all([
      tx.coordinatorHandoff.findMany({
        where: { workspaceId },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: { id: true, title: true, details: true, phase: true, status: true, dueAt: true, staffId: true, timelineItemId: true, version: true },
      }),
      tx.weddingStaffAssignment.findMany({ where: { workspaceId }, orderBy: [{ roleName: "asc" }, { personName: "asc" }, { id: "asc" }], select: { id: true, roleName: true, personName: true } }),
      tx.weddingTimelineItem.findMany({ where: { workspaceId }, orderBy: [{ startMinute: "asc" }, { id: "asc" }], select: { id: true, title: true, startMinute: true } }),
    ]);
    return { role: access.role, workspace: access.workspace, items, staff, timeline };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export type HandoffListData = Awaited<ReturnType<typeof getCoordinatorHandoffs>>;
