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
vi.mock("@/components/guests/wedding-gift-book", () => ({
  WeddingGiftBook: ({
    guests,
    canEdit,
    collapsible,
  }: {
    guests: unknown[];
    canEdit: boolean;
    collapsible?: boolean;
  }) => (
    <div data-testid="gift-book">
      {canEdit ? "可編輯禮金簿" : "唯讀禮金簿"} {guests.length} 組
      {collapsible === false ? "・不可收合" : "・可收合"}
    </div>
  ),
}));

import GiftsPage, { metadata } from "./page";

function navigationOf() {
  return screen.getByRole("navigation", { name: "工作區功能" });
}

describe("GiftsPage", () => {
  it("names the section for the browser tab", () => {
    expect(metadata.title).toBe("禮金簿");
  });

  it("gives the gift ledger its own always-open page and active tab", async () => {
    listGuestsForWorkspace.mockResolvedValue({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
      guests: [{ id: "guest_1" }, { id: "guest_2" }],
    });

    render(
      await GiftsPage({ params: Promise.resolve({ workspaceId: "workspace_1" }) }),
    );

    expect(listGuestsForWorkspace).toHaveBeenCalledWith("workspace_1");
    expect(screen.getByRole("link",{name:"列印紙本禮金簿"})).toHaveAttribute("href","/workspaces/workspace_1/gifts/print");
    expect(
      screen.getByRole("heading", { level: 1, name: "禮金簿" }),
    ).toBeInTheDocument();
    // 自己就是一整頁時不該再收合一次。
    expect(screen.getByTestId("gift-book")).toHaveTextContent(
      "可編輯禮金簿 2 組・不可收合",
    );
    expect(
      within(navigationOf()).getByRole("link", { name: "禮金" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("gives a VIEWER a read-only ledger and an explicit notice", async () => {
    listGuestsForWorkspace.mockResolvedValue({
      role: "VIEWER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
      guests: [{ id: "guest_1" }],
    });

    render(
      await GiftsPage({ params: Promise.resolve({ workspaceId: "workspace_1" }) }),
    );

    expect(screen.getByTestId("gift-book")).toHaveTextContent("唯讀禮金簿");
    expect(screen.queryByRole("link",{name:"列印紙本禮金簿"})).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "你目前是唯讀成員，可以查看禮金簿，但不能登記、修改或移除。",
      ),
    ).toBeInTheDocument();
  });

  it("renders a not-found page instead of leaking that the workspace exists", async () => {
    listGuestsForWorkspace.mockRejectedValue(new WorkspaceAccessDeniedError());

    await expect(
      GiftsPage({ params: Promise.resolve({ workspaceId: "workspace_1" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows a safe retry screen when the ledger cannot be loaded", async () => {
    listGuestsForWorkspace.mockRejectedValue(
      new GuestDataError("目前無法載入婚宴名單，請稍後再試。"),
    );

    render(
      await GiftsPage({ params: Promise.resolve({ workspaceId: "workspace_1" }) }),
    );

    expect(screen.getByRole("link", { name: "再試一次" })).toHaveAttribute(
      "href",
      "/workspaces/workspace_1/gifts",
    );
  });
});
