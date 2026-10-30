import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/current-user";
import { loadGuestInvitationManagement } from "@/lib/guest-invitations";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { WorkspacePageHeader } from "@/components/workspaces/workspace-shell";
import { GuestInvitationManager } from "@/components/guests/guest-invitation-manager";
export const metadata = { title: "邀請與回覆" };
export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const user = await requireCurrentUser();
  let data;
  try { data = await loadGuestInvitationManagement(workspaceId, user.id); }
  catch (error) { if (error instanceof WorkspaceAccessDeniedError) notFound(); throw error; }
  return <main className="mx-auto w-full max-w-6xl min-w-0 px-5 py-6 sm:px-8 sm:py-12">
    <WorkspacePageHeader workspaceId={workspaceId} workspaceName={data.workspace.name} sectionTitle="邀請與回覆" description="設定邀請題目、產生每組賓客專屬連結，整理回覆與用餐需求。" activeSection="guests" />
    <GuestInvitationManager workspaceId={workspaceId} initial={data} />
  </main>;
}
