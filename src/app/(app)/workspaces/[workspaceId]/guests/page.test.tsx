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

function navigationOf() {
  return screen.getByRole("navigation", { name: "工作區功能" });
}

describe("GuestsPage", () => {
  it("uses Next 16 async params and renders workspace-scoped data", async () => {
    listGuestsForWorkspace.mockResolvedValue({
      role: "PLANNER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
      guests: [{ id: "guest_1" }],
    });

    render(
      await GuestsPage({ params: Promise.resolve({ workspaceId: "workspace_1" }) }),
    );

    expect(listGuestsForWorkspace).toHaveBeenCalledWith("workspace_1");
    expect(
      screen.getByRole("heading", { level: 1, name: "婚宴名單" }),
    ).toBeInTheDocument();
    expect(screen.getByText("可編輯名單")).toBeInTheDocument();
    // 禮金已移到自己的頁面，賓客頁不再內嵌禮金簿。
    expect(screen.queryByText(/禮金簿/u)).toBeNull();
    expect(
      screen.getByText(
        "整理新人、家人與受邀賓客，確認宴席需求與座位安排；禮金請到「禮金」頁登記。",
      ),
    ).toBeInTheDocument();
    expect(
      within(navigationOf()).getByRole("link", { name: "禮金" }),
    ).toHaveAttribute("href", "/workspaces/workspace_1/gifts");
    const navigation = screen.getByRole("navigation", { name: "工作區功能" });
    expect(within(navigation).getAllByRole("link")).toHaveLength(10);
    expect(within(navigation).getByRole("link", { name: "賓客" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("lets a viewer inspect the guest list without edit access", async () => {
    listGuestsForWorkspace.mockResolvedValue({
      role: "VIEWER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
      guests: [{ id: "guest_1" }],
    });

    render(
      await GuestsPage({ params: Promise.resolve({ workspaceId: "workspace_1" }) }),
    );

    expect(screen.getByText("唯讀名單")).toBeInTheDocument();
    expect(
      screen.getByText(
        "你目前是唯讀成員，可以查看名單，但不能新增、編輯或刪除。",
      ),
    ).toBeInTheDocument();
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
