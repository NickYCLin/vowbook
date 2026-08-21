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

import TimelinePage from "./page";

describe("TimelinePage", () => {
  it("renders the shared timeline route for an editor", async () => {
    getWeddingTimelinePageData.mockResolvedValue({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
      items: [],
      staff: [],
    });
    render(
      await TimelinePage({
        params: Promise.resolve({ workspaceId: "workspace_1" }),
      }),
    );
    expect(
      screen.getByRole("heading", { name: "合成婚宴・婚禮總流程" }),
    ).toBeInTheDocument();
    expect(screen.getByText("總流程清單 可編輯")).toBeInTheDocument();
  });
});
