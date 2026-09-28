import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeMenu } from "@/components/theme/theme-menu";
import { safeGoogleAvatarUrl } from "@/domain/profile-avatar";
import {
  RECENT_WORKSPACE_COOKIE,
  workspaceEntryPath,
} from "@/domain/workspace-entry";
import { getSignInPath, withBasePath } from "@/lib/base-path";
import {
  AccountAccessBlockedError,
  resolveCurrentUser,
} from "@/lib/current-user";
import { findProfileAvatarUpdatedAt } from "@/lib/profile-avatar";
import { isSystemAdmin } from "@/lib/system-admin";
import { listWorkspaceChoicesForUser } from "@/lib/workspace-choices";
import { WorkspaceSwitcher } from "@/components/workspaces/workspace-switcher";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.googleSubject) {
    redirect(getSignInPath("/dashboard"));
  }

  let currentUser;
  try {
    currentUser = await resolveCurrentUser(session);
  } catch (error) {
    if (error instanceof AccountAccessBlockedError) {
      redirect("/signin?error=AccessDenied");
    }
    throw error;
  }
  const customAvatarUpdatedAt = await findProfileAvatarUpdatedAt(currentUser.id);
  const googleAvatarUrl = safeGoogleAvatarUrl(
    currentUser.image ?? session.user.image,
  );
  const customAvatarUrl = customAvatarUpdatedAt
    ? withBasePath(
        `/api/profile/avatar?v=${encodeURIComponent(customAvatarUpdatedAt.toISOString())}`,
      )
    : null;
  const displayName = currentUser.name ?? currentUser.email ?? "";
  const initial = displayName.trim().charAt(0) || "誓";
  const memberships = await listWorkspaceChoicesForUser(currentUser.id);
  // 商標直接帶到會停留的那一頁，不要再繞 /dashboard 被轉一次。
  const entryPath = workspaceEntryPath(
    currentUser.id,
    memberships.map(({ workspace }) => workspace.id),
    (await cookies()).get(RECENT_WORKSPACE_COOKIE)?.value,
  );

  return (
    <div data-app-surface className="min-h-screen bg-paper">
      {/* 列印任何頁面（例如婚宴桌圖）都不該把黏在頂端的導覽列印上紙。 */}
      <header data-app-header className="sticky top-0 z-40 border-b border-line bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur-md print:hidden">
        <div className="mx-auto flex w-full max-w-[100rem] items-center justify-between gap-2 px-5 py-3 sm:gap-5 sm:px-8">
          <div data-app-wordmark className="shrink-0"><Wordmark href={entryPath} compact /></div>
          <div className="flex min-w-0 flex-1 sm:max-w-lg"><WorkspaceSwitcher userId={currentUser.id} choices={memberships.map(({ workspace, role }) => ({ id: workspace.id, name: workspace.name, role }))}/></div>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <ThemeMenu
              displayName={displayName}
              initial={initial}
              googleAvatarUrl={googleAvatarUrl}
              customAvatarUrl={customAvatarUrl}
              adminHref={isSystemAdmin(currentUser) ? "/admin/users" : null}
            />
            <span className="hidden sm:block">
              <SignOutButton variant="ghost" />
            </span>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
