import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  createWorkspaceInvitationAction: vi.fn(),
  reinviteWorkspaceInvitationAction: vi.fn(),
  removeWorkspaceMemberAction: vi.fn(),
  revokeWorkspaceInvitationAction: vi.fn(),
  updateWorkspaceMemberRoleAction: vi.fn(),
}));

vi.mock("@/actions/workspace-invitations", () => actions);

import { WorkspaceMembersPanel } from "./workspace-members";

const activeInvitation = {
  id: "invitation_active",
  email: "active@example.com",
  role: "PARTNER" as const,
  version: 2,
  createdAt: "2026-07-29T01:00:00.000Z",
  expiresAt: "2026-08-05T01:00:00.000Z",
};

const ownerMember = {
  role: "OWNER" as const,
  displayName: "合成擁有者",
  email: "owner@example.com",
  management: {
    membershipId: "membership_owner",
    updatedAt: "2026-07-29T01:00:00.000Z",
  },
};

const partnerMember = {
  role: "PARTNER" as const,
  displayName: "小安",
  email: "partner@example.com",
  management: {
    membershipId: "membership_partner",
    updatedAt: "2026-07-29T02:03:04.567Z",
  },
};

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
});

describe("WorkspaceMembersPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps invitation guidance concise without exposing verification mechanics", () => {
    render(
      <WorkspaceMembersPanel
        workspaceId="workspace_1"
        operationKey="8d7fcdcf-2bea-4aa4-89b3-47158efcb40d"
        role="OWNER"
        members={[]}
        pendingInvitations={[]}
        renewableInvitations={[]}
      />,
    );

    expect(
      screen.getByText("邀請建立後會保留七天。請把 VowBook 網址傳給對方。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/完全相同/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/重新驗證/u)).not.toBeInTheDocument();
  });

  it("locks email, role, and submit together while create is pending", async () => {
    let resolveAction:
      | ((state: { status: "success"; message: string }) => void)
      | undefined;
    actions.createWorkspaceInvitationAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );
    render(
      <WorkspaceMembersPanel
        workspaceId="workspace_1"
        operationKey="8d7fcdcf-2bea-4aa4-89b3-47158efcb40d"
        role="OWNER"
        members={[]}
        pendingInvitations={[]}
        renewableInvitations={[]}
      />,
    );

    const email = screen.getByLabelText("Google 帳號 Email");
    const role = screen.getByLabelText("協作角色");
    const submit = screen.getByRole("button", { name: "送出協作邀請" });
    fireEvent.change(email, { target: { value: "person@example.com" } });
    fireEvent.submit(submit.closest("form")!);

    await waitFor(() => expect(submit).toBeDisabled());
    expect(email).toBeDisabled();
    expect(role).toBeDisabled();
    expect(submit.closest("fieldset")).toHaveAttribute("aria-busy", "true");

    resolveAction?.({ status: "success", message: "已建立協作邀請。" });
    await screen.findByRole("status");
  });

  it("locks the reinvite role and submit together while request is pending", async () => {
    let resolveAction:
      | ((state: { status: "success"; message: string }) => void)
      | undefined;
    actions.reinviteWorkspaceInvitationAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );
    render(
      <WorkspaceMembersPanel
        workspaceId="workspace_1"
        operationKey="8d7fcdcf-2bea-4aa4-89b3-47158efcb40d"
        role="OWNER"
        members={[]}
        pendingInvitations={[]}
        renewableInvitations={[
          {
            id: "invitation_expired",
            email: "expired@example.com",
            role: "VIEWER",
            version: 3,
            createdAt: "2026-07-20T01:00:00.000Z",
            expiresAt: "2026-07-27T01:00:00.000Z",
            reason: "EXPIRED",
          },
        ]}
      />,
    );

    const role = screen.getByLabelText("重新邀請 expired@example.com 的角色");
    const submit = screen.getByRole("button", {
      name: "重新邀請 expired@example.com",
    });
    fireEvent.submit(submit.closest("form")!);

    await waitFor(() => expect(submit).toBeDisabled());
    expect(role).toBeDisabled();
    expect(submit.closest("fieldset")).toHaveAttribute("aria-busy", "true");

    resolveAction?.({ status: "success", message: "已重新建立邀請。" });
    await screen.findByRole("status");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "需重新邀請" }),
      ).toHaveFocus(),
    );
  });

  it("connects email validation to fixed help and feedback, omits duplicate alert live region, and focuses it", async () => {
    actions.createWorkspaceInvitationAction.mockResolvedValue({
      status: "error",
      code: "VALIDATION",
      field: "email",
      message: "請輸入有效的 Google 帳號 Email。",
    });
    render(
      <WorkspaceMembersPanel
        workspaceId="workspace_1"
        operationKey="8d7fcdcf-2bea-4aa4-89b3-47158efcb40d"
        role="OWNER"
        members={[]}
        pendingInvitations={[]}
        renewableInvitations={[]}
      />,
    );

    const email = screen.getByLabelText("Google 帳號 Email");
    fireEvent.change(email, { target: { value: "invalid" } });
    fireEvent.submit(
      screen.getByRole("button", { name: "送出協作邀請" }).closest("form")!,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("id", "invitation-feedback");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAttribute(
      "aria-describedby",
      "invitation-email-help invitation-feedback",
    );
    expect(screen.getByText(/限 ASCII Email/u)).toHaveAttribute(
      "id",
      "invitation-email-help",
    );
    await waitFor(() => expect(email).toHaveFocus());
  });

  it("connects and focuses role validation while success remains a polite status", async () => {
    actions.createWorkspaceInvitationAction
      .mockResolvedValueOnce({
        status: "error",
        code: "VALIDATION",
        field: "role",
        message: "請選擇伴侶、婚顧或檢視者角色。",
      })
      .mockResolvedValueOnce({
        status: "success",
        message: "已建立協作邀請。",
      });
    render(
      <WorkspaceMembersPanel
        workspaceId="workspace_1"
        operationKey="8d7fcdcf-2bea-4aa4-89b3-47158efcb40d"
        role="OWNER"
        members={[]}
        pendingInvitations={[]}
        renewableInvitations={[]}
      />,
    );
    const role = screen.getByLabelText("協作角色");
    const form = screen.getByRole("button", {
      name: "送出協作邀請",
    }).closest("form")!;
    fireEvent.submit(form);

    await screen.findByRole("alert");
    expect(role).toHaveAttribute("aria-invalid", "true");
    expect(role).toHaveAttribute("aria-describedby", "invitation-feedback");
    await waitFor(() => expect(role).toHaveFocus());

    fireEvent.change(screen.getByLabelText("Google 帳號 Email"), {
      target: { value: "person@example.com" },
    });
    fireEvent.submit(form);
    const status = await screen.findByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("shows only unexpired pending revoke and explicit expired/revoked reinvite generations", () => {
    render(
      <WorkspaceMembersPanel
        workspaceId="workspace_1"
        operationKey="8d7fcdcf-2bea-4aa4-89b3-47158efcb40d"
        role="OWNER"
        members={[]}
        pendingInvitations={[activeInvitation]}
        renewableInvitations={[
          {
            id: "invitation_expired",
            email: "expired@example.com",
            role: "VIEWER",
            version: 3,
            createdAt: "2026-07-20T01:00:00.000Z",
            expiresAt: "2026-07-27T01:00:00.000Z",
            reason: "EXPIRED",
          },
          {
            id: "invitation_revoked",
            email: "revoked@example.com",
            role: "PLANNER",
            version: 4,
            createdAt: "2026-07-21T01:00:00.000Z",
            expiresAt: "2026-07-28T01:00:00.000Z",
            reason: "REVOKED",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "撤銷給 active@example.com 的邀請",
      }),
    ).toBeInTheDocument();
    const expiry = screen.getByText(/台北時間/u);
    expect(expiry).toHaveAttribute("datetime", activeInvitation.expiresAt);
    expect(expiry).toHaveTextContent(/2026.*8.*5.*9:00.*台北時間/u);
    expect(screen.getByText("已過期")).toBeInTheDocument();
    expect(screen.getByText("已撤銷")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "接受 expired@example.com 的邀請",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "撤銷給 expired@example.com 的邀請",
      }),
    ).not.toBeInTheDocument();

    const expiredRow = screen.getByText("expired@example.com").closest("li")!;
    const role = within(expiredRow).getByLabelText(
      "重新邀請 expired@example.com 的角色",
    );
    expect(within(role).getByRole("option", { name: "伴侶" })).toBeEnabled();
    expect(within(role).getByRole("option", { name: "婚顧" })).toBeEnabled();
    expect(within(role).getByRole("option", { name: "檢視者" })).toBeEnabled();
    expect(
      within(expiredRow).getByRole("button", {
        name: "重新邀請 expired@example.com",
      }),
    ).toHaveClass("min-h-11");
    expect(
      within(expiredRow).getByText(
        "重新邀請 expired@example.com 的角色",
      ),
    ).toHaveClass(
      "block",
      "min-w-0",
      "break-all",
      "[overflow-wrap:anywhere]",
    );
  });

  it("submits revoke id plus version and keeps stable feedback/focus", async () => {
    actions.revokeWorkspaceInvitationAction.mockResolvedValue({
      status: "success",
      message: "已撤銷邀請。",
    });
    render(
      <WorkspaceMembersPanel
        workspaceId="workspace_1"
        operationKey="8d7fcdcf-2bea-4aa4-89b3-47158efcb40d"
        role="OWNER"
        members={[]}
        pendingInvitations={[activeInvitation]}
        renewableInvitations={[]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "撤銷給 active@example.com 的邀請",
      }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent("已撤銷邀請。");
    const heading = screen.getByRole("heading", {
      name: "等待接受的邀請",
    });
    await waitFor(() => expect(heading).toHaveFocus());
    const formData = actions.revokeWorkspaceInvitationAction.mock.calls[0][2];
    expect(formData.get("invitationId")).toBe("invitation_active");
    expect(formData.get("version")).toBe("2");
  });

  it("shows edit and remove controls only to an OWNER and only for non-owner accepted members", () => {
    const { rerender } = render(
      <WorkspaceMembersPanel
        workspaceId="workspace_1"
        operationKey="8d7fcdcf-2bea-4aa4-89b3-47158efcb40d"
        role="OWNER"
        members={[ownerMember, partnerMember]}
        pendingInvitations={[]}
        renewableInvitations={[]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "編輯 小安 的角色" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "移除 小安" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "編輯 合成擁有者 的角色" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "移除 合成擁有者" }),
    ).not.toBeInTheDocument();

    rerender(
      <WorkspaceMembersPanel
        workspaceId="workspace_1"
        operationKey="8d7fcdcf-2bea-4aa4-89b3-47158efcb40d"
        role="PLANNER"
        members={[
          { role: "OWNER", displayName: "合成擁有者" },
          { role: "PARTNER", displayName: "小安" },
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: /編輯.*角色/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^移除/u })).not.toBeInTheDocument();
  });

  it("keeps a dirty role draft paired with its original updatedAt token and restores trigger focus on close", () => {
    const { rerender } = render(
      <WorkspaceMembersPanel
        workspaceId="workspace_1"
        operationKey="8d7fcdcf-2bea-4aa4-89b3-47158efcb40d"
        role="OWNER"
        members={[partnerMember]}
        pendingInvitations={[]}
        renewableInvitations={[]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "編輯 小安 的角色" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "編輯小安的角色" });
    const role = within(dialog).getByLabelText("協作角色");
    expect(role).toHaveFocus();
    expect(role).toHaveValue("PARTNER");
    fireEvent.change(role, { target: { value: "PLANNER" } });

    rerender(
      <WorkspaceMembersPanel
        workspaceId="workspace_1"
        operationKey="8d7fcdcf-2bea-4aa4-89b3-47158efcb40d"
        role="OWNER"
        members={[
          {
            ...partnerMember,
            role: "VIEWER",
            management: {
              ...partnerMember.management,
              updatedAt: "2026-07-29T03:04:05.678Z",
            },
          },
        ]}
        pendingInvitations={[]}
        renewableInvitations={[]}
      />,
    );

    expect(within(dialog).getByLabelText("協作角色")).toHaveValue("PLANNER");
    const formData = new FormData(dialog.querySelector("form")!);
    expect(formData.get("expectedUpdatedAt")).toBe(
      "2026-07-29T02:03:04.567Z",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(dialog).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();
  });

  it("locks the complete role-edit snapshot while pending, retains safe errors, then closes with stable success feedback", async () => {
    let resolveAction:
      | ((state: {
          status: "error";
          code: "STALE";
          message: string;
        }) => void)
      | undefined;
    actions.updateWorkspaceMemberRoleAction
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveAction = resolve;
          }),
      )
      .mockResolvedValueOnce({
        status: "success",
        message: "已更新協作者角色。",
        membershipId: "membership_partner",
        role: "VIEWER",
        updatedAt: "2026-07-29T04:05:06.789Z",
      });
    render(
      <WorkspaceMembersPanel
        workspaceId="workspace_1"
        operationKey="8d7fcdcf-2bea-4aa4-89b3-47158efcb40d"
        role="OWNER"
        members={[partnerMember]}
        pendingInvitations={[]}
        renewableInvitations={[]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "編輯 小安 的角色" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "編輯小安的角色" });
    const role = within(dialog).getByLabelText("協作角色");
    fireEvent.change(role, { target: { value: "VIEWER" } });
    fireEvent.submit(dialog.querySelector("form")!);

    await waitFor(() => expect(role).toBeDisabled());
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "關閉編輯小安的角色" }),
    ).toBeDisabled();
    fireEvent(
      dialog,
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(dialog).toHaveAttribute("open");

    resolveAction?.({
      status: "error",
      code: "STALE",
      message: "成員資料已變更或無法操作，請重新整理。",
    });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "成員資料已變更或無法操作",
    );
    expect(dialog).toHaveAttribute("open");
    await waitFor(() => expect(role).toBeEnabled());

    fireEvent.submit(dialog.querySelector("form")!);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "已更新協作者角色。",
    );
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    expect(trigger).toHaveFocus();
    const submitted = actions.updateWorkspaceMemberRoleAction.mock.calls[1][2];
    expect(submitted.get("membershipId")).toBe("membership_partner");
    expect(submitted.get("expectedUpdatedAt")).toBe(
      "2026-07-29T02:03:04.567Z",
    );
    expect(submitted.get("role")).toBe("VIEWER");
  });

  it("names the member and Email in removal confirmation, locks pending close paths, and keeps success feedback after removal", async () => {
    let resolveAction:
      | ((state: {
          status: "success";
          message: string;
          membershipId: string;
        }) => void)
      | undefined;
    actions.removeWorkspaceMemberAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );
    render(
      <WorkspaceMembersPanel
        workspaceId="workspace_1"
        operationKey="8d7fcdcf-2bea-4aa4-89b3-47158efcb40d"
        role="OWNER"
        members={[partnerMember]}
        pendingInvitations={[]}
        renewableInvitations={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "移除 小安" }));
    const dialog = screen.getByRole("dialog", { name: "移除小安" });
    expect(dialog).toHaveTextContent("小安");
    expect(dialog).toHaveTextContent("partner@example.com");
    const submit = within(dialog).getByRole("button", { name: "確認移除小安" });
    const confirmation = within(dialog).getByLabelText(
      "請輸入「小安」以確認移除",
    );
    expect(confirmation).toHaveFocus();
    expect(submit).toBeDisabled();
    fireEvent.change(confirmation, { target: { value: "小安 " } });
    expect(submit).toBeDisabled();
    fireEvent.change(confirmation, { target: { value: "小安" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(submit).toBeDisabled());
    expect(confirmation).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "關閉移除小安" }),
    ).toBeDisabled();
    resolveAction?.({
      status: "success",
      message: "已移除協作者。",
      membershipId: "membership_partner",
    });

    expect(await screen.findByRole("status")).toHaveTextContent("已移除協作者。");
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    expect(screen.getByRole("heading", { name: "目前成員" })).toHaveFocus();
    const submitted = actions.removeWorkspaceMemberAction.mock.calls[0][2];
    expect(submitted.get("membershipId")).toBe("membership_partner");
    expect(submitted.get("expectedUpdatedAt")).toBe(
      "2026-07-29T02:03:04.567Z",
    );
  });

  it("keeps non-owner privacy: names and roles only, with no invitation query result or controls", () => {
    render(
      <WorkspaceMembersPanel
        workspaceId="workspace_1"
        operationKey="8d7fcdcf-2bea-4aa4-89b3-47158efcb40d"
        role="PARTNER"
        members={[
          {
            role: "OWNER",
            displayName: "合成擁有者",
          },
        ]}
      />,
    );
    expect(screen.getByText("合成擁有者")).toBeInTheDocument();
    expect(screen.queryByLabelText("Google 帳號 Email")).not.toBeInTheDocument();
    expect(screen.queryByText(/expired@example\.com/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /邀請/u })).not.toBeInTheDocument();
    expect(document.querySelector('input[name="membershipId"]')).toBeNull();
    expect(document.body.textContent).not.toContain("membership_1");
  });

  it("keeps a stable live region and submits the server-generated operation key", async () => {
    actions.createWorkspaceInvitationAction.mockResolvedValue({
      status: "success",
      message:
        "已建立協作邀請。系統不會寄信，請自行通知對方於 7 天內開啟 VowBook。",
    });
    const { container } = render(
      <WorkspaceMembersPanel
        workspaceId="workspace_1"
        operationKey="8d7fcdcf-2bea-4aa4-89b3-47158efcb40d"
        role="OWNER"
        members={[]}
        pendingInvitations={[]}
        renewableInvitations={[]}
      />,
    );

    const stableRegion = container.querySelector("#invitation-feedback");
    expect(stableRegion).toBeInTheDocument();
    expect(stableRegion).toHaveTextContent("");

    fireEvent.change(screen.getByLabelText("Google 帳號 Email"), {
      target: { value: "person@example.com" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "送出協作邀請" }).closest("form")!,
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "系統不會寄信",
    );
    const formData = actions.createWorkspaceInvitationAction.mock.calls[0][2];
    expect(formData.get("operationKey")).toBe(
      "8d7fcdcf-2bea-4aa4-89b3-47158efcb40d",
    );
  });
});
