import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/actions/admin-users", () => ({
  updateSystemUserAccessAction: vi.fn(),
  deleteSystemUserAction: vi.fn(),
}));

import { SystemUserList, type SystemUserRow } from "./system-user-list";

const users: SystemUserRow[] = [
  {
    id: "user_admin",
    email: "owner@example.com",
    name: "站台管理者",
    image: null,
    accessStatus: "ACTIVE",
    accessStatusChangedAt: null,
    lastLoginAt: "2026-08-24T01:00:00.000Z",
    version: 0,
    createdAt: "2026-08-01T01:00:00.000Z",
    systemAdmin: true,
    memberships: [
      {
        role: "OWNER",
        workspace: { id: "workspace_1", name: "我們的婚宴" },
      },
    ],
    createdWorkspaces: [
      {
        id: "workspace_1",
        name: "我們的婚宴",
        memberCount: 2,
        guestCount: 74,
      },
    ],
  },
  {
    id: "user_guest",
    email: "guest@example.com",
    name: "一般使用者",
    image: null,
    accessStatus: "SUSPENDED",
    accessStatusChangedAt: "2026-08-23T01:00:00.000Z",
    lastLoginAt: null,
    version: 3,
    createdAt: "2026-08-20T01:00:00.000Z",
    systemAdmin: false,
    memberships: [],
    createdWorkspaces: [
      {
        id: "workspace_2",
        name: "自己開的婚宴",
        memberCount: 1,
        guestCount: 12,
      },
    ],
  },
];

describe("SystemUserList", () => {
  it("shows account state, activity, and workspace membership in responsive cards", () => {
    render(<SystemUserList users={users} />);

    expect(screen.getByText("站台管理者")).toBeVisible();
    expect(screen.getByText("我們的婚宴")).toBeVisible();
    expect(screen.getByText("尚未加入婚宴工作區")).toBeVisible();
    expect(screen.getByText("尚無登入紀錄")).toBeVisible();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByText("系統管理者")).toBeVisible();
  });

  it("filters by name, email, workspace, and account state without another request", () => {
    render(<SystemUserList users={users} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "搜尋使用者" }), {
      target: { value: "guest@" },
    });
    expect(screen.queryByText("站台管理者")).not.toBeInTheDocument();
    expect(screen.getByText("一般使用者")).toBeVisible();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜尋使用者" }), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "帳號狀態" }), {
      target: { value: "ACTIVE" },
    });
    expect(screen.getByText("站台管理者")).toBeVisible();
    expect(screen.queryByText("一般使用者")).not.toBeInTheDocument();
  });

  it("protects admins while offering reversible suspend, remove, and restore controls", () => {
    render(<SystemUserList users={users} />);

    const adminCard = screen.getByText("站台管理者").closest("article");
    expect(adminCard).not.toBeNull();
    expect(
      within(adminCard as HTMLElement).queryByRole("button"),
    ).not.toBeInTheDocument();

    const guestCard = screen.getByText("一般使用者").closest("article");
    expect(guestCard).not.toBeNull();
    expect(
      within(guestCard as HTMLElement).getByRole("button", {
        name: "恢復登入權限",
      }),
    ).toBeVisible();
    expect(
      within(guestCard as HTMLElement).getByText("移除登入權限"),
    ).toBeVisible();
  });

  it("刪除帳號前先列出會一起消失的婚宴", () => {
    render(<SystemUserList users={users} />);

    const guestCard = screen.getByText("一般使用者").closest("article");
    const panel = within(guestCard as HTMLElement);
    const trigger = panel.getByText("永久刪除帳號");
    expect(trigger).toBeVisible();

    const details = trigger.closest("details") as HTMLDetailsElement;
    details.open = true;

    expect(panel.getByText("自己開的婚宴")).toBeVisible();
    expect(panel.getByText("賓客 12 組 · 成員 1 位")).toBeVisible();
  });

  it("Email 沒有打對就不能按下刪除", () => {
    render(<SystemUserList users={users} />);

    const guestCard = screen.getByText("一般使用者").closest("article");
    const panel = within(guestCard as HTMLElement);
    const submit = panel.getByRole("button", { name: "永久刪除這個帳號" });
    expect(submit).toBeDisabled();

    const field = panel.getByRole("textbox", { name: /輸入 guest@example.com/u });
    fireEvent.change(field, { target: { value: "guest@example.co" } });
    expect(submit).toBeDisabled();

    fireEvent.change(field, { target: { value: " Guest@Example.com " } });
    expect(submit).toBeEnabled();
  });

  it("系統管理者沒有刪除入口", () => {
    render(<SystemUserList users={users} />);

    const adminCard = screen.getByText("站台管理者").closest("article");
    expect(
      within(adminCard as HTMLElement).queryByText("永久刪除帳號"),
    ).not.toBeInTheDocument();
  });
});
