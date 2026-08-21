import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CreateWeddingTaskDialog } from "@/components/tasks/task-forms";
import { WeddingTaskList } from "@/components/tasks/task-list";
import { WorkspaceDataError } from "@/components/workspaces/workspace-data-error";
import { WorkspacePageHeader } from "@/components/workspaces/workspace-shell";
import {
  getWorkspacePermissions,
  WorkspaceAccessDeniedError,
} from "@/domain/workspace";
import {
  getWeddingTaskList,
  WeddingTaskDataError,
} from "@/lib/wedding-task-list";

export const metadata: Metadata = {
  title: "婚宴任務",
};

type TasksPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function TasksPage({ params }: TasksPageProps) {
  const { workspaceId } = await params;

  let data;
  try {
    data = await getWeddingTaskList(workspaceId);
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      notFound();
    }

    if (error instanceof WeddingTaskDataError) {
      return (
        <WorkspaceDataError
          sectionTitle="婚宴任務"
          message={error.message}
          retryHref={`/workspaces/${workspaceId}/tasks`}
        />
      );
    }

    throw error;
  }

  const canEdit = getWorkspacePermissions(data.role).canEdit;

  return (
    <main className="mx-auto w-full max-w-6xl min-w-0 px-5 py-6 sm:px-8 sm:py-12">
      <WorkspacePageHeader
        workspaceId={workspaceId}
        workspaceName={data.workspace.name}
        sectionTitle="婚宴任務"
        description="依到期日掌握待辦、進度與完成紀錄。"
        activeSection="tasks"
        readOnlyNotice={
          canEdit
            ? undefined
            : "你目前是唯讀成員，可以查看任務，但不能新增、編輯、變更狀態或刪除。"
        }
        actions={
          canEdit ? <CreateWeddingTaskDialog workspaceId={workspaceId} /> : null
        }
      />

      <WeddingTaskList
        workspaceId={workspaceId}
        tasks={data.tasks}
        canEdit={canEdit}
      />
    </main>
  );
}
