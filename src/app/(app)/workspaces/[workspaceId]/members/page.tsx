import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { WorkspaceMembersPanel } from "@/components/workspaces/workspace-members";
import { WorkspacePageHeader } from "@/components/workspaces/workspace-shell";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { getWorkspaceMembersData } from "@/lib/workspace-invitations";

export const metadata: Metadata = { title: "協作者" };

export default async function MembersPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  let data;
  try {
    data = await getWorkspaceMembersData(workspaceId);
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      notFound();
    }
    throw error;
  }

  const isOwner = data.role === "OWNER";

  return (
    <main className="mx-auto w-full max-w-6xl min-w-0 px-5 py-6 sm:px-8 sm:py-12">
      <WorkspacePageHeader
        workspaceId={workspaceId}
        workspaceName={data.workspace.name}
        sectionTitle={isOwner ? "分享與協作" : "協作者"}
        description={
          isOwner
            ? "邀請伴侶、婚顧或檢視者，以各自的 Google 帳號安全共同籌備。"
            : "查看目前一起籌備這場婚宴的協作者。"
        }
        activeSection="members"
        readOnlyNotice={
          isOwner
            ? undefined
            : "你目前只能查看成員的顯示名稱與角色；Email、等待接受的邀請與管理操作只提供給擁有者。"
        }
      />
      <WorkspaceMembersPanel
        workspaceId={workspaceId}
        operationKey={randomUUID()}
        role={data.role}
        members={data.members}
        pendingInvitations={data.pendingInvitations}
        renewableInvitations={data.renewableInvitations}
      />
    </main>
  );
}
