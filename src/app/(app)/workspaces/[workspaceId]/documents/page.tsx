import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkspaceDocuments } from "@/components/documents/workspace-documents";
import { WorkspaceDataError } from "@/components/workspaces/workspace-data-error";
import { WorkspacePageHeader } from "@/components/workspaces/workspace-shell";
import { getWorkspacePermissions } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import {
  listWorkspaceDocumentsForUser,
  WorkspaceDocumentDataError,
  WorkspaceDocumentTargetError,
} from "@/lib/workspace-documents";

export const metadata: Metadata = {
  title: "喜帖與廠商文件",
};

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const currentUser = await requireCurrentUser();

  let data;
  try {
    data = await listWorkspaceDocumentsForUser(workspaceId, currentUser.id);
  } catch (error) {
    if (error instanceof WorkspaceDocumentTargetError) notFound();
    if (error instanceof WorkspaceDocumentDataError) {
      return (
        <WorkspaceDataError
          sectionTitle="喜帖與廠商文件"
          message={error.message}
          retryHref={`/workspaces/${workspaceId}/documents`}
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
        sectionTitle="喜帖與廠商文件"
        description="電子喜帖、廠商給的行程表與合約都存在這裡，不會像聊天軟體裡的檔案一樣過期；只有這場婚宴的協作者看得到。"
        activeSection="documents"
        readOnlyNotice={
          canEdit ? undefined : "你目前是唯讀成員，可以查看與下載文件，但不能上傳或刪除。"
        }
      />
      <WorkspaceDocuments
        workspaceId={workspaceId}
        initialDocuments={data.documents}
        canEdit={canEdit}
      />
    </main>
  );
}
