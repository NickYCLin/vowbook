import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuestCheckInBoard } from "@/components/check-in/guest-check-in-board";
import { WorkspaceDataError } from "@/components/workspaces/workspace-data-error";
import { WorkspacePageHeader } from "@/components/workspaces/workspace-shell";
import {
  getWorkspacePermissions,
  WorkspaceAccessDeniedError,
} from "@/domain/workspace";
import {
  getGuestCheckInBoard,
  GuestCheckInBoardDataError,
} from "@/lib/guest-check-in-board";

export const metadata: Metadata = { title: "賓客報到" };

export default async function CheckInPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;

  let data;
  try {
    data = await getGuestCheckInBoard(workspaceId);
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) notFound();
    if (error instanceof GuestCheckInBoardDataError) {
      return (
        <WorkspaceDataError
          sectionTitle="賓客報到"
          message={error.message}
          retryHref={`/workspaces/${workspaceId}/check-in`}
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
        sectionTitle="賓客報到"
        description="婚宴當天逐組記錄實際到場人數；報到不會改寫賓客的出席回覆，兩邊各自保留。"
        activeSection="check-in"
        readOnlyNotice={
          canEdit
            ? undefined
            : "你目前是唯讀成員，可以查看報到狀況，但不能報到或調整人數。"
        }
      />
      <GuestCheckInBoard
        workspaceId={workspaceId}
        guests={data.guests}
        tables={data.tables}
        canEdit={canEdit}
      />
    </main>
  );
}
