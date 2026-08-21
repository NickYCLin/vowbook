import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CreateWeddingTimelineItemForm } from "@/components/timeline/timeline-forms";
import { WeddingTimelineList } from "@/components/timeline/timeline-list";
import { WorkspacePageHeader } from "@/components/workspaces/workspace-shell";
import {
  getWorkspacePermissions,
  WorkspaceAccessDeniedError,
} from "@/domain/workspace";
import { getWeddingTimelinePageData } from "@/lib/wedding-timeline-list";

export const metadata: Metadata = { title: "婚禮總流程" };

export default async function TimelinePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  let data;
  try {
    data = await getWeddingTimelinePageData(workspaceId);
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) notFound();
    throw error;
  }
  const canEdit = getWorkspacePermissions(data.role).canEdit;
  return (
    <main className="mx-auto w-full max-w-6xl min-w-0 px-5 py-6 sm:px-8 sm:py-12">
      <WorkspacePageHeader
        workspaceId={workspaceId}
        workspaceName={data.workspace.name}
        sectionTitle="婚禮總流程"
        description="依時間掌握當日流程、音樂／影片、地點、細節與負責工作人員。"
        activeSection="timeline"
        readOnlyNotice={
          canEdit
            ? undefined
            : "你目前是唯讀成員，可以查看總流程，但不能新增、編輯或刪除。"
        }
        actions={
          canEdit && data.items.length > 0 ? (
            <CreateWeddingTimelineItemForm
              workspaceId={workspaceId}
              staff={data.staff}
            />
          ) : null
        }
      />
      <WeddingTimelineList
        workspaceId={workspaceId}
        items={data.items}
        staff={data.staff}
        canEdit={canEdit}
      />
    </main>
  );
}
