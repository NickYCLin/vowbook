"use client";

import { useMemo, useState } from "react";
import {
  WEDDING_TASK_SIDE_LABELS,
  type WeddingTaskSideValue,
  type WeddingTaskStatusValue,
} from "@/domain/wedding-task";
import { Badge, BadgeDot, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChips, SearchInput, Toolbar } from "@/components/ui/toolbar";
import {
  ChangeWeddingTaskStatusForm,
  CreateWeddingTaskDialog,
  DeleteWeddingTaskForm,
  EditWeddingTaskForm,
} from "./task-forms";

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

const statusLabels: Record<WeddingTaskStatusValue, string> = {
  TODO: "待辦",
  IN_PROGRESS: "進行中",
  DONE: "已完成",
};

const statusTones: Record<WeddingTaskStatusValue, BadgeTone> = {
  TODO: "neutral",
  IN_PROGRESS: "caution",
  DONE: "positive",
};

const sideTones: Record<WeddingTaskSideValue, BadgeTone> = {
  SHARED: "neutral",
  PARTNER_A: "sage",
  PARTNER_B: "brand",
};

type StatusFilter = "ALL" | WeddingTaskStatusValue;
type SideFilter = "ALL" | WeddingTaskSideValue;

function completedAtLabel(value: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

/** 到期日是否已過；已完成的任務不算逾期。 */
function isOverdue(task: WeddingTaskListItem, today: string): boolean {
  return (
    task.status !== "DONE" && task.dueDate !== null && task.dueDate < today
  );
}

function TaskStatusActions({
  workspaceId,
  task,
}: {
  workspaceId: string;
  task: WeddingTaskListItem;
}) {
  const actions: { target: WeddingTaskStatusValue; label: string }[] =
    task.status === "TODO"
      ? [
          { target: "IN_PROGRESS", label: "開始進行" },
          { target: "DONE", label: "標記完成" },
        ]
      : task.status === "IN_PROGRESS"
        ? [
            { target: "TODO", label: "移回待辦" },
            { target: "DONE", label: "標記完成" },
          ]
        : [
            { target: "TODO", label: "移回待辦" },
            { target: "IN_PROGRESS", label: "重新進行" },
          ];

  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      {actions.map((action) => (
        <ChangeWeddingTaskStatusForm
          key={action.target}
          workspaceId={workspaceId}
          taskId={task.id}
          targetStatus={action.target}
          label={action.label}
          taskTitle={task.title}
          expectedVersion={task.version}
        />
      ))}
    </div>
  );
}

function TaskCard({
  workspaceId,
  task,
  canEdit,
  today,
}: {
  workspaceId: string;
  task: WeddingTaskListItem;
  canEdit: boolean;
  today: string;
}) {
  const overdue = isOverdue(task, today);

  return (
    <Card as="li" className="list-none">
      <article className="min-w-0 px-5 py-5 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h3 className="min-w-0 flex-1 break-words font-serif text-title font-semibold text-ink">
            {task.title}
          </h3>
          <div className="flex min-w-0 flex-wrap justify-end gap-2">
            <Badge tone={sideTones[task.side]}>
              <BadgeDot />
              {WEDDING_TASK_SIDE_LABELS[task.side]}
            </Badge>
            <Badge tone={statusTones[task.status]}>
              <BadgeDot />
              {statusLabels[task.status]}
            </Badge>
          </div>
        </div>

        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-caption">
          {task.dueDate ? (
            <span
              className={
                overdue ? "font-semibold text-danger" : "text-ink-soft"
              }
            >
              到期日：{task.dueDate}
              {overdue ? "（已逾期）" : ""}
            </span>
          ) : (
            <span className="text-ink-faint">未設定到期日</span>
          )}
          {task.completedAt && (
            <span className="font-medium text-positive">
              完成於 {completedAtLabel(task.completedAt)}
            </span>
          )}
        </div>

        {task.description && (
          <p className="mt-3 break-words whitespace-pre-wrap text-caption leading-6 text-ink-soft">
            {task.description}
          </p>
        )}

        {canEdit && (
          <div className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <TaskStatusActions workspaceId={workspaceId} task={task} />
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <EditWeddingTaskForm
                workspaceId={workspaceId}
                taskId={task.id}
                title={task.title}
                description={task.description}
                dueDate={task.dueDate}
                side={task.side}
                expectedVersion={task.version}
              />
              <DeleteWeddingTaskForm
                workspaceId={workspaceId}
                taskId={task.id}
                title={task.title}
                expectedVersion={task.version}
              />
            </div>
          </div>
        )}
      </article>
    </Card>
  );
}

export function WeddingTaskList({
  workspaceId,
  tasks,
  canEdit,
  today = new Date().toISOString().slice(0, 10),
}: {
  workspaceId: string;
  tasks: WeddingTaskListItem[];
  canEdit: boolean;
  today?: string;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [sideFilter, setSideFilter] = useState<SideFilter>("ALL");

  const counts = useMemo(
    () => ({
      ALL: tasks.length,
      TODO: tasks.filter((task) => task.status === "TODO").length,
      IN_PROGRESS: tasks.filter((task) => task.status === "IN_PROGRESS").length,
      DONE: tasks.filter((task) => task.status === "DONE").length,
    }),
    [tasks],
  );

  const sideCounts = useMemo(
    () => ({
      ALL: tasks.length,
      SHARED: tasks.filter((task) => task.side === "SHARED").length,
      PARTNER_A: tasks.filter((task) => task.side === "PARTNER_A").length,
      PARTNER_B: tasks.filter((task) => task.side === "PARTNER_B").length,
    }),
    [tasks],
  );

  const visibleTasks = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    return tasks.filter((task) => {
      if (statusFilter !== "ALL" && task.status !== statusFilter) return false;
      if (sideFilter !== "ALL" && task.side !== sideFilter) return false;
      if (!keyword) return true;

      return (
        task.title.toLowerCase().includes(keyword) ||
        (task.description ?? "").toLowerCase().includes(keyword)
      );
    });
  }, [tasks, query, sideFilter, statusFilter]);

  if (tasks.length === 0) {
    return (
      <section aria-labelledby="task-empty-heading" className="mt-6 min-w-0">
        <h2 id="task-empty-heading" className="sr-only">
          任務空白狀態
        </h2>
        <EmptyState
          title="尚未建立婚宴任務。"
          description={
            canEdit
              ? "先寫下下一件要完成的事情。"
              : "可以編輯此工作區的成員尚未加入任務。"
          }
          action={
            canEdit ? <CreateWeddingTaskDialog workspaceId={workspaceId} /> : null
          }
        />
      </section>
    );
  }

  return (
    <div className="mt-6 min-w-0 space-y-5">
      <Toolbar>
        <SearchInput
          label="搜尋任務"
          placeholder="搜尋任務名稱或說明"
          value={query}
          onChange={setQuery}
        />
        <FilterChips<StatusFilter>
          label="依狀態篩選任務"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "ALL", label: "全部", count: counts.ALL },
            { value: "TODO", label: "待辦", count: counts.TODO },
            {
              value: "IN_PROGRESS",
              label: "進行中",
              count: counts.IN_PROGRESS,
            },
            { value: "DONE", label: "已完成", count: counts.DONE },
          ]}
        />
        <FilterChips<SideFilter>
          label="依任務歸屬篩選"
          value={sideFilter}
          onChange={setSideFilter}
          options={[
            { value: "ALL", label: "全部歸屬", count: sideCounts.ALL },
            { value: "SHARED", label: "共同任務", count: sideCounts.SHARED },
            {
              value: "PARTNER_A",
              label: "男方任務",
              count: sideCounts.PARTNER_A,
            },
            {
              value: "PARTNER_B",
              label: "女方任務",
              count: sideCounts.PARTNER_B,
            },
          ]}
        />
      </Toolbar>

      {visibleTasks.length === 0 ? (
        <EmptyState
          title="沒有符合條件的任務。"
          description="調整搜尋關鍵字、狀態或任務歸屬篩選，就能找回其他任務。"
        />
      ) : (
        <section aria-label="婚宴任務清單" className="min-w-0">
          <ul className="min-w-0 space-y-4">
            {visibleTasks.map((task) => (
              <TaskCard
                key={task.id}
                workspaceId={workspaceId}
                task={task}
                canEdit={canEdit}
                today={today}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
