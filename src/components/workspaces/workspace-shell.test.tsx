import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspacePageHeader } from "./workspace-shell";

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

    expect(
      screen.getByRole("heading", { level: 1, name: "合成婚宴・賓客名單" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("合成頁面說明")).toHaveClass("text-ink-soft");
    expect(screen.getByText("這是合成唯讀提示。")).toHaveClass("text-ink-soft");
    expect(screen.getByRole("link", { name: "返回我的婚宴" })).toHaveAttribute(
      "href",
      "/dashboard",
    );

    const navigation = screen.getByRole("navigation", {
      name: "工作區功能",
    });
    const links = [
      ["賓客", "/workspaces/workspace_synthetic/guests"],
      ["桌次", "/workspaces/workspace_synthetic/tables"],
      ["任務", "/workspaces/workspace_synthetic/tasks"],
      ["花費", "/workspaces/workspace_synthetic/budget"],
      ["工作人員", "/workspaces/workspace_synthetic/staff"],
      ["總流程", "/workspaces/workspace_synthetic/timeline"],
      ["協作者", "/workspaces/workspace_synthetic/members"],
    ] as const;

    for (const [name, href] of links) {
      const link = within(navigation).getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveClass("min-h-11");
      expect(link).toHaveClass("shrink-0");
      expect(link).toHaveAttribute("data-workspace-prefetch", "full");
      expect(link).not.toHaveAttribute(
        "href",
        expect.stringContaining("/VowBook/VowBook"),
      );
    }

    const current = within(navigation).getByRole("link", { name: "賓客" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveClass("border-b-2");
    expect(
      within(navigation).getByRole("link", { name: "桌次" }),
    ).not.toHaveAttribute("aria-current");
    expect(navigation).toHaveClass("overflow-x-auto");
    expect(navigation.firstElementChild).toHaveClass(
      "flex-nowrap",
      "w-max",
      "min-w-full",
    );
    const navigationHints = navigation.querySelectorAll(
      "[data-workspace-navigation-hint]",
    );
    expect(navigationHints).toHaveLength(links.length);
    for (const hint of navigationHints) {
      expect(hint).toHaveClass("size-1.5", "opacity-0");
    }
  });

  it("marks the requested tab immediately while its prefetched route is loading", () => {
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
