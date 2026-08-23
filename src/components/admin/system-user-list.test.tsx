import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/actions/admin-users", () => ({
  updateSystemUserAccessAction: vi.fn(),
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
});
