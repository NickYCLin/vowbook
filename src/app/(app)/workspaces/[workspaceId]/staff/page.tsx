import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CreateWeddingStaffForm } from "@/components/staff/staff-forms";
import { WeddingStaffList } from "@/components/staff/staff-list";
import { WorkspacePageHeader } from "@/components/workspaces/workspace-shell";
import {
  getWorkspacePermissions,
  WorkspaceAccessDeniedError,
} from "@/domain/workspace";
import { getWeddingStaffList } from "@/lib/wedding-staff-list";

export const metadata: Metadata = { title: "婚禮工作人員" };

export default async function StaffPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  let data;
  try {
    data = await getWeddingStaffList(workspaceId);
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
        sectionTitle="婚禮工作人員"
        description="依職務整理婚禮當日團隊；同一職務可有多人，同一人也能負責多個職務。"
        activeSection="staff"
        readOnlyNotice={
          canEdit
            ? undefined
            : "你目前是唯讀成員，可以查看工作人員，但不能新增、編輯或移除。"
        }
        actions={
          canEdit && data.staff.length > 0 ? (
            <CreateWeddingStaffForm workspaceId={workspaceId} />
          ) : null
        }
      />
      <WeddingStaffList workspaceId={workspaceId} staff={data.staff} canEdit={canEdit} />
    </main>
  );
}
