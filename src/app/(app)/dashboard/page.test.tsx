import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireCurrentUserContext,
  listWorkspaceOverviewsForUser,
  redirect,
} = vi.hoisted(() => ({
  requireCurrentUserContext: vi.fn(),
  listWorkspaceOverviewsForUser: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ requireCurrentUserContext }));
vi.mock("@/lib/workspace-overview", () => ({ listWorkspaceOverviewsForUser }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/components/auth/invitation-accepted-notice", () => ({
  InvitationAcceptedNotice: ({ notice }: { notice: { count: number } }) => (
    <p role="status">
      {notice.count === 1
        ? "協作邀請已接受，婚宴已加入下方清單。"
        : `已接受 ${notice.count} 個協作邀請，婚宴已加入下方清單。`}
    </p>
  ),
}));
vi.mock("@/components/auth/sign-in-button", () => ({
  SignInButton: ({ label }: { label: string }) => <button>{label}</button>,
}));
vi.mock("@/components/workspaces/workspace-summary", () => ({
  WorkspaceSummary: () => <article>合成婚宴摘要</article>,
}));
vi.mock("@/components/workspaces/create-workspace-form", () => ({
  CreateWorkspaceForm: () => <form aria-label="新增婚宴表單" />,
}));
vi.mock("@/components/ui/dialog", () => ({
  useModalDialog: () => ({
    dialogRef: { current: null },
    triggerRef: { current: null },
    open: vi.fn(),
    close: vi.fn(),
    restoreFocus: vi.fn(),
  }),
  Dialog: ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <div role="dialog" aria-label={title}>
      {children}
    </div>
  ),
}));

import DashboardPage from "./page";

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUserContext.mockResolvedValue({
      currentUser: { id: "user_1" },
      invitationNotice: null,
      pendingInvitationConfirmation: false,
    });
    listWorkspaceOverviewsForUser.mockResolvedValue([
      {
        membershipId: "membership_1",
        role: "PARTNER",
        workspace: { id: "workspace_1", name: "合成婚宴" },
        stats: {
          guestTotal: 0,
          guestResponded: 0,
          guestAttending: 0,
          attendingHeadcount: 0,
          tableTotal: 0,
          taskTotal: 0,
          taskDone: 0,
          budgetPlanned: 0,
          budgetActual: 0,
        },
      },
    ]);
  });

  it("offers a modal creation entry that reuses the workspace creation form", async () => {
    render(await DashboardPage());

    // 改成 modal 之後，清單不會被展開的表單推出畫面。
    expect(
      screen.getByRole("button", { name: "新增婚宴" }),
    ).toBeInTheDocument();
    expect(document.querySelector("details")).toBeNull();
    expect(
      screen.getByRole("form", { name: "新增婚宴表單" }),
    ).toBeInTheDocument();
  });

  it("keeps deletion success feedback at dashboard level after the card is gone", async () => {
    render(
      await DashboardPage({
        searchParams: Promise.resolve({ workspaceDeleted: "1" }),
      }),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "已永久刪除婚宴工作區。",
    );
    expect(screen.getByRole("status")).toHaveFocus();
    expect(screen.getByRole("status")).not.toHaveTextContent("workspace_");
  });

  it("does not show invitation instructions when no invitation was accepted", async () => {
    render(await DashboardPage());

    expect(screen.queryByText(/協作邀請/u)).not.toBeInTheDocument();
  });

  it("shows a concise notice only after invitations were accepted", async () => {
    requireCurrentUserContext.mockResolvedValueOnce({
      currentUser: { id: "user_1" },
      invitationNotice: { id: "notice_1", count: 1 },
      pendingInvitationConfirmation: false,
    });

    render(await DashboardPage());

    expect(screen.getByRole("status")).toHaveTextContent(
      "協作邀請已接受，婚宴已加入下方清單。",
    );
    expect(screen.queryByText(/重新選擇/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/完全相同/u)).not.toBeInTheDocument();
  });

  it("shows a concise Google confirmation path only for a later pending invitation", async () => {
    requireCurrentUserContext.mockResolvedValueOnce({
      currentUser: { id: "user_1" },
      invitationNotice: null,
      pendingInvitationConfirmation: true,
    });
    listWorkspaceOverviewsForUser.mockResolvedValueOnce([]);

    render(await DashboardPage());

    expect(screen.getByRole("status")).toHaveTextContent("有新的協作邀請。");
    expect(
      screen.getByRole("button", { name: "確認並加入" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/重新選擇/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/完全相同/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/重新驗證/u)).not.toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });
});
