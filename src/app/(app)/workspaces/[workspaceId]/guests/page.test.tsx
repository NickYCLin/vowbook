import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const { listGuestsForWorkspace, notFound, GuestDataError } = vi.hoisted(() => ({
  listGuestsForWorkspace: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  GuestDataError: class GuestDataError extends Error {},
}));

vi.mock("@/lib/guest-list", () => ({ listGuestsForWorkspace, GuestDataError }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/components/guests/guest-list", () => ({
  GuestList: ({ canEdit }: { canEdit: boolean }) => (
    <div>{canEdit ? "可編輯名單" : "唯讀名單"}</div>
  ),
}));

import GuestsPage from "./page";

describe("GuestsPage", () => {
  it("uses Next 16 async params and renders workspace-scoped data", async () => {
    listGuestsForWorkspace.mockResolvedValue({
      role: "PLANNER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
      guests: [],
    });

    render(
      await GuestsPage({ params: Promise.resolve({ workspaceId: "workspace_1" }) }),
    );

    expect(listGuestsForWorkspace).toHaveBeenCalledWith("workspace_1");
    expect(
      screen.getByRole("heading", { name: "我們的婚宴・婚宴名單" }),
    ).toBeInTheDocument();
    expect(screen.getByText("可編輯名單")).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "工作區功能" });
    expect(within(navigation).getAllByRole("link")).toHaveLength(7);
    expect(within(navigation).getByRole("link", { name: "賓客" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("returns not found for unauthorized workspace access", async () => {
    listGuestsForWorkspace.mockRejectedValue(new WorkspaceAccessDeniedError());

    await expect(
      GuestsPage({ params: Promise.resolve({ workspaceId: "workspace_secret" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("renders a safe retry state for sanitized guest data errors", async () => {
    listGuestsForWorkspace.mockRejectedValue(
      new GuestDataError("目前無法載入賓客名單，請稍後再試。"),
    );

    render(
      await GuestsPage({ params: Promise.resolve({ workspaceId: "workspace_1" }) }),
    );

    expect(
      screen.getByRole("heading", { name: "婚宴名單暫時無法開啟" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("目前無法載入賓客名單，請稍後再試。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "再試一次" })).toHaveAttribute(
      "href",
      "/workspaces/workspace_1/guests",
    );
  });
});
