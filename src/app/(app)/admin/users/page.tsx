import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SystemUserList } from "@/components/admin/system-user-list";
import {
  listSystemUsers,
  SystemAdminAccessDeniedError,
} from "@/lib/system-admin";

export const metadata: Metadata = {
  title: "使用者管理",
  robots: { index: false, follow: false },
};

export default async function AdminUsersPage() {
  let users;
  try {
    users = await listSystemUsers();
  } catch (error) {
    if (error instanceof SystemAdminAccessDeniedError) notFound();
    throw error;
  }

  const counts = {
    ACTIVE: users.filter((user) => user.accessStatus === "ACTIVE").length,
    SUSPENDED: users.filter((user) => user.accessStatus === "SUSPENDED").length,
    REMOVED: users.filter((user) => user.accessStatus === "REMOVED").length,
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 max-w-3xl">
          <p className="text-eyebrow font-semibold text-clay uppercase">
            系統管理
          </p>
          <h1 className="mt-2 font-serif text-display font-semibold text-ink">
            使用者管理
          </h1>
          <p className="mt-3 text-caption leading-7 text-ink-soft sm:text-base">
            查看目前使用這個 VowBook 環境的帳號、最近登入與婚宴成員關係。停權或移除只會撤銷登入權限，會保留婚宴資料與成員紀錄，之後可以恢復。
          </p>
        </div>
        <span className="w-fit rounded-full border border-clay/30 bg-clay-soft px-3 py-1.5 text-sm font-semibold text-clay-strong">
          註冊仍為開放
        </span>
      </div>

      <section aria-label="使用者狀態摘要" className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-card border border-line bg-surface px-4 py-4 shadow-card">
          <p className="text-sm text-ink-soft">全部帳號</p>
          <strong className="mt-1 block font-serif text-2xl text-ink">共 {users.length} 位</strong>
        </div>
        <div className="rounded-card border border-clay/25 bg-clay-soft px-4 py-4">
          <p className="text-sm text-clay-strong">使用中</p>
          <strong className="mt-1 block font-serif text-2xl text-clay-strong">{counts.ACTIVE}</strong>
        </div>
        <div className="rounded-card border border-caution/25 bg-caution-soft px-4 py-4">
          <p className="text-sm text-caution">已停權</p>
          <strong className="mt-1 block font-serif text-2xl text-caution">{counts.SUSPENDED}</strong>
        </div>
        <div className="rounded-card border border-danger/25 bg-danger-soft px-4 py-4">
          <p className="text-sm text-danger">已移除</p>
          <strong className="mt-1 block font-serif text-2xl text-danger">{counts.REMOVED}</strong>
        </div>
      </section>

      <SystemUserList
        users={users.map((user) => ({
          ...user,
          createdAt: user.createdAt.toISOString(),
          lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
          accessStatusChangedAt:
            user.accessStatusChangedAt?.toISOString() ?? null,
        }))}
      />
    </main>
  );
}
