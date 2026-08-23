import type { ReactNode } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeMenu } from "@/components/theme/theme-menu";
import { safeGoogleAvatarUrl } from "@/domain/profile-avatar";
import { getSignInPath, withBasePath } from "@/lib/base-path";
import { resolveCurrentUser } from "@/lib/current-user";
import { findProfileAvatarUpdatedAt } from "@/lib/profile-avatar";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.googleSubject) {
    redirect(getSignInPath("/dashboard"));
  }

  const currentUser = await resolveCurrentUser(session);
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

  return (
    <div className="min-h-screen bg-paper">
      {/* 列印任何頁面（例如婚宴桌圖）都不該把黏在頂端的導覽列印上紙。 */}
      <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md print:hidden">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <Wordmark href="/dashboard" />
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <ThemeMenu
              displayName={displayName}
              initial={initial}
              googleAvatarUrl={googleAvatarUrl}
              customAvatarUrl={customAvatarUrl}
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
