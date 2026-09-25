import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { getWeddingTimelinePageData } = vi.hoisted(() => ({
  getWeddingTimelinePageData: vi.fn(),
}));
vi.mock("@/lib/wedding-timeline-list", () => ({
  getWeddingTimelinePageData,
  WeddingTimelineDataError: class WeddingTimelineDataError extends Error {},
}));
vi.mock("@/components/timeline/timeline-list", () => ({
  WeddingTimelineList: ({ canEdit }: { canEdit: boolean }) => (
    <div>總流程清單 {canEdit ? "可編輯" : "唯讀"}</div>
  ),
}));

vi.mock("@/components/timeline/game-participants", () => ({
  WeddingGameParticipantLists: ({ canEdit }: { canEdit: boolean }) => (
    <div>遊戲名單 {canEdit ? "可編輯" : "唯讀"}</div>
  ),
}));

vi.mock("@/components/timeline/wedding-speeches", () => ({
  WeddingSpeechCards: () => <div>謝親恩區</div>,
}));

import TimelinePage from "./page";

describe("TimelinePage", () => {
  it("renders the shared timeline route for an editor", async () => {
    getWeddingTimelinePageData.mockResolvedValue({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
      items: [],
      staff: [],
      games: { BOUQUET: [{ id: "p1" }, { id: "p2" }], BROCCOLI: [] },
      speeches: { GROOM_PARENTS: null, BRIDE_PARENTS: null },
    });
    render(
      await TimelinePage({
        params: Promise.resolve({ workspaceId: "workspace_1" }),
      }),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "婚禮總流程" }),
    ).toBeInTheDocument();
    expect(screen.getByText("總流程清單 可編輯")).toBeInTheDocument();
    expect(screen.getByText("遊戲名單 可編輯")).toBeInTheDocument();
    // 名單在長長的流程下面，頁首要能一鍵跳過去並看到目前人數。
    const jump = screen.getByRole("link", { name: /遊戲名單/ });
    expect(jump).toHaveAttribute("href", "#wedding-games");
    expect(jump).toHaveTextContent("捧花 2・花椰菜 0");
    expect(screen.getByText("謝親恩區")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /謝親恩/ })).toHaveAttribute(
      "href",
      "#wedding-speeches",
    );
    expect(screen.getByRole("link", { name: "主持人流程" })).toHaveAttribute(
      "href",
      "/workspaces/workspace_1/timeline/print",
    );
  });
});
