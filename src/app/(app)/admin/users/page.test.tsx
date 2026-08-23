import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listSystemUsers, notFound } = vi.hoisted(() => ({
  listSystemUsers: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/lib/system-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/system-admin")>();
  return { ...actual, listSystemUsers };
});

import AdminUsersPage from "./page";
import { SystemAdminAccessDeniedError } from "@/lib/system-admin";

beforeEach(() => {
  vi.clearAllMocks();
  listSystemUsers.mockResolvedValue([
    {
      id: "user_1",
      email: "owner@example.com",
      name: "管理者",
      image: null,
      accessStatus: "ACTIVE",
      accessStatusChangedAt: null,
      lastLoginAt: new Date("2026-08-24T01:00:00.000Z"),
      version: 0,
      createdAt: new Date("2026-08-01T01:00:00.000Z"),
      systemAdmin: true,
      memberships: [],
    },
    {
      id: "user_2",
      email: "guest@example.com",
      name: "使用者",
      image: null,
      accessStatus: "SUSPENDED",
      accessStatusChangedAt: new Date("2026-08-23T01:00:00.000Z"),
      lastLoginAt: null,
      version: 2,
      createdAt: new Date("2026-08-20T01:00:00.000Z"),
      systemAdmin: false,
      memberships: [],
    },
  ]);
});

describe("system admin users page", () => {
  it("summarizes users while explaining open registration and reversible access states", async () => {
    render(await AdminUsersPage());

    expect(screen.getByRole("heading", { name: "使用者管理" })).toBeVisible();
    expect(screen.getByText("註冊仍為開放")).toBeVisible();
    expect(screen.getByText("共 2 位")).toBeVisible();
    expect(screen.getAllByText("1", { selector: "strong" })).toHaveLength(2);
    expect(screen.getByText(/保留婚宴資料與成員紀錄/)).toBeVisible();
  });

  it("hides the route from authenticated non-admin users", async () => {
    listSystemUsers.mockRejectedValueOnce(new SystemAdminAccessDeniedError());

    await expect(AdminUsersPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });
});
