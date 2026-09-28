import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  SeatingScenarioEditor,
  SeatingScenarioTabs,
} from "@/components/tables/seating-scenarios";
import { WorkspaceDataError } from "@/components/workspaces/workspace-data-error";
import { WorkspacePageHeader } from "@/components/workspaces/workspace-shell";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import {
  loadSeatingScenarioDetail,
  loadSeatingScenarioList,
  SeatingScenarioDataError,
  SeatingScenarioNotFoundError,
} from "@/lib/seating-scenarios";

export const metadata: Metadata = {
  title: "座位方案",
};

type SeatingScenarioPageProps = {
  params: Promise<{ workspaceId: string; scenarioId: string }>;
};

export default async function SeatingScenarioPage({ params }: SeatingScenarioPageProps) {
  const { workspaceId, scenarioId } = await params;
  const user = await requireCurrentUser();

  let detail;
  let list;
  try {
    detail = await loadSeatingScenarioDetail(workspaceId, user.id, scenarioId);
    list = await loadSeatingScenarioList(workspaceId, user.id);
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError || error instanceof SeatingScenarioNotFoundError) {
      notFound();
    }
    if (error instanceof SeatingScenarioDataError) {
      return (
        <WorkspaceDataError
          sectionTitle="座位方案"
          message={error.message}
          retryHref={`/workspaces/${workspaceId}/tables/scenarios/${scenarioId}`}
        />
      );
    }
    throw error;
  }

  return (
    <main className="mx-auto w-full max-w-6xl min-w-0 px-5 py-6 sm:px-8 sm:py-12">
      <WorkspacePageHeader
        workspaceId={workspaceId}
        workspaceName={detail.workspaceName}
        sectionTitle="桌次安排"
        description="在方案裡試排不同的出席狀況，確定後再套用為正式安排。"
        activeSection="tables"
        readOnlyNotice={
          detail.canEdit ? undefined : "你目前是唯讀成員，可以查看方案，但不能編輯或套用。"
        }
      />
      <SeatingScenarioTabs
        workspaceId={workspaceId}
        drafts={list.drafts}
        backups={list.backups}
        activeId={scenarioId}
        canEdit={detail.canEdit}
      />
      <SeatingScenarioEditor workspaceId={workspaceId} detail={detail} />
    </main>
  );
}
