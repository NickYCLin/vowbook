import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import type { BudgetSummary } from "@/lib/budget-list";

const { getBudgetPageData, notFound, BudgetItemDataError } = vi.hoisted(() => ({
  getBudgetPageData: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  BudgetItemDataError: class BudgetItemDataError extends Error {},
}));

vi.mock("@/lib/budget-list", () => ({ getBudgetPageData, BudgetItemDataError }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/components/budget/budget-list", () => ({
  BudgetList: ({ canEdit }: { canEdit: boolean }) => (
    <div data-testid="budget-list">
      <section aria-labelledby="mock-budget-summary-heading">
        <h2 id="mock-budget-summary-heading">花費摘要</h2>
      </section>
      <section aria-labelledby="mock-budget-items-heading">
        <h2 id="mock-budget-items-heading">花費明細</h2>
        <p>{canEdit ? "可編輯花費" : "唯讀花費"}</p>
      </section>
    </div>
  ),
}));

import BudgetPage, { metadata } from "./page";

const emptySummary: BudgetSummary = {
  itemCount: 0,
  paidCount: 0,
  plannedTotal: "0",
  actualTotal: "0",
  balanceDueTotal: "0",
  balanceDueCount: 0,
  balanceDueMissingAmountCount: 0,
  nearestBalanceDueDate: null,
};

describe("BudgetPage", () => {
  it("uses Next 16 async params and renders workspace-scoped Budget data", async () => {
    getBudgetPageData.mockResolvedValue({
      workspaceName: "我們的婚宴",
      canEdit: true,
      items: [],
      summary: emptySummary,
    });

    const { container } = render(
      await BudgetPage({
        params: Promise.resolve({ workspaceId: "workspace_1" }),
      }),
    );

    expect(getBudgetPageData).toHaveBeenCalledWith("workspace_1");
    expect(metadata.title).toBe("婚禮花費");
    expect(
      screen.getByRole("heading", { name: "我們的婚宴・婚禮花費" }),
    ).toBeInTheDocument();
    expect(screen.getByText("可編輯花費")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回我的婚宴" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(container.querySelector("main")).toHaveClass("max-w-6xl");
    expect(container.querySelector("header")).toHaveClass("sr-only");
    // compact 模式仍保留共享標題結構，內層文字欄維持易讀行寬。
    expect(container.querySelector("header > div:first-child")).toHaveClass(
      "max-w-3xl",
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const navigation = screen.getByRole("navigation", { name: "工作區功能" });
    expect(within(navigation).getAllByRole("link")).toHaveLength(7);
    expect(within(navigation).getByRole("link", { name: "花費" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const header = container.querySelector("header");
    const summaryHeading = screen.getByRole("heading", { name: "花費摘要" });
    const detailsHeading = screen.getByRole("heading", { name: "花費明細" });
    expect(header).not.toBeNull();
    expect(
      header!.compareDocumentPosition(summaryHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      summaryHeading.compareDocumentPosition(detailsHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("translates membership denial to generic not found", async () => {
    getBudgetPageData.mockRejectedValue(new WorkspaceAccessDeniedError());

    await expect(
      BudgetPage({
        params: Promise.resolve({ workspaceId: "workspace_secret" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("shows a sanitized inline retry state for Budget read failures", async () => {
    getBudgetPageData.mockRejectedValue(
      new BudgetItemDataError("目前無法載入婚禮花費，請稍後再試。"),
    );

    render(
      await BudgetPage({
        params: Promise.resolve({ workspaceId: "workspace_1" }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "婚禮花費暫時無法開啟" }),
    ).toBeInTheDocument();
    expect(screen.getByText("目前無法載入婚禮花費，請稍後再試。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "再試一次" })).toHaveAttribute(
      "href",
      "/workspaces/workspace_1/budget",
    );
  });

  it("keeps VIEWER visibly read-only", async () => {
    getBudgetPageData.mockResolvedValue({
      workspaceName: "我們的婚宴",
      canEdit: false,
      items: [],
      summary: emptySummary,
    });

    render(
      await BudgetPage({
        params: Promise.resolve({ workspaceId: "workspace_1" }),
      }),
    );

    expect(screen.getByText("唯讀花費")).toBeInTheDocument();
    expect(
      screen.getByText(
        "你目前是唯讀成員，可以查看花費，但不能新增、編輯、變更下訂付款狀態或移除。",
      ),
    ).toBeInTheDocument();
  });
});
