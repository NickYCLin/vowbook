import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { InvitationAcceptedNotice } from "@/components/auth/invitation-accepted-notice";
import { SignInButton } from "@/components/auth/sign-in-button";
import { CreateWorkspaceDialog } from "@/components/workspaces/create-workspace-dialog";
import { DashboardWorkspaceDeletionFeedback } from "@/components/workspaces/dashboard-workspace-feedback";
import { WorkspaceSummary } from "@/components/workspaces/workspace-summary";
import { requireCurrentUserContext } from "@/lib/current-user";
import { listWorkspaceChoicesForUser } from "@/lib/workspace-choices";
import { RECENT_WORKSPACE_COOKIE, workspaceEntryId } from "@/domain/workspace-entry";

export const metadata: Metadata = {
  title: "所有婚宴",
};

type DashboardPageProps = {
  searchParams?: Promise<{ workspaceDeleted?: string | string[]; view?: string | string[] }>;
};

export default async function DashboardPage({
  searchParams = Promise.resolve({}),
}: DashboardPageProps = {}) {
  const {
    currentUser,
    invitationNotice,
    pendingInvitationConfirmation,
  } = await requireCurrentUserContext();
  const overviews = await listWorkspaceChoicesForUser(currentUser.id);
  const { workspaceDeleted, view } = await searchParams;

  if (overviews.length === 0 && !pendingInvitationConfirmation) {
    redirect("/onboarding");
  }

  if (view !== "all" && workspaceDeleted !== "1" && !invitationNotice && !pendingInvitationConfirmation) {
    const recent = (await cookies()).get(RECENT_WORKSPACE_COOKIE)?.value;
    const target = workspaceEntryId(currentUser.id, overviews.map(item => item.workspace.id), recent);
    if (target) redirect(`/workspaces/${target}/overview`);
  }

  const now = new Date();

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 max-w-2xl">
          <p className="text-eyebrow font-semibold text-clay uppercase">
            婚宴籌備
          </p>
          <h1 className="mt-2 font-serif text-display font-semibold text-ink">
            所有婚宴
          </h1>
          <p className="mt-3 text-caption leading-7 text-ink-soft sm:text-base">
            這裡放著你參與的每一場，自己辦的和幫別人籌備的都在一起。
          </p>
        </div>
        <div className="shrink-0">
          <CreateWorkspaceDialog />
        </div>
      </div>

      {invitationNotice ? (
        <InvitationAcceptedNotice notice={invitationNotice} />
      ) : null}

      {pendingInvitationConfirmation ? (
        <div className="mt-6 flex min-w-0 flex-col gap-3 rounded-card border border-caution/30 bg-caution-soft px-4 py-3.5 text-caption leading-6 text-caution sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p role="status" className="font-medium">
            有新的協作邀請。
          </p>
          <SignInButton
            callbackUrl="/dashboard"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-control bg-clay px-5 font-semibold text-white transition hover:bg-clay-strong disabled:cursor-wait disabled:opacity-60"
            label="確認並加入"
          />
        </div>
      ) : null}

      {workspaceDeleted === "1" ? (
        <DashboardWorkspaceDeletionFeedback />
      ) : null}

      <section aria-label="已加入的婚宴工作區" className="mt-8 grid items-start gap-5 md:grid-cols-2">
        {overviews.map((overview) => (
          <WorkspaceSummary
            key={overview.id}
            role={overview.role}
            workspace={overview.workspace}
            compact
            now={now}
          />
        ))}
      </section>
    </main>
  );
}
