import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SeatingPlan } from "@/components/tables/seating-plan";
import { buttonClassName } from "@/components/ui/button";
import { CreateSeatingTableForm } from "@/components/tables/table-forms";
import { WorkspaceDataError } from "@/components/workspaces/workspace-data-error";
import { WorkspacePageHeader } from "@/components/workspaces/workspace-shell";
import {
  getWorkspacePermissions,
  WorkspaceAccessDeniedError,
} from "@/domain/workspace";
import { getSeatingPlan, SeatingPlanDataError } from "@/lib/seating-plan";

export const metadata: Metadata = {
  title: "桌次安排",
};

type TablesPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function TablesPage({ params }: TablesPageProps) {
  const { workspaceId } = await params;

  let data;
  try {
    data = await getSeatingPlan(workspaceId);
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      notFound();
    }

    if (error instanceof SeatingPlanDataError) {
      return (
        <WorkspaceDataError
          sectionTitle="桌次安排"
          message={error.message}
          retryHref={`/workspaces/${workspaceId}/tables`}
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
        sectionTitle="桌次安排"
        description="依邀請人數安排入席，先處理未安排賓客，再檢視各桌容量。"
        activeSection="tables"
        readOnlyNotice={
          canEdit
            ? undefined
            : "你目前是唯讀成員，可以查看桌次與賓客安排，但不能新增、編輯或調整座位。"
        }
        actions={
          data.tables.length > 0 ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {/* 唯讀成員也能輸出桌圖：那是給會館的成品，不是編輯功能。 */}
              <Link
                href={`/workspaces/${workspaceId}/tables/chart`}
                className={buttonClassName({ variant: "secondary" })}
              >
                婚宴桌圖
              </Link>
              {canEdit ? (
                <CreateSeatingTableForm workspaceId={workspaceId} />
              ) : null}
            </div>
          ) : null
        }
      />

      <SeatingPlan
        workspaceId={workspaceId}
        tables={data.tables}
        unassignedGuests={data.unassignedGuests}
        canEdit={canEdit}
      />
    </main>
  );
}
