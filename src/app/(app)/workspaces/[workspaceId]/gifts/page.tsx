import Link from "next/link";
import {buttonClassName} from "@/components/ui/button";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WeddingGiftBook } from "@/components/guests/wedding-gift-book";
import { WorkspaceDataError } from "@/components/workspaces/workspace-data-error";
import { WorkspacePageHeader } from "@/components/workspaces/workspace-shell";
import {
  getWorkspacePermissions,
  WorkspaceAccessDeniedError,
} from "@/domain/workspace";
import { GuestDataError, listGuestsForWorkspace } from "@/lib/guest-list";

export const metadata: Metadata = {
  title: "禮金簿",
};

export default async function GiftsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;

  let data;
  try {
    data = await listGuestsForWorkspace(workspaceId);
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) notFound();
    if (error instanceof GuestDataError) {
      return (
        <WorkspaceDataError
          sectionTitle="禮金簿"
          message={error.message}
          retryHref={`/workspaces/${workspaceId}/gifts`}
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
        sectionTitle="禮金簿"
        description="依邀請群組登記收到的禮金；禮金不屬於婚宴支出，也不受出席狀態影響。"
        activeSection="gifts"
        readOnlyNotice={
          canEdit
            ? undefined
            : "你目前是唯讀成員，可以查看禮金簿，但不能登記、修改或移除。"
        }
      />
      {canEdit?<div className="my-5"><Link href={`/workspaces/${workspaceId}/gifts/print`} className={buttonClassName({variant:"secondary"})}>列印紙本禮金簿</Link></div>:null}
      <WeddingGiftBook
        workspaceId={workspaceId}
        guests={data.guests}
        canEdit={canEdit}
        collapsible={false}
      />
    </main>
  );
}
