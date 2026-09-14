import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const { getWeddingOverview, notFound, WeddingOverviewDataError } = vi.hoisted(
  () => ({
    getWeddingOverview: vi.fn(),
    notFound: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    }),
    WeddingOverviewDataError: class WeddingOverviewDataError extends Error {},
  }),
);

vi.mock("@/lib/wedding-overview", () => ({
  getWeddingOverview,
  WeddingOverviewDataError,
}));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/components/workspaces/wedding-overview", () => ({
  WeddingOverview: () => <section>合成完整婚宴總覽</section>,
}));

import OverviewPage from "./page";

describe("OverviewPage", () => {
  it("renders the workspace-scoped overview as the active first tab", async () => {
    getWeddingOverview.mockResolvedValue({
      role: "VIEWER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
      guests: {},
      seating: {},
      tasks: {},
      budget: {},
      operations: {},
    });

    render(
      await OverviewPage({
        params: Promise.resolve({ workspaceId: "workspace_1" }),
      }),
    );

    expect(getWeddingOverview).toHaveBeenCalledWith("workspace_1");
    expect(
      screen.getByRole("heading", { level: 1, name: "婚宴總覽" }),
    ).toBeInTheDocument();
    expect(screen.getByText("合成完整婚宴總覽")).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "工作區功能" });
    expect(within(navigation).getAllByRole("link")).toHaveLength(10);
    expect(within(navigation).getByRole("link", { name: "總覽" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("returns not found for unauthorized workspace access", async () => {
    getWeddingOverview.mockRejectedValue(new WorkspaceAccessDeniedError());

    await expect(
      OverviewPage({ params: Promise.resolve({ workspaceId: "workspace_secret" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("renders a safe retry state for sanitized overview failures", async () => {
    getWeddingOverview.mockRejectedValue(
      new WeddingOverviewDataError("目前無法載入婚宴總覽，請稍後再試。"),
    );

    render(
      await OverviewPage({
        params: Promise.resolve({ workspaceId: "workspace_1" }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "婚宴總覽暫時無法開啟" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "再試一次" })).toHaveAttribute(
      "href",
      "/workspaces/workspace_1/overview",
    );
  });
});
