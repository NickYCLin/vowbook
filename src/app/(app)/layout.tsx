import type { ReactNode } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeMenu } from "@/components/theme/theme-menu";
import { getSignInPath } from "@/lib/base-path";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.googleSubject) {
    redirect(getSignInPath("/dashboard"));
  }

  const displayName = session.user.name ?? session.user.email ?? "";
  const initial = displayName.trim().charAt(0) || "誓";

  return (
    <div className="min-h-screen bg-paper">
      {/* 列印任何頁面（例如婚宴桌圖）都不該把黏在頂端的導覽列印上紙。 */}
      <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md print:hidden">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <Wordmark href="/dashboard" />
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <ThemeMenu displayName={displayName} initial={initial} />
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
