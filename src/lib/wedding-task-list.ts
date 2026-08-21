import "server-only";

import { Prisma, type WeddingWorkspace } from "@prisma/client";
import type {
  WeddingTaskSideValue,
  WeddingTaskStatusValue,
} from "@/domain/wedding-task";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-access";

type WeddingTaskRecord = {
  id: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  status: WeddingTaskStatusValue;
  side: WeddingTaskSideValue;
  completedAt: Date | null;
  version: number;
};

type WeddingTaskTransaction = {
  weddingTask: {
    findMany(args: unknown): Promise<WeddingTaskRecord[]>;
  };
};

type WeddingTaskPrismaClient = {
  $transaction<T>(
    callback: (transaction: WeddingTaskTransaction) => Promise<T>,
    options: { isolationLevel: string },
  ): Promise<T>;
};

export type WeddingTaskListItem = {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: WeddingTaskStatusValue;
  side: WeddingTaskSideValue;
  completedAt: string | null;
  version: number;
};

export class WeddingTaskDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeddingTaskDataError";
  }
}

const taskSelect = {
  id: true,
  title: true,
  description: true,
  dueDate: true,
  status: true,
  side: true,
  completedAt: true,
  version: true,
};

const deterministicOrder = [
  { dueDate: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
  { id: "asc" },
];

function taskViewModel(task: WeddingTaskRecord): WeddingTaskListItem {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    dueDate: task.dueDate?.toISOString().slice(0, 10) ?? null,
    status: task.status,
    side: task.side,
    completedAt: task.completedAt?.toISOString() ?? null,
    version: task.version,
  };
}

export async function getWeddingTaskList(workspaceId: string) {
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

    throw new WeddingTaskDataError("目前無法載入婚宴任務，請稍後再試。");
  }

  let records: WeddingTaskRecord[];
  try {
    const taskPrisma = prisma as unknown as WeddingTaskPrismaClient;
    records = await taskPrisma.$transaction(
      async (transaction) => {
        const [activeTasks, completedTasks] = await Promise.all([
          transaction.weddingTask.findMany({
            where: {
              workspaceId,
              status: { in: ["TODO", "IN_PROGRESS"] },
            },
            orderBy: deterministicOrder,
            select: taskSelect,
          }),
          transaction.weddingTask.findMany({
            where: { workspaceId, status: "DONE" },
            orderBy: deterministicOrder,
            select: taskSelect,
          }),
        ]);

        return [...activeTasks, ...completedTasks];
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  } catch {
    throw new WeddingTaskDataError("目前無法載入婚宴任務，請稍後再試。");
  }

  return {
    role: access.role,
    workspace: { id: access.workspace.id, name: access.workspace.name },
    tasks: records.map(taskViewModel),
  };
}
