import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkspacePageHeader } from "@/components/workspaces/workspace-shell";
import { StaffTabs } from "@/components/staff/staff-tabs";
import { HandoffBoard } from "@/components/handoffs/handoff-board";
import { getCoordinatorHandoffs } from "@/lib/coordinator-handoffs";
import { getWorkspacePermissions, WorkspaceAccessDeniedError } from "@/domain/workspace";
export const metadata: Metadata = { title: "總召交辦" };
export default async function HandoffsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  let data;
  try { data = await getCoordinatorHandoffs(workspaceId); } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) notFound();
    throw error;
  }
  const canEdit = getWorkspacePermissions(data.role).canEdit;
  return <main className="mx-auto w-full max-w-6xl min-w-0 px-5 py-6 sm:px-8 sm:py-12">
    <WorkspacePageHeader workspaceId={workspaceId} workspaceName={data.workspace.name} sectionTitle="總召交辦" description="集中記錄需要總召協助的婚前準備與當日事項，確認負責人、完成時間及交代內容。" activeSection="staff" readOnlyNotice={canEdit ? undefined : "你目前是唯讀成員，可以查看交辦事項，但不能修改。"} />
    <StaffTabs workspaceId={workspaceId} active="handoffs" />
    <HandoffBoard workspaceId={workspaceId} data={data} canEdit={canEdit} />
  </main>;
}
