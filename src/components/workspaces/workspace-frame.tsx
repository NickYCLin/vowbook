"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { WorkspaceNavigation } from "./workspace-shell";
import { workspaceSections } from "./workspace-sections";
import { WorkspaceFrameContext, WorkspaceViewStateProvider } from "./workspace-view-state";

function WorkspaceScrollRestoration({ pathname }: { pathname: string }) {
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    let restored = false;
    let frame = 0;
    const content = document.querySelector("[data-workspace-content]");
    const restore = () => {
      if (restored || content?.querySelector("[data-workspace-loading]")) return;
      window.scrollTo({ top: positions.current.get(pathname) ?? 0, behavior: "instant" });
      restored = true;
      observer.disconnect();
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(restore);
    };
    const observer = new MutationObserver(schedule);
    if (content) observer.observe(content, { childList: true, subtree: true });
    schedule();
    const save = () => {
      if (restored) positions.current.set(pathname, window.scrollY);
    };
    const cancelRestore = () => {
      restored = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      save();
    };
    window.addEventListener("scroll", save, { passive: true });
    window.addEventListener("wheel", cancelRestore, { passive: true });
    window.addEventListener("touchstart", cancelRestore, { passive: true });
    return () => {
      save();
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", save);
      window.removeEventListener("wheel", cancelRestore);
      window.removeEventListener("touchstart", cancelRestore);
    };
  }, [pathname]);
  return null;
}

export function WorkspaceFrame({ workspaceId, pathname, embedded = false, children }: {
  workspaceId: string;
  pathname: string;
  embedded?: boolean;
  children: ReactNode;
}) {
  const section = workspaceSections.find(item => pathname.includes(`/workspaces/${workspaceId}/${item.segment}`))?.key ?? "overview";
  const isDocument = /\/(print|chart)$/.test(pathname);
  return (
    <WorkspaceViewStateProvider key={workspaceId}>
      <WorkspaceFrameContext.Provider value={true}>
        <div data-workspace-frame data-workspace-document={isDocument || undefined} data-workspace-preview={embedded || undefined} className="min-w-0">
          {!isDocument && <aside data-workspace-sidebar className="print:hidden">
            <WorkspaceNavigation workspaceId={workspaceId} activeSection={section} layout="sidebar" />
            <Link href="/dashboard?view=all" className="mx-3 mb-4 hidden min-h-11 items-center rounded-control border-t border-line px-3 text-sm text-ink-soft hover:bg-clay-soft md:flex">所有婚宴</Link>
          </aside>}
          <div data-workspace-content className="min-w-0">
            {!isDocument && <WorkspaceScrollRestoration pathname={pathname} />}
            {children}
          </div>
        </div>
      </WorkspaceFrameContext.Provider>
    </WorkspaceViewStateProvider>
  );
}

export function WorkspaceLayoutClient({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return <WorkspaceFrame workspaceId={workspaceId} pathname={pathname} embedded={searchParams.get("preview") === "1"}>{children}</WorkspaceFrame>;
}
