import { describe, expect, it } from "vitest";
import { buildBudgetVisualization, type BudgetVisualizationItem } from "./budget-visualization";
const expense = (overrides: Partial<BudgetVisualizationItem> = {}): BudgetVisualizationItem => ({
  id: "expense", parentId: "category", kind: "EXPENSE", source: "MANUAL", systemTaxonomyKey: null,
  plannedAmount: 100, actualAmount: null, depositAmount: null, balanceAmount: null, additionalAmount: null,
  preparationStatus: "NEEDS_ACTION", ...overrides,
});
const category = expense({ id: "category", parentId: null, kind: "GROUP", systemTaxonomyKey: "ITEM_WEDDING_PHOTOGRAPHY", plannedAmount: 9000 });
describe("budget visualization preserves existing totals", () => {
  it("counts direct expense amounts, never hierarchy group rollups", () => {
    const result = buildBudgetVisualization([category, expense(), expense({ id: "second", plannedAmount: 300, actualAmount: 200 })], []);
    expect(result).toMatchObject({ available: true, plannedTotal: 400, actualTotal: 200, missingActualCount: 1 });
    expect(result.rows).toEqual([{ key: "ITEM_WEDDING_PHOTOGRAPHY", label: "婚禮紀錄", plannedAmount: 400, actualAmount: 200 }]);
  });
  it("excludes self-provided, vendor-provided and skipped expenses", () => {
    const rows = ["ALREADY_OWNED", "VENDOR_PROVIDED", "NOT_PLANNED"].map((preparationStatus) => expense({ preparationStatus }));
    expect(buildBudgetVisualization(rows, [])).toMatchObject({ plannedTotal: 0, actualTotal: 0, missingActualCount: 0, rows: [] });
  });
  it("adds derived costs only to planned spending, not recorded actuals", () => {
    const result = buildBudgetVisualization([expense({ actualAmount: 0 })], [{ key: "STAFF_MEAL", name: "工作人員便當", amount: 600 }]);
    expect(result).toMatchObject({ plannedTotal: 700, actualTotal: 0, actualRecordedCount: 1, missingActualCount: 0 });
    expect(result.rows.find((row) => row.key === "derived:STAFF_MEAL")).toMatchObject({ plannedAmount: 600, actualAmount: 0 });
  });
  it("does not treat empty imported intermediate headings as missing actual expenses", () => {
    const heading = expense({ id: "heading", source: "NOTION", plannedAmount: 0 });
    const result = buildBudgetVisualization([heading, expense({ id: "child", parentId: "heading", actualAmount: 40 })], []);
    expect(result).toMatchObject({ plannedTotal: 100, actualTotal: 40, missingActualCount: 0, actualRecordedCount: 1 });
  });
  it("keeps unclassified amounts and supports totals beyond 32-bit integers", () => {
    const result = buildBudgetVisualization([expense({ plannedAmount: 2_147_483_647 }), expense({ id: "other", plannedAmount: 2_147_483_647 })], []);
    expect(result.plannedTotal).toBe(4_294_967_294);
    expect(result.rows[0].label).toBe("未分類");
  });
  it("refuses to draw rounded unsafe totals instead of inventing an inaccurate chart", () => {
    expect(buildBudgetVisualization([expense({ plannedAmount: Number.MAX_SAFE_INTEGER }), expense({ id: "extra", plannedAmount: 1 })], []))
      .toMatchObject({ available: false, rows: [] });
  });
});
