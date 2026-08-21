import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireCurrentUser, membershipCount, redirect } = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  membershipCount: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/prisma", () => ({
  prisma: { membership: { count: membershipCount } },
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/components/workspaces/create-workspace-form", () => ({
  CreateWorkspaceForm: () => <form aria-label="建立婚宴工作區表單" />,
}));

import OnboardingPage from "./page";

describe("OnboardingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "user_without_membership" });
    membershipCount.mockResolvedValue(0);
  });

  it("does not show invitation instructions without a verified accepted invitation", async () => {
    render(await OnboardingPage());

    expect(screen.queryByText(/協作邀請/u)).not.toBeInTheDocument();
    expect(
      screen.getByRole("form", { name: "建立婚宴工作區表單" }),
    ).toBeInTheDocument();
  });
});