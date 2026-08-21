import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const { getSeatingPlan, notFound, SeatingPlanDataError } = vi.hoisted(() => ({
  getSeatingPlan: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  SeatingPlanDataError: class SeatingPlanDataError extends Error {},
}));

vi.mock("@/lib/seating-plan", () => ({ getSeatingPlan, SeatingPlanDataError }));
vi.mock("next/navigation", () => ({ notFound }));

import TablesChartPage from "./page";

describe("TablesChartPage", () => {
  it("renders the poster with the workspace-local wedding date", async () => {
    getSeatingPlan.mockResolvedValue({
      role: "VIEWER",
      workspace: {
        id: "workspace_1",
        name: "我們的婚宴",
        // UTC 前一天深夜，換算成台北時間要顯示 10 月 10 日。
        weddingDate: new Date("2026-10-09T22:00:00Z"),
        timezone: "Asia/Taipei",
      },
      tables: [
        {
          id: "table_1",
          number: 1,
          position: 1,
          version: 1,
          layoutX: null,
          layoutY: null,
          name: "主桌",
          capacity: 12,
          notes: null,
          guests: [],
        },
      ],
      unassignedGuests: [],
    });

    render(
      await TablesChartPage({
        params: Promise.resolve({ workspaceId: "workspace_1" }),
      }),
    );

    expect(getSeatingPlan).toHaveBeenCalledWith("workspace_1");
    const poster = screen.getByTestId("seating-chart-poster");
    expect(within(poster).getByText("2026年10月10日")).toBeInTheDocument();
    expect(
      within(poster).getByRole("article", { name: "1 號桌 主桌" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "列印／另存 PDF" }),
    ).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "工作區功能" });
    expect(
      within(navigation).getByRole("link", { name: "桌次" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("omits the print action when there is nothing to print", async () => {
    getSeatingPlan.mockResolvedValue({
      role: "PARTNER",
      workspace: {
        id: "workspace_1",
        name: "我們的婚宴",
        weddingDate: null,
        timezone: "Asia/Taipei",
      },
      tables: [],
      unassignedGuests: [],
    });

    render(
      await TablesChartPage({
        params: Promise.resolve({ workspaceId: "workspace_1" }),
      }),
    );

    expect(screen.queryByRole("button", { name: "列印／另存 PDF" })).toBeNull();
    expect(screen.getByText("還沒有桌次可以輸出")).toBeInTheDocument();
  });

  it("translates access denial to not found", async () => {
    getSeatingPlan.mockRejectedValue(new WorkspaceAccessDeniedError());

    await expect(
      TablesChartPage({
        params: Promise.resolve({ workspaceId: "workspace_secret" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("renders a safe retry state for sanitized read failures", async () => {
    getSeatingPlan.mockRejectedValue(
      new SeatingPlanDataError("目前無法載入桌次安排，請稍後再試。"),
    );

    render(
      await TablesChartPage({
        params: Promise.resolve({ workspaceId: "workspace_1" }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "婚宴桌圖暫時無法開啟" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "再試一次" })).toHaveAttribute(
      "href",
      "/workspaces/workspace_1/tables/chart",
    );
  });
});
