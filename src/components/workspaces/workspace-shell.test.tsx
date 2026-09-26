import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspacePageHeader } from "./workspace-shell";

const links = [
  ["總覽", "/workspaces/workspace_synthetic/overview", "bar"],
  ["賓客", "/workspaces/workspace_synthetic/guests", "bar"],
  ["桌次", "/workspaces/workspace_synthetic/tables", "panel"],
  ["報到", "/workspaces/workspace_synthetic/check-in", "panel"],
  ["禮金", "/workspaces/workspace_synthetic/gifts", "panel"],
  ["任務", "/workspaces/workspace_synthetic/tasks", "bar"],
  ["花費", "/workspaces/workspace_synthetic/budget", "bar"],
  ["工作人員", "/workspaces/workspace_synthetic/staff", "panel"],
  ["總流程", "/workspaces/workspace_synthetic/timeline", "panel"],
  ["協作者", "/workspaces/workspace_synthetic/members", "panel"],
] as const;

describe("WorkspacePageHeader", () => {
  it("renders the shared basePath-safe workspace navigation with a non-color current state", () => {
    render(
      <WorkspacePageHeader
        workspaceId="workspace_synthetic"
        workspaceName="合成婚宴"
        sectionTitle="賓客名單"
        description="合成頁面說明"
        activeSection="guests"
        readOnlyNotice="這是合成唯讀提示。"
      />,
    );

    // H1 只留功能名；工作區名稱是脈絡小標，長名稱才不會擠掉手機首屏。
    expect(
      screen.getByRole("heading", { level: 1, name: "賓客名單" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("合成婚宴")).toHaveClass("truncate");
    expect(screen.getByText("合成頁面說明")).toHaveClass("text-ink-soft");
    expect(screen.getByText("這是合成唯讀提示。")).toHaveClass("text-ink-soft");
    expect(screen.getByRole("link", { name: "返回所有婚宴" })).toHaveAttribute(
      "href",
      "/dashboard",
    );

    const navigation = screen.getByRole("navigation", {
      name: "工作區功能",
    });

    // 十個功能連結只渲染一份 DOM：桌機排成頁籤列，手機依 placement 放進底部功能列或「更多」面板。
    for (const [name, href, placement] of links) {
      const link = within(navigation).getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveClass("min-h-11");
      expect(link).toHaveClass("shrink-0");
      expect(link).toHaveAttribute("data-workspace-nav-placement", placement);
      expect(link).toHaveAttribute("data-workspace-prefetch", "disabled");
      expect(link).not.toHaveAttribute(
        "href",
        expect.stringContaining("/VowBook/VowBook"),
      );
    }
    expect(within(navigation).getAllByRole("link")).toHaveLength(links.length);

    const current = within(navigation).getByRole("link", { name: "賓客" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveClass("md:border-b-2", "md:border-clay");
    expect(
      within(navigation).getByRole("link", { name: "桌次" }),
    ).not.toHaveAttribute("aria-current");

    expect(navigation).toHaveClass("md:overflow-x-auto");
    const list = navigation.querySelector("[data-workspace-nav-list]");
    expect(list).toHaveClass(
      "md:flex-nowrap",
      "md:w-max",
      "md:min-w-full",
      "max-md:grid",
      "max-md:grid-cols-5",
    );
    expect(navigation.querySelector("[data-workspace-nav-bar]")).toHaveClass(
      "max-md:fixed",
      "max-md:bottom-0",
      "max-md:pb-[env(safe-area-inset-bottom)]",
    );
    const navigationHints = navigation.querySelectorAll(
      "[data-workspace-navigation-hint]",
    );
    expect(navigationHints).toHaveLength(links.length);
    for (const hint of navigationHints) {
      expect(hint).toHaveClass("size-1.5", "opacity-0");
    }
  });

  it("opens and closes the mobile 更多 panel for the secondary sections", () => {
    render(
      <WorkspacePageHeader
        workspaceId="workspace_synthetic"
        workspaceName="合成婚宴"
        sectionTitle="賓客名單"
        description="合成頁面說明"
        activeSection="guests"
      />,
    );
    const navigation = screen.getByRole("navigation", { name: "工作區功能" });
    const more = within(navigation).getByRole("button", { name: "更多" });
    const panel = navigation.querySelector("[data-workspace-more-panel]");

    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveClass("md:hidden");
    expect(more).not.toHaveAttribute("aria-current");
    expect(panel).toHaveAttribute("id", more.getAttribute("aria-controls"));
    expect(panel).toHaveClass("max-md:hidden", "md:contents");
    expect(
      within(panel as HTMLElement).getAllByRole("link").map((link) => link.textContent),
    ).toEqual(["桌次", "報到", "禮金", "工作人員", "總流程", "協作者"]);
    expect(navigation.querySelector("[data-workspace-more-backdrop]")).toBeNull();

    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveClass("max-md:grid");
    expect(panel).not.toHaveClass("max-md:hidden");
    expect(
      screen.getByRole("button", { name: "收合更多功能" }),
    ).toHaveClass("fixed", "md:hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveFocus();

    // 從面板點功能會立刻收合面板，並把該頁標成進行中。
    fireEvent.click(more);
    const giftsLink = within(navigation).getByRole("link", { name: "禮金" });
    giftsLink.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(giftsLink, { button: 0 });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(giftsLink).toHaveAttribute("aria-current", "page");
    expect(more).toHaveAttribute("aria-current", "true");
  });

  it("marks the 更多 tab as current when the active section lives inside the panel", () => {
    render(
      <WorkspacePageHeader
        workspaceId="workspace_synthetic"
        workspaceName="合成婚宴"
        sectionTitle="賓客報到"
        description="合成頁面說明"
        activeSection="check-in"
      />,
    );
    const navigation = screen.getByRole("navigation", { name: "工作區功能" });
    expect(
      within(navigation).getByRole("button", { name: "更多" }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      within(navigation).getByRole("link", { name: "報到" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("marks the requested tab immediately while its route is loading", () => {
    const props = {
      workspaceId: "workspace_synthetic",
      workspaceName: "合成婚宴",
      sectionTitle: "賓客名單",
      description: "合成頁面說明",
    } as const;
    const { rerender } = render(
      <WorkspacePageHeader {...props} activeSection="guests" />,
    );
    const navigation = screen.getByRole("navigation", {
      name: "工作區功能",
    });
    const guestsLink = within(navigation).getByRole("link", { name: "賓客" });
    const tablesLink = within(navigation).getByRole("link", { name: "桌次" });
    tablesLink.addEventListener("click", (event) => event.preventDefault());

    fireEvent.click(tablesLink, { button: 0 });

    expect(navigation).toHaveAttribute("aria-busy", "true");
    expect(tablesLink).toHaveAttribute("aria-current", "page");
    expect(tablesLink).toHaveAttribute("data-workspace-pending", "true");
    expect(guestsLink).not.toHaveAttribute("aria-current");

    rerender(
      <WorkspacePageHeader
        {...props}
        sectionTitle="桌次安排"
        activeSection="tables"
      />,
    );

    expect(navigation).toHaveAttribute("aria-busy", "false");
    expect(tablesLink).not.toHaveAttribute("data-workspace-pending");
  });

  it("brings the active tab into the horizontal viewport after route changes", () => {
    const props = {
      workspaceId: "workspace_synthetic",
      workspaceName: "合成婚宴",
      sectionTitle: "賓客名單",
      description: "合成頁面說明",
    } as const;
    const { rerender } = render(
      <WorkspacePageHeader {...props} activeSection="guests" />,
    );
    const navigation = screen.getByRole("navigation", {
      name: "工作區功能",
    });
    const timelineLink = within(navigation).getByRole("link", {
      name: "總流程",
    });
    navigation.scrollLeft = 0;
    navigation.getBoundingClientRect = () =>
      ({ left: 0, right: 300 } as DOMRect);
    timelineLink.getBoundingClientRect = () =>
      ({ left: 400, right: 480 } as DOMRect);

    rerender(
      <WorkspacePageHeader
        {...props}
        sectionTitle="總流程"
        activeSection="timeline"
      />,
    );

    expect(navigation.scrollLeft).toBe(180);
    expect(timelineLink).toHaveAttribute("aria-current", "page");
  });
});
