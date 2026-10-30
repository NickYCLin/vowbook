import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BudgetVisualization } from "./budget-visualization";
const data = { available: true, plannedTotal: 400, actualTotal: 40, missingActualCount: 1, actualRecordedCount: 1, rows: [
  { key: "one", label: "分類一", plannedAmount: 100, actualAmount: 40 }, { key: "two", label: "分類二", plannedAmount: 300, actualAmount: 0 },
] };
describe("budget distribution", () => {
  it("shows planned distribution and changes to recorded actuals without substituting planned amounts", () => {
    render(<BudgetVisualization data={data} />);
    expect(screen.getByRole("img")).toHaveAccessibleName("預計花費分類圓環圖，合計NT$400");
    expect(screen.getByText("NT$300（75.0%）")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "實際花費" }));
    expect(screen.getByRole("img")).toHaveAccessibleName("實際花費分類圓環圖，合計NT$40");
    expect(screen.queryByText("分類二")).not.toBeInTheDocument();
    expect(screen.getByText(/另有 1 筆尚未填寫實際金額/)).toBeVisible();
  });
  it("distinguishes missing actual data from a recorded zero", () => {
    const { rerender } = render(<BudgetVisualization data={{ ...data, rows: [], actualTotal: 0, actualRecordedCount: 0 }} />);
    fireEvent.click(screen.getByRole("button", { name: "實際花費" }));
    expect(screen.getByRole("status")).toHaveTextContent("尚未登記實際花費。");
    rerender(<BudgetVisualization data={{ ...data, rows: [], actualTotal: 0, actualRecordedCount: 1 }} />);
    expect(screen.getByRole("status")).toHaveTextContent("已登記的實際花費目前為 0 元。");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
  it("does not draw unsafe totals", () => {
    render(<BudgetVisualization data={{ ...data, available: false }} />);
    expect(screen.getByText(/超出圖表可安全表示/)).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
