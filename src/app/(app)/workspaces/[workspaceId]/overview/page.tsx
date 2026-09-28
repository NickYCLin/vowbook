import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WeddingHome } from "@/components/workspaces/wedding-home";
import { WorkspaceDataError } from "@/components/workspaces/workspace-data-error";
import { WorkspacePageHeader } from "@/components/workspaces/workspace-shell";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import {
  getWeddingOverview,
  WeddingOverviewDataError,
} from "@/lib/wedding-overview";

export const metadata: Metadata = { title: "婚宴首頁" };

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  let data;
  try {
    data = await getWeddingOverview(workspaceId);
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) notFound();
    if (error instanceof WeddingOverviewDataError) {
      return (
        <WorkspaceDataError
          sectionTitle="婚宴總覽"
          message={error.message}
          retryHref={`/workspaces/${workspaceId}/overview`}
        />
      );
    }
    throw error;
  }

  return (
    <main className="mx-auto w-full max-w-6xl min-w-0 px-5 py-6 sm:px-8 sm:py-12">
      <WorkspacePageHeader
        workspaceId={workspaceId}
        workspaceName={data.workspace.name}
        sectionTitle="婚宴首頁"
        description={`${data.workspace.weddingDate ? new Intl.DateTimeFormat("zh-TW", { dateStyle: "long", timeZone: data.workspace.timezone }).format(new Date(data.workspace.weddingDate)) : "婚期尚未決定"} · 接著把需要確認的事情處理好。`}
        activeSection="overview"
      />
      <WeddingHome workspaceId={workspaceId} data={data} />
    </main>
  );
}
