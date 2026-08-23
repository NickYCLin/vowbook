"use client";

import type { MembershipRole, UserAccessStatus } from "@prisma/client";
import { useActionState, useMemo, useState } from "react";
import {
  type SystemUserMutationState,
  updateSystemUserAccessAction,
} from "@/actions/admin-users";
import { cn } from "@/lib/class-names";

export type SystemUserRow = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  accessStatus: UserAccessStatus;
  accessStatusChangedAt: string | null;
  lastLoginAt: string | null;
  version: number;
  createdAt: string;
  systemAdmin: boolean;
  memberships: Array<{
    role: MembershipRole;
    workspace: { id: string; name: string };
  }>;
};

const statusLabels: Record<UserAccessStatus, string> = {
  ACTIVE: "使用中",
  SUSPENDED: "已停權",
  REMOVED: "已移除",
};

const statusClasses: Record<UserAccessStatus, string> = {
  ACTIVE: "border-clay/30 bg-clay-soft text-clay-strong",
  SUSPENDED: "border-caution/30 bg-caution-soft text-caution",
  REMOVED: "border-danger/30 bg-danger-soft text-danger",
};

const roleLabels: Record<MembershipRole, string> = {
  OWNER: "擁有者",
  PARTNER: "伴侶",
  PLANNER: "婚顧",
  VIEWER: "檢視者",
};

const dateFormatter = new Intl.DateTimeFormat("zh-TW", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Taipei",
});

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

function UserAccessControls({ user }: { user: SystemUserRow }) {
  const initialState: SystemUserMutationState = { status: "idle" };
  const [state, formAction, pending] = useActionState(
    updateSystemUserAccessAction,
    initialState,
  );

  if (user.systemAdmin) {
    return (
      <p className="text-sm leading-6 text-ink-faint">
        系統管理者受到保護，不能在這裡停權或移除。
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="targetUserId" value={user.id} />
      <input type="hidden" name="expectedVersion" value={user.version} />
      <div className="flex flex-wrap gap-2">
        {user.accessStatus === "ACTIVE" ? (
          <button
            type="submit"
            name="accessStatus"
            value="SUSPENDED"
            disabled={pending}
            className="min-h-11 rounded-full border border-caution/40 px-4 py-2 text-sm font-semibold text-caution transition hover:bg-caution-soft disabled:cursor-wait disabled:opacity-60"
          >
            暫停使用
          </button>
        ) : (
          <button
            type="submit"
            name="accessStatus"
            value="ACTIVE"
            disabled={pending}
            className="min-h-11 rounded-full border border-clay px-4 py-2 text-sm font-semibold text-clay-strong transition hover:bg-clay-soft disabled:cursor-wait disabled:opacity-60"
          >
            恢復登入權限
          </button>
        )}
      </div>

      {user.accessStatus !== "REMOVED" ? (
        <details className="rounded-control border border-danger/30 bg-danger-soft px-3.5 py-3 text-danger">
          <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-semibold [&::-webkit-details-marker]:hidden">
            移除登入權限
          </summary>
          <p className="mt-1 text-sm leading-6">
            對方會立刻無法登入；婚宴資料與成員紀錄會保留，之後仍可恢復。
          </p>
          <button
            type="submit"
            name="accessStatus"
            value="REMOVED"
            disabled={pending}
            className="mt-3 min-h-11 rounded-full border border-danger px-4 py-2 text-sm font-semibold transition hover:bg-surface disabled:cursor-wait disabled:opacity-60"
          >
            確認移除登入權限
          </button>
        </details>
      ) : null}

      <p
        aria-live="polite"
        className={cn(
          "min-h-5 text-sm",
          state.status === "error" ? "text-danger" : "text-ink-soft",
        )}
      >
        {pending ? "正在更新…" : state.message ?? ""}
      </p>
    </form>
  );
}

function UserCard({ user }: { user: SystemUserRow }) {
  const displayName = user.name?.trim() || "未設定姓名";

  return (
    <article className="min-w-0 rounded-card border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="flex min-w-0 flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(14rem,0.8fr)] lg:items-start lg:gap-6">
        <section className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="min-w-0 break-words font-serif text-xl font-semibold text-ink">
              {displayName}
            </h2>
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-semibold",
                statusClasses[user.accessStatus],
              )}
            >
              {statusLabels[user.accessStatus]}
            </span>
            {user.systemAdmin ? (
              <span className="rounded-full border border-line bg-surface-sunken px-2.5 py-1 text-xs font-semibold text-ink-soft">
                系統管理者
              </span>
            ) : null}
          </div>
          <p className="mt-1 break-all text-sm text-ink-soft">{user.email}</p>
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
                註冊時間
              </dt>
              <dd className="mt-1 text-ink-soft">{formatDate(user.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
                最近登入
              </dt>
              <dd className="mt-1 text-ink-soft">
                {user.lastLoginAt ? formatDate(user.lastLoginAt) : "尚無登入紀錄"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="min-w-0 border-t border-line pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <h3 className="text-sm font-semibold text-ink">婚宴工作區</h3>
          {user.memberships.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {user.memberships.map((membership) => (
                <li
                  key={`${membership.workspace.id}-${membership.role}`}
                  className="min-w-0 rounded-control bg-surface-sunken px-3 py-2 text-sm"
                >
                  <span className="block break-words font-semibold text-ink">
                    {membership.workspace.name}
                  </span>
                  <span className="text-ink-soft">{roleLabels[membership.role]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm leading-6 text-ink-faint">
              尚未加入婚宴工作區
            </p>
          )}
        </section>

        <section className="min-w-0 border-t border-line pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <h3 className="mb-2 text-sm font-semibold text-ink">帳號權限</h3>
          <UserAccessControls user={user} />
        </section>
      </div>
    </article>
  );
}

export function SystemUserList({ users }: { users: SystemUserRow[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"ALL" | UserAccessStatus>("ALL");
  const visibleUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-TW");
    return users.filter((user) => {
      if (status !== "ALL" && user.accessStatus !== status) return false;
      if (!normalizedQuery) return true;
      return [
        user.name ?? "",
        user.email,
        ...user.memberships.map((membership) => membership.workspace.name),
      ].some((value) =>
        value.toLocaleLowerCase("zh-TW").includes(normalizedQuery),
      );
    });
  }, [query, status, users]);

  return (
    <section aria-labelledby="user-list-heading" className="mt-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="user-list-heading" className="font-serif text-2xl font-semibold">
            帳號清單
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            顯示 {visibleUsers.length}／{users.length} 位
          </p>
        </div>
        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(13rem,1fr)_10rem]">
          <label className="min-w-0 text-sm font-semibold text-ink-soft">
            搜尋使用者
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="姓名、信箱或婚宴"
              className="mt-1 min-h-11 w-full min-w-0 rounded-control border border-line bg-surface px-3 text-ink outline-none focus:border-clay"
            />
          </label>
          <label className="text-sm font-semibold text-ink-soft">
            帳號狀態
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.currentTarget.value as "ALL" | UserAccessStatus)
              }
              className="mt-1 min-h-11 w-full rounded-control border border-line bg-surface px-3 text-ink outline-none focus:border-clay"
            >
              <option value="ALL">全部</option>
              <option value="ACTIVE">使用中</option>
              <option value="SUSPENDED">已停權</option>
              <option value="REMOVED">已移除</option>
            </select>
          </label>
        </div>
      </div>

      {visibleUsers.length > 0 ? (
        <div className="mt-5 grid min-w-0 gap-4">
          {visibleUsers.map((user) => (
            <UserCard key={user.id} user={user} />
          ))}
        </div>
      ) : (
        <p className="mt-5 rounded-card border border-dashed border-line bg-surface px-5 py-8 text-center text-ink-soft">
          找不到符合條件的使用者。
        </p>
      )}
    </section>
  );
}
