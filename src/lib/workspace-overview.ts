import "server-only";

import { prisma } from "@/lib/prisma";
import type { MembershipRole, WeddingWorkspace } from "@prisma/client";

export type WorkspaceOverviewStats = {
  guestTotal: number;
  guestResponded: number;
  guestAttending: number;
  attendingHeadcount: number;
  tableTotal: number;
  taskTotal: number;
  taskDone: number;
  budgetPlanned: number;
  budgetActual: number;
};

export type WorkspaceOverview = {
  membershipId: string;
  role: MembershipRole;
  workspace: WeddingWorkspace;
  stats: WorkspaceOverviewStats;
};

const emptyStats: WorkspaceOverviewStats = {
  guestTotal: 0,
  guestResponded: 0,
  guestAttending: 0,
  attendingHeadcount: 0,
  tableTotal: 0,
  taskTotal: 0,
  taskDone: 0,
  budgetPlanned: 0,
  budgetActual: 0,
};

/**
 * Dashboard 用的工作區概覽：成員資格 + 各模組統計。
 *
 * 安全性：workspace 範圍一律由 currentUserId 的 Membership 推導，
 * 不接受呼叫端指定 workspaceId，統計查詢也全部以該清單過濾。
 */
export async function listWorkspaceOverviewsForUser(
  currentUserId: string,
): Promise<WorkspaceOverview[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId: currentUserId },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });

  if (memberships.length === 0) {
    return [];
  }

  const workspaceIds = memberships.map((membership) => membership.workspaceId);
  const scope = { workspaceId: { in: workspaceIds } };

  const [guests, tables, tasks, budgets] = await Promise.all([
    prisma.guest.groupBy({
      by: ["workspaceId", "category", "attendanceStatus"],
      where: scope,
      _count: { _all: true },
      _sum: { partySize: true },
    }),
    prisma.seatingTable.groupBy({
      by: ["workspaceId"],
      where: scope,
      _count: { _all: true },
    }),
    prisma.weddingTask.groupBy({
      by: ["workspaceId", "status"],
      where: scope,
      _count: { _all: true },
    }),
    prisma.budgetItem.groupBy({
      by: ["workspaceId"],
      where: { ...scope, kind: "EXPENSE" },
      _sum: { plannedAmount: true, actualAmount: true },
    }),
  ]);

  const statsByWorkspace = new Map<string, WorkspaceOverviewStats>(
    workspaceIds.map((id) => [id, { ...emptyStats }]),
  );

  for (const row of guests) {
    const stats = statsByWorkspace.get(row.workspaceId);
    if (!stats) continue;

    const count = row._count._all;
    if (row.category === "GUEST") {
      stats.guestTotal += count;
      if (row.attendanceStatus !== "UNDECIDED") {
        stats.guestResponded += count;
      }
      if (row.attendanceStatus === "ATTENDING") {
        stats.guestAttending += count;
      }
    }
    if (row.attendanceStatus === "ATTENDING") {
      stats.attendingHeadcount += row._sum.partySize ?? 0;
    }
  }

  for (const row of tables) {
    const stats = statsByWorkspace.get(row.workspaceId);
    if (stats) stats.tableTotal = row._count._all;
  }

  for (const row of tasks) {
    const stats = statsByWorkspace.get(row.workspaceId);
    if (!stats) continue;

    stats.taskTotal += row._count._all;
    if (row.status === "DONE") {
      stats.taskDone += row._count._all;
    }
  }

  for (const row of budgets) {
    const stats = statsByWorkspace.get(row.workspaceId);
    if (!stats) continue;

    stats.budgetPlanned = row._sum.plannedAmount ?? 0;
    stats.budgetActual = row._sum.actualAmount ?? 0;
  }

  return memberships.map((membership) => ({
    membershipId: membership.id,
    role: membership.role,
    workspace: membership.workspace,
    stats: statsByWorkspace.get(membership.workspaceId) ?? { ...emptyStats },
  }));
}

/** 距離婚期還有幾天；沒設日期或已過期回傳 null。 */
export function daysUntilWedding(
  weddingDate: Date | null,
  now: Date,
): number | null {
  if (!weddingDate) return null;

  const startOfDay = (value: Date) =>
    Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const diff = startOfDay(weddingDate) - startOfDay(now);
  const days = Math.round(diff / 86_400_000);

  return days >= 0 ? days : null;
}
