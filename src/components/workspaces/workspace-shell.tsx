"use client";

import Link, { useLinkStatus } from "next/link";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { revealActiveWorkspaceNavigationItem } from "@/lib/workspace-navigation";

export type WorkspaceSection =
  | "guests"
  | "tables"
  | "tasks"
  | "budget"
  | "staff"
  | "timeline"
  | "members";

const workspaceSections: {
  key: WorkspaceSection;
  label: string;
  segment: string;
}[] = [
  { key: "guests", label: "賓客", segment: "guests" },
  { key: "tables", label: "桌次", segment: "tables" },
  { key: "tasks", label: "任務", segment: "tasks" },
  { key: "budget", label: "花費", segment: "budget" },
  { key: "staff", label: "工作人員", segment: "staff" },
  { key: "timeline", label: "總流程", segment: "timeline" },
  { key: "members", label: "協作者", segment: "members" },
];

function WorkspaceNavigationHint() {
  const { pending } = useLinkStatus();

  return (
    <span
      data-workspace-navigation-hint
      aria-hidden="true"
      className={`size-1.5 shrink-0 rounded-full bg-current transition-opacity ${pending ? "opacity-70 motion-safe:animate-pulse" : "opacity-0"}`}
    />
  );
}

export function WorkspaceNavigation({
  workspaceId,
  activeSection,
}: {
  workspaceId: string;
  activeSection: WorkspaceSection;
}) {
  const navigationRef = useRef<HTMLElement>(null);
  const activeLinkRef = useRef<HTMLAnchorElement>(null);
  const [pendingSection, setPendingSection] = useState<WorkspaceSection | null>(null);
  const effectivePendingSection =
    pendingSection === activeSection ? null : pendingSection;

  useLayoutEffect(() => {
    const navigation = navigationRef.current;
    const activeLink = activeLinkRef.current;
    if (!navigation || !activeLink) return;

    revealActiveWorkspaceNavigationItem(navigation, activeLink);
  }, [activeSection]);

  return (
    <nav
      ref={navigationRef}
      aria-label="工作區功能"
      aria-busy={effectivePendingSection ? "true" : "false"}
      className="relative mt-3 min-w-0 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex w-max min-w-full flex-nowrap gap-x-1">
        {workspaceSections.map((section) => {
          const isCurrent = activeSection === section.key;
          const isDisplayedCurrent =
            (effectivePendingSection ?? activeSection) === section.key;
          const isPending = effectivePendingSection === section.key;

          return (
            <Link
              ref={isCurrent ? activeLinkRef : undefined}
              key={section.key}
              href={`/workspaces/${workspaceId}/${section.segment}`}
              prefetch={true}
              data-workspace-prefetch="full"
              data-workspace-pending={isPending ? "true" : undefined}
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return;
                }
                setPendingSection(isCurrent ? null : section.key);
              }}
              aria-current={isDisplayedCurrent ? "page" : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-t-control px-3.5 text-sm whitespace-nowrap transition ${
                isDisplayedCurrent
                  ? // 目前分頁不只靠顏色區分，另外用底線加粗表示
                    "-mb-px border-b-2 border-clay font-semibold text-clay-strong"
                  : "-mb-px border-b-2 border-transparent font-medium text-ink-soft hover:bg-clay-soft/60 hover:text-ink"
              }`}
            >
              <span>{section.label}</span>
              <WorkspaceNavigationHint />
            </Link>
          );
        })}
      </div>
      {effectivePendingSection ? (
        <span
          data-workspace-navigation-progress
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-clay motion-safe:animate-pulse"
        />
      ) : null}
    </nav>
  );
}

export function WorkspacePageHeader({
  workspaceId,
  workspaceName,
  sectionTitle,
  description,
  activeSection,
  readOnlyNotice,
  compactIntro = false,
  actions,
}: {
  workspaceId: string;
  workspaceName: string;
  sectionTitle: string;
  description: string;
  activeSection: WorkspaceSection;
  readOnlyNotice?: string;
  compactIntro?: boolean;
  /** 該頁的主要動作，例如「新增賓客」。放在標題右側，不必捲到頁尾。 */
  actions?: ReactNode;
}) {
  return (
    <>
      <Link
        href="/dashboard"
        className="inline-flex min-h-11 items-center gap-1.5 text-caption font-semibold text-ink-soft transition hover:text-clay-strong"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-3.5"
        >
          <path d="M10 3L5 8l5 5" />
        </svg>
        返回我的婚宴
      </Link>

      <WorkspaceNavigation
        workspaceId={workspaceId}
        activeSection={activeSection}
      />

      <header
        data-workspace-header="compact"
        className={
          compactIntro
            ? "sr-only"
            : "flex min-w-0 flex-col gap-4 py-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
        }
      >
        <div className="min-w-0 max-w-3xl">
          <h1 className="min-w-0 break-words font-serif text-2xl leading-tight font-semibold text-ink sm:text-3xl">
            <span className="font-normal text-ink-faint">
              {workspaceName}・
            </span>
            {sectionTitle}
          </h1>
          <p className="mt-2 max-w-2xl text-caption leading-6 text-ink-soft sm:text-base sm:leading-7">
            {description}
          </p>
          {!compactIntro && readOnlyNotice && (
            <p className="mt-3 rounded-control border border-line bg-surface-sunken px-3.5 py-2.5 text-caption leading-6 text-ink-soft">
              {readOnlyNotice}
            </p>
          )}
        </div>
        {actions && <div className="shrink-0 sm:pt-1">{actions}</div>}
      </header>
      {compactIntro && readOnlyNotice && (
        <p className="rounded-control border border-line bg-surface-sunken px-3.5 py-2.5 text-caption leading-6 text-ink-soft">
          {readOnlyNotice}
        </p>
      )}
    </>
  );
}
