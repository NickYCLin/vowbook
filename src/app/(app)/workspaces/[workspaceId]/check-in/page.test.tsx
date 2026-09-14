import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const { getGuestCheckInBoard, notFound, GuestCheckInBoardDataError } =
  vi.hoisted(() => ({
    getGuestCheckInBoard: vi.fn(),
    notFound: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    }),
    GuestCheckInBoardDataError: class GuestCheckInBoardDataError extends Error {},
  }));

vi.mock("@/lib/guest-check-in-board", () => ({
  getGuestCheckInBoard,
  GuestCheckInBoardDataError,
}));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/components/check-in/guest-check-in-board", () => ({
  GuestCheckInBoard: ({ canEdit }: { canEdit: boolean }) => (
    <div data-testid="check-in-board">
      {canEdit ? "可報到" : "唯讀報到"}
    </div>
  ),
}));

import CheckInPage, { metadata } from "./page";

function boardData(role: string) {
  return {
    role,
    workspace: { id: "workspace_1", name: "我們的婚宴" },
    guests: [],
    tables: [],
    summary: {
      expectedGroups: 0,
      expectedHeadcount: 0,
      arrivedGroups: 0,
      arrivedHeadcount: 0,
      pendingGroups: 0,
      pendingHeadcount: 0,
      unexpectedGroups: 0,
    },
  };
}

describe("CheckInPage", () => {
  it("names the section for the browser tab", () => {
    expect(metadata.title).toBe("賓客報到");
  });

  it("uses Next 16 async params and renders workspace-scoped check-in data", async () => {
    getGuestCheckInBoard.mockResolvedValue(boardData("OWNER"));

    render(
      await CheckInPage({ params: Promise.resolve({ workspaceId: "workspace_1" }) }),
    );

    expect(getGuestCheckInBoard).toHaveBeenCalledWith("workspace_1");
    expect(
      screen.getByRole("heading", { level: 1, name: "賓客報到" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("check-in-board")).toHaveTextContent("可報到");
  });

  it("gives a VIEWER a read-only board and an explicit notice", async () => {
    getGuestCheckInBoard.mockResolvedValue(boardData("VIEWER"));

    render(
      await CheckInPage({ params: Promise.resolve({ workspaceId: "workspace_1" }) }),
    );

    expect(screen.getByTestId("check-in-board")).toHaveTextContent("唯讀報到");
    expect(
      screen.getByText(
        "你目前是唯讀成員，可以查看報到狀況，但不能報到或調整人數。",
      ),
    ).toBeInTheDocument();
  });

  it("renders a not-found page instead of leaking that the workspace exists", async () => {
    getGuestCheckInBoard.mockRejectedValue(new WorkspaceAccessDeniedError());

    await expect(
      CheckInPage({ params: Promise.resolve({ workspaceId: "workspace_1" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("shows a safe retry screen when the board cannot be loaded", async () => {
    getGuestCheckInBoard.mockRejectedValue(
      new GuestCheckInBoardDataError("目前無法載入報到名單，請稍後再試。"),
    );

    render(
      await CheckInPage({ params: Promise.resolve({ workspaceId: "workspace_1" }) }),
    );

    expect(
      screen.getByText("目前無法載入報到名單，請稍後再試。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "再試一次" })).toHaveAttribute(
      "href",
      "/workspaces/workspace_1/check-in",
    );
  });
});
