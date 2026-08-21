import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CreateGuestDialog } from "@/components/guests/guest-forms";
import { GuestList } from "@/components/guests/guest-list";
import { WorkspaceDataError } from "@/components/workspaces/workspace-data-error";
import { WorkspacePageHeader } from "@/components/workspaces/workspace-shell";
import {
  getWorkspacePermissions,
  WorkspaceAccessDeniedError,
} from "@/domain/workspace";
import { GuestDataError, listGuestsForWorkspace } from "@/lib/guest-list";

export const metadata: Metadata = {
  title: "婚宴名單",
};

type GuestsPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function GuestsPage({ params }: GuestsPageProps) {
  const { workspaceId } = await params;

  let data;
  try {
    data = await listGuestsForWorkspace(workspaceId);
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      notFound();
    }

    if (error instanceof GuestDataError) {
      return (
        <WorkspaceDataError
          sectionTitle="婚宴名單"
          message={error.message}
          retryHref={`/workspaces/${workspaceId}/guests`}
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
        sectionTitle="婚宴名單"
        description="把新人、家人與受邀賓客放在同一份名單，桌次與宴席人數會一起計算。"
        activeSection="guests"
        readOnlyNotice={
          canEdit
            ? undefined
            : "你目前是唯讀成員，可以查看名單，但不能新增、編輯或刪除。"
        }
        actions={
          canEdit ? <CreateGuestDialog workspaceId={workspaceId} /> : null
        }
      />

      <GuestList
        workspaceId={workspaceId}
        guests={data.guests}
        canEdit={canEdit}
      />
    </main>
  );
}
