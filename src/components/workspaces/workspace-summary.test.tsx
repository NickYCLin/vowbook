import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceSummary } from "./workspace-summary";

describe("WorkspaceSummary", () => {
  it("lets a legal long unbroken workspace name wrap instead of clipping", () => {
    const longName = "A".repeat(80);
    render(
      <WorkspaceSummary
        role="OWNER"
        workspace={{
          id: "workspace_long",
          name: longName,
          weddingDate: null,
          timezone: "Asia/Taipei",
          createdById: "user_1",
          createdAt: new Date("2026-07-22T00:00:00.000Z"),
          updatedAt: new Date("2026-07-22T00:00:00.000Z"),
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: longName })).toHaveClass(
      "min-w-0",
      "break-words",
    );
  });

  it("keeps module entry root-relative, leads with the wedding date, and omits timezone noise", () => {
    render(
      <WorkspaceSummary
        role="OWNER"
        workspace={{
          id: "workspace_1",
          name: "我們的婚宴",
          weddingDate: new Date("2027-05-20T00:00:00.000Z"),
          timezone: "Asia/Taipei",
          createdById: "user_1",
          createdAt: new Date("2026-07-22T00:00:00.000Z"),
          updatedAt: new Date("2026-07-22T00:00:00.000Z"),
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "開啟賓客名單" })).toHaveAttribute(
      "href",
      "/workspaces/workspace_1/guests",
    );
    expect(screen.getByRole("link", { name: "安排桌次" })).toHaveAttribute(
      "href",
      "/workspaces/workspace_1/tables",
    );
    expect(screen.getByRole("link", { name: "婚宴任務" })).toHaveAttribute(
      "href",
      "/workspaces/workspace_1/tasks",
    );
    expect(
      screen.getByRole("link", { name: "管理婚禮花費" }),
    ).toHaveAttribute("href", "/workspaces/workspace_1/budget");
    expect(
      screen.getByRole("link", { name: "婚禮工作人員" }),
    ).toHaveAttribute("href", "/workspaces/workspace_1/staff");
    expect(
      screen.getByRole("link", { name: "婚禮總流程" }),
    ).toHaveAttribute("href", "/workspaces/workspace_1/timeline");
    expect(
      screen.getByRole("link", { name: "分享與協作" }),
    ).toHaveAttribute("href", "/workspaces/workspace_1/members");
    expect(screen.getByRole("link", { name: "安排桌次" })).not.toHaveAttribute(
      "href",
      expect.stringContaining("/VowBook/VowBook"),
    );
    expect(screen.getByRole("link", { name: "婚宴任務" })).not.toHaveAttribute(
      "href",
      expect.stringContaining("/VowBook/VowBook"),
    );
    expect(
      screen.getByRole("link", { name: "管理婚禮花費" }),
    ).not.toHaveAttribute(
      "href",
      expect.stringContaining("/VowBook/VowBook"),
    );
    expect(screen.queryByText(/時區/u)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "編輯 我們的婚宴" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "永久刪除 我們的婚宴" }),
    ).toBeInTheDocument();

    // 卡片以「婚宴名稱 → 婚期 → 統計 → 功能入口」的順序閱讀，
    // 婚期屬於辨識這張卡片的資訊，應該排在功能入口之前。
    const firstModuleLink = screen.getByRole("link", {
      name: "開啟賓客名單",
    });
    const weddingDate = screen.getByText(/2027年5月20日/u);
    expect(
      weddingDate.compareDocumentPosition(firstModuleLink) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders module stats and a wedding-day countdown when overview data is supplied", () => {
    render(
      <WorkspaceSummary
        role="OWNER"
        now={new Date("2027-05-01T00:00:00.000Z")}
        workspace={{
          id: "workspace_stats",
          name: "有統計的婚宴",
          weddingDate: new Date("2027-05-20T00:00:00.000Z"),
          timezone: "Asia/Taipei",
          createdById: "user_1",
          createdAt: new Date("2026-07-22T00:00:00.000Z"),
          updatedAt: new Date("2026-07-22T00:00:00.000Z"),
        }}
        stats={{
          guestTotal: 168,
          guestResponded: 92,
          guestAttending: 80,
          attendingHeadcount: 140,
          tableTotal: 15,
          taskTotal: 20,
          taskDone: 12,
          budgetPlanned: 500_000,
          budgetActual: 340_000,
        }}
      />,
    );

    expect(screen.getByText("還有 19 天")).toBeInTheDocument();
    expect(screen.getByText("一般賓客")).toBeInTheDocument();
    expect(screen.getByText("宴席人數")).toBeInTheDocument();
    expect(screen.getByText("168")).toBeInTheDocument();
    expect(screen.getByText("已回覆 92")).toBeInTheDocument();
    expect(screen.getByText("12/20")).toBeInTheDocument();
    expect(screen.getByText("68%")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "有統計的婚宴 花費執行率" }),
    ).toHaveAttribute("aria-valuenow", "68");
  });

  it("uses a read-only collaboration label for non-owner members", () => {
    render(
      <WorkspaceSummary
        role="PARTNER"
        workspace={{
          id: "workspace_shared",
          name: "共同婚宴",
          weddingDate: null,
          timezone: "Asia/Taipei",
          createdById: "owner_1",
          createdAt: new Date("2026-07-22T00:00:00.000Z"),
          updatedAt: new Date("2026-07-22T00:00:00.000Z"),
        }}
      />,
    );

    expect(
      screen.getByRole("link", { name: "查看協作者" }),
    ).toHaveAttribute("href", "/workspaces/workspace_shared/members");
    expect(
      screen.queryByRole("link", { name: "分享與協作" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /編輯 共同婚宴/u }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /永久刪除 共同婚宴/u }),
    ).not.toBeInTheDocument();
  });
});
