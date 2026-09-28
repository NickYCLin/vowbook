"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { CaretDown, Check, SquaresFour } from "@phosphor-icons/react/dist/ssr";
import { getBasePath } from "@/lib/base-path";
import { RECENT_WORKSPACE_COOKIE, recentWorkspaceValue } from "@/domain/workspace-entry";

export type WorkspaceChoice = { id: string; name: string; role: string };
const roleLabels: Record<string, string> = { OWNER: "擁有者", PARTNER: "伴侶", PLANNER: "婚顧", VIEWER: "檢視者" };

export function WorkspaceSwitcher({ userId, choices }: { userId: string; choices: WorkspaceChoice[] }) {
  const pathname = usePathname();
  const currentId = pathname.match(/\/workspaces\/([^/]+)(?:\/|$)/)?.[1];
  const current = choices.find(choice => choice.id === currentId);
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (details.current) details.current.open = false;
    if (!current || /\/(print|chart)$/.test(pathname)) return;
    document.cookie = `${RECENT_WORKSPACE_COOKIE}=${encodeURIComponent(recentWorkspaceValue(userId, current.id))}; Path=${getBasePath() || "/"}; Max-Age=2592000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }, [current, pathname, userId]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !details.current?.contains(event.target) && details.current) details.current.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  if (choices.length <= 1) return <div className="flex min-w-0 flex-1 items-center gap-3">
    {current && <Link href={`/workspaces/${current.id}/overview`} className="min-w-0 truncate text-sm font-semibold text-ink" aria-label={`${current.name}的婚宴首頁`}>{current.name}</Link>}
    <Link href="/dashboard?view=all" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-caption text-ink-soft"><SquaresFour className="size-4" aria-hidden="true"/><span>所有婚宴</span></Link>
  </div>;

  return <details ref={details} data-workspace-switcher className="relative min-w-0 flex-1" onKeyDown={event => {
    if (event.key === "Escape" && details.current?.open) { details.current.open = false; details.current.querySelector("summary")?.focus({ preventScroll: true }); }
  }}>
    <summary className="flex min-h-11 w-full cursor-pointer list-none items-center gap-2 rounded-control px-3 text-sm font-semibold hover:bg-clay-soft [&::-webkit-details-marker]:hidden" aria-label="切換婚宴">
      <span className="min-w-0 truncate">{current?.name ?? "所有婚宴"}</span><CaretDown aria-hidden="true" className="size-4 shrink-0"/>
    </summary>
    <div className="absolute left-0 top-full z-50 mt-2 w-full min-w-0 rounded-card border border-line bg-surface p-2 shadow-overlay sm:min-w-80">
      <p className="px-3 py-2 text-caption text-ink-faint">切換婚宴</p>
      <div className="max-h-72 overflow-y-auto">
        {choices.map(choice => <Link key={choice.id} href={`/workspaces/${choice.id}/overview`} prefetch={false} aria-current={choice.id === currentId ? "true" : undefined} onClick={() => { if (details.current) details.current.open = false; }} className="flex min-h-14 items-center justify-between gap-3 rounded-control px-3 py-2 hover:bg-clay-soft">
          <span className="min-w-0 break-words text-sm">{choice.name}<span className="mt-1 block text-caption text-ink-soft">{roleLabels[choice.role]}</span></span>{choice.id === currentId && <Check className="size-4 shrink-0" aria-label="目前婚宴"/>}
        </Link>)}
      </div>
      <Link href="/dashboard?view=all" onClick={() => { if (details.current) details.current.open = false; }} className="mt-2 flex min-h-11 items-center gap-2 border-t border-line px-3 pt-2 text-sm text-clay-strong"><SquaresFour aria-hidden="true" className="size-4"/>所有婚宴</Link>
    </div>
  </details>;
}
