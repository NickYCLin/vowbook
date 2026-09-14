"use client";

import { CaretLeft, DotsThreeCircle } from "@phosphor-icons/react/dist/ssr";
import Link, { useLinkStatus } from "next/link";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "@/lib/class-names";
import { revealActiveWorkspaceNavigationItem } from "@/lib/workspace-navigation";
import {
  workspaceSectionHref,
  workspaceSections,
  type WorkspaceSection,
  type WorkspaceSectionDefinition,
} from "./workspace-sections";

export type { WorkspaceSection } from "./workspace-sections";

const primarySections = workspaceSections.filter(
  (section) => section.primaryOnMobile,
);
const secondarySections = workspaceSections.filter(
  (section) => !section.primaryOnMobile,
);

function WorkspaceNavigationHint() {
  const { pending } = useLinkStatus();

  return (
    <span
      data-workspace-navigation-hint
      aria-hidden="true"
      className={`size-1.5 shrink-0 rounded-full bg-current transition-opacity max-md:hidden ${pending ? "opacity-70 motion-safe:animate-pulse" : "opacity-0"}`}
    />
  );
}

/**
 * 同一顆連結同時服務兩種版型：
 * - md 以上是桌機的橫向頁籤（文字 + 底線）。
 * - md 以下是手機底部功能列的格子，或「更多」面板裡的磚（圖示 + 小字）。
 * 只渲染一份 DOM，才不會讓輔助科技與測試看到重複的功能連結。
 */
function WorkspaceNavigationLink({
  workspaceId,
  section,
  isCurrent,
  isDisplayedCurrent,
  isPending,
  placement,
  activeLinkRef,
  onNavigate,
}: {
  workspaceId: string;
  section: WorkspaceSectionDefinition;
  isCurrent: boolean;
  isDisplayedCurrent: boolean;
  isPending: boolean;
  placement: "bar" | "panel";
  activeLinkRef: RefObject<HTMLAnchorElement | null>;
  onNavigate: (section: WorkspaceSection) => void;
}) {
  const Icon = section.icon;

  return (
    <Link
      ref={isCurrent ? activeLinkRef : undefined}
      href={workspaceSectionHref(workspaceId, section)}
      prefetch={false}
      data-workspace-prefetch="disabled"
      data-workspace-nav-placement={placement}
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
        onNavigate(section.key);
      }}
      aria-current={isDisplayedCurrent ? "page" : undefined}
      className={cn(
        "min-h-11 shrink-0 transition",
        // 桌機頁籤：目前分頁不只靠顏色區分，另外用底線加粗表示。
        "md:-mb-px md:inline-flex md:items-center md:justify-center md:gap-1.5 md:rounded-t-control md:border-b-2 md:px-3.5 md:text-sm md:whitespace-nowrap",
        isDisplayedCurrent
          ? "md:border-clay md:font-semibold md:text-clay-strong"
          : "md:border-transparent md:font-medium md:text-ink-soft md:hover:bg-clay-soft/60 md:hover:text-ink",
        // 手機：圖示在上、標籤在下，維持 44px 以上的觸控高度。
        "max-md:flex max-md:flex-col max-md:items-center max-md:justify-center max-md:gap-1 max-md:text-[0.6875rem] max-md:leading-none max-md:font-medium",
        placement === "bar"
          ? "max-md:min-h-14 max-md:px-1"
          : "max-md:min-h-[4.5rem] max-md:rounded-control max-md:border max-md:px-2",
        placement === "panel" &&
          (isDisplayedCurrent
            ? "max-md:border-clay max-md:bg-clay-soft"
            : "max-md:border-line max-md:bg-surface"),
        isDisplayedCurrent
          ? "max-md:font-semibold max-md:text-clay-strong"
          : "max-md:text-ink-soft",
      )}
    >
      <Icon
        aria-hidden="true"
        weight={isDisplayedCurrent ? "fill" : "regular"}
        className="size-[1.375rem] shrink-0 md:hidden"
      />
      <span>{section.label}</span>
      <WorkspaceNavigationHint />
    </Link>
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
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const morePanelId = useId();
  const [pendingSection, setPendingSection] = useState<WorkspaceSection | null>(null);
  // 記住面板是在哪一頁打開的：路由一換，面板自然就算收起，不必靠 effect 重設。
  const [moreOpenedForSection, setMoreOpenedForSection] =
    useState<WorkspaceSection | null>(null);
  const isMoreOpen = moreOpenedForSection === activeSection;
  const setIsMoreOpen = (open: boolean) =>
    setMoreOpenedForSection(open ? activeSection : null);
  const effectivePendingSection =
    pendingSection === activeSection ? null : pendingSection;
  const displayedSection = effectivePendingSection ?? activeSection;
  const isMoreSectionDisplayed = secondarySections.some(
    (section) => section.key === displayedSection,
  );

  useLayoutEffect(() => {
    const navigation = navigationRef.current;
    const activeLink = activeLinkRef.current;
    if (!navigation || !activeLink) return;

    revealActiveWorkspaceNavigationItem(navigation, activeLink);
  }, [activeSection]);

  useEffect(() => {
    if (!isMoreOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMoreOpenedForSection(null);
      moreButtonRef.current?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMoreOpen]);

  const handleNavigate = (section: WorkspaceSection) => {
    setPendingSection(section === activeSection ? null : section);
    setIsMoreOpen(false);
  };

  const renderLink = (
    section: WorkspaceSectionDefinition,
    placement: "bar" | "panel",
  ) => (
    <WorkspaceNavigationLink
      key={section.key}
      workspaceId={workspaceId}
      section={section}
      isCurrent={activeSection === section.key}
      isDisplayedCurrent={displayedSection === section.key}
      isPending={effectivePendingSection === section.key}
      placement={placement}
      activeLinkRef={activeLinkRef}
      onNavigate={handleNavigate}
    />
  );

  return (
    <nav
      ref={navigationRef}
      aria-label="工作區功能"
      aria-busy={effectivePendingSection ? "true" : "false"}
      data-workspace-nav
      data-workspace-more-open={isMoreOpen ? "true" : undefined}
      className="relative min-w-0 md:mt-3 md:overflow-x-auto md:border-b md:border-line md:[scrollbar-width:none] md:[&::-webkit-scrollbar]:hidden"
    >
      {/* 手機「更多」面板打開時的遮罩：點一下就收合。桌機沒有面板，不渲染。 */}
      {isMoreOpen ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="收合更多功能"
          data-workspace-more-backdrop
          onClick={() => setIsMoreOpen(false)}
          className="fixed inset-0 z-40 bg-[var(--vowbook-dialog-backdrop)] md:hidden print:hidden"
        />
      ) : null}
      <div
        data-workspace-nav-bar
        className="max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:border-t max-md:border-line max-md:bg-surface/95 max-md:pb-[env(safe-area-inset-bottom)] max-md:shadow-[0_-8px_24px_-20px_rgba(83,62,45,0.5)] max-md:backdrop-blur-md max-md:print:hidden"
      >
        <div
          data-workspace-nav-list
          className="max-md:grid max-md:grid-cols-5 md:flex md:w-max md:min-w-full md:flex-nowrap md:gap-x-1"
        >
          {primarySections.map((section) => renderLink(section, "bar"))}
          <button
            ref={moreButtonRef}
            type="button"
            data-workspace-more
            aria-expanded={isMoreOpen}
            aria-controls={morePanelId}
            aria-current={isMoreSectionDisplayed ? "true" : undefined}
            onClick={() => setIsMoreOpen(!isMoreOpen)}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-[0.6875rem] leading-none font-medium transition md:hidden",
              isMoreSectionDisplayed || isMoreOpen
                ? "font-semibold text-clay-strong"
                : "text-ink-soft",
            )}
          >
            <DotsThreeCircle
              aria-hidden="true"
              weight={isMoreSectionDisplayed || isMoreOpen ? "fill" : "regular"}
              className="size-[1.375rem] shrink-0"
            />
            <span>更多</span>
          </button>
          <div
            id={morePanelId}
            data-workspace-more-panel
            className={cn(
              // 桌機：面板不存在，裡面的連結直接排進頁籤列。
              "md:contents",
              // 手機：面板貼在功能列上方，格子磚狀排列。
              "max-md:absolute max-md:inset-x-0 max-md:bottom-full max-md:z-40 max-md:grid-cols-3 max-md:gap-2 max-md:rounded-t-card max-md:border-t max-md:border-line max-md:bg-surface max-md:p-4 max-md:shadow-overlay",
              isMoreOpen ? "max-md:grid" : "max-md:hidden",
            )}
          >
            {secondarySections.map((section) => renderLink(section, "panel"))}
          </div>
        </div>
      </div>
      {effectivePendingSection ? (
        <span
          data-workspace-navigation-progress
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-clay motion-safe:animate-pulse max-md:hidden"
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
        className="-ml-1.5 inline-flex min-h-11 items-center gap-1 rounded-control px-1.5 text-caption font-semibold text-ink-soft transition hover:text-clay-strong"
      >
        <CaretLeft aria-hidden="true" weight="bold" className="size-3.5" />
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
            : "flex min-w-0 items-start justify-between gap-3 py-4 sm:gap-6 sm:py-5"
        }
      >
        <div className="min-w-0 max-w-3xl flex-1">
          {/* 工作區名稱是脈絡而不是頁面標題：放成小標，H1 只留功能名，手機才不會被長名稱吃掉整個首屏。 */}
          <p
            data-workspace-name
            title={workspaceName}
            className="truncate text-caption font-medium text-ink-faint sm:text-eyebrow sm:font-semibold sm:tracking-[0.12em] sm:text-clay"
          >
            {workspaceName}
          </p>
          <h1 className="mt-0.5 min-w-0 break-words font-serif text-2xl leading-tight font-semibold text-ink sm:mt-1.5 sm:text-3xl">
            {sectionTitle}
          </h1>
          <p className="mt-1.5 max-w-2xl text-caption leading-6 text-ink-soft sm:mt-2 sm:text-base sm:leading-7">
            {description}
          </p>
          {!compactIntro && readOnlyNotice && (
            <p className="mt-3 rounded-control border border-line bg-surface-sunken px-3.5 py-2.5 text-caption leading-6 text-ink-soft">
              {readOnlyNotice}
            </p>
          )}
        </div>
        {actions && (
          <div className="shrink-0 pt-5 sm:pt-6">{actions}</div>
        )}
      </header>
      {compactIntro && readOnlyNotice && (
        <p className="rounded-control border border-line bg-surface-sunken px-3.5 py-2.5 text-caption leading-6 text-ink-soft">
          {readOnlyNotice}
        </p>
      )}
    </>
  );
}
