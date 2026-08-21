import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { getWorkspaceMembersData, notFound } = vi.hoisted(() => ({
  getWorkspaceMembersData: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/workspace-invitations", () => ({
  getWorkspaceMembersData,
}));
vi.mock("next/navigation", () => ({ notFound }));

import MembersPage from "./page";

describe("MembersPage", () => {
  it("renders the discoverable OWNER sharing page in the shared workspace shell", async () => {
    getWorkspaceMembersData.mockResolvedValue({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
      members: [
        {
          role: "OWNER",
          displayName: "合成擁有者",
          email: "owner@example.com",
          management: {
            membershipId: "membership_owner",
            updatedAt: "2026-07-29T01:00:00.000Z",
          },
        },
        {
          role: "PARTNER",
          displayName: "小安",
          email: "partner@example.com",
          management: {
            membershipId: "membership_partner",
            updatedAt: "2026-07-29T02:03:04.567Z",
          },
        },
      ],
      pendingInvitations: [],
      renewableInvitations: [],
    });

    render(
      await MembersPage({
        params: Promise.resolve({ workspaceId: "workspace_1" }),
      }),
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "合成婚宴・分享與協作",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "協作者" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("Google 帳號 Email")).toBeInTheDocument();
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
      document.querySelector<HTMLInputElement>('input[name="operationKey"]')
        ?.value,
    ).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
  });

  it("renders a privacy-explicit read-only view for non-owners", async () => {
    getWorkspaceMembersData.mockResolvedValue({
      role: "VIEWER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
      members: [
        {
          id: "membership_1",
          role: "OWNER",
          displayName: "合成擁有者",
        },
      ],
    });

    render(
      await MembersPage({
        params: Promise.resolve({ workspaceId: "workspace_1" }),
      }),
    );

    expect(screen.getByText(/只能查看成員的顯示名稱與角色/u)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "合成婚宴・協作者",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Google 帳號 Email")).not.toBeInTheDocument();
  });

  it("uses neutral metadata while keeping role-specific page H1 copy", async () => {
    const { metadata } = await import("./page");
    expect(metadata).toEqual({ title: "協作者" });
  });

  it("uses the generic not-found boundary for an outsider", async () => {
    const { WorkspaceAccessDeniedError } = await import("@/domain/workspace");
    getWorkspaceMembersData.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );

    await expect(
      MembersPage({
        params: Promise.resolve({ workspaceId: "workspace_secret" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });
});
