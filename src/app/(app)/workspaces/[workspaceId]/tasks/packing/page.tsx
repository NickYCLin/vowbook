import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClassName } from "@/components/ui/button";
import { PackingList } from "@/components/packing/packing-list";
import { WorkspaceDataError } from "@/components/workspaces/workspace-data-error";
import { WorkspacePageHeader } from "@/components/workspaces/workspace-shell";
import {
  getWorkspacePermissions,
  WorkspaceAccessDeniedError,
} from "@/domain/workspace";
import { getPackingList, PackingListDataError } from "@/lib/packing-list";

export const metadata: Metadata = {
  title: "入住打包清單",
};

type PackingPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function PackingPage({ params }: PackingPageProps) {
  const { workspaceId } = await params;

  let data;
  try {
    data = await getPackingList(workspaceId);
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) notFound();
    if (error instanceof PackingListDataError) {
      return (
        <WorkspaceDataError
          sectionTitle="入住打包清單"
          message={error.message}
          retryHref={`/workspaces/${workspaceId}/tasks/packing`}
        />
      );
    }
    throw error;
  }

  const canEdit = getWorkspacePermissions(data.role).canEdit;

  return (
    <main className="mx-auto w-full max-w-6xl min-w-0 px-5 py-6 sm:px-8 sm:py-12 print:p-0">
      <div className="print:hidden">
        <WorkspacePageHeader
          workspaceId={workspaceId}
          workspaceName={data.workspace.name}
          sectionTitle="入住打包清單"
          description="前一晚入住會館要帶的物品：個人物品依新郎、新娘、共用分開，位上禮、遊戲禮等宴客用品另列一區。"
          activeSection="tasks"
          readOnlyNotice={
            canEdit ? undefined : "你目前是唯讀成員，可以查看清單，但不能修改。"
          }
          actions={
            <Link
              href={`/workspaces/${workspaceId}/tasks`}
              className={buttonClassName({ variant: "secondary" })}
            >
              返回婚宴任務
            </Link>
          }
        />
      </div>
      <h1 className="hidden text-lg font-semibold print:block">入住打包清單</h1>
      <PackingList
        workspaceId={workspaceId}
        items={data.items}
        supplySuggestions={data.supplySuggestions}
        canEdit={canEdit}
      />
    </main>
  );
}
