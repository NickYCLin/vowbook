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
vi.mock("@/components/tables/seating-plan", () => ({
  SeatingPlan: ({ canEdit }: { canEdit: boolean }) => (
    <div>{canEdit ? "可編輯桌次" : "唯讀桌次"}</div>
  ),
}));
vi.mock("@/components/tables/table-forms", () => ({
  CreateSeatingTableForm: () => <button>新增桌次</button>,
}));

import TablesPage from "./page";

describe("TablesPage", () => {
  it("uses Next 16 async params and renders workspace-scoped data", async () => {
    getSeatingPlan.mockResolvedValue({
      role: "PARTNER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
      tables: [{ id: "table_1" }],
      unassignedGuests: [],
    });

    render(
      await TablesPage({ params: Promise.resolve({ workspaceId: "workspace_1" }) }),
    );

    expect(getSeatingPlan).toHaveBeenCalledWith("workspace_1");
    expect(
      screen.getByRole("heading", { name: "我們的婚宴・桌次安排" }),
    ).toBeInTheDocument();
    expect(screen.getByText("可編輯桌次")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "婚宴桌圖" })).toHaveAttribute(
      "href",
      "/workspaces/workspace_1/tables/chart",
    );
    const navigation = screen.getByRole("navigation", { name: "工作區功能" });
    expect(within(navigation).getAllByRole("link")).toHaveLength(7);
    expect(within(navigation).getByRole("link", { name: "桌次" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("translates access denial to not found", async () => {
    getSeatingPlan.mockRejectedValue(new WorkspaceAccessDeniedError());

    await expect(
      TablesPage({ params: Promise.resolve({ workspaceId: "workspace_secret" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("renders a safe retry state for sanitized read failures", async () => {
    getSeatingPlan.mockRejectedValue(
      new SeatingPlanDataError("目前無法載入桌次安排，請稍後再試。"),
    );

    render(
      await TablesPage({ params: Promise.resolve({ workspaceId: "workspace_1" }) }),
    );

    expect(
      screen.getByRole("heading", { name: "桌次安排暫時無法開啟" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "再試一次" })).toHaveAttribute(
      "href",
      "/workspaces/workspace_1/tables",
    );
  });
});
