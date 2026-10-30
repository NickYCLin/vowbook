import { BUDGET_TAXONOMY_ITEM_LABELS, isBudgetTaxonomyItemKey } from "./budget-item";

export type BudgetVisualizationItem = {
  id: string; parentId: string | null; kind: string; source: string; systemTaxonomyKey?: string | null;
  plannedAmount: number; actualAmount: number | null; depositAmount: number | null;
  balanceAmount: number | null; additionalAmount: number | null; preparationStatus?: string | null;
};
export type BudgetVisualizationRow = { key: string; label: string; plannedAmount: number; actualAmount: number };
export type BudgetVisualization = { available: boolean; rows: BudgetVisualizationRow[]; plannedTotal: number; actualTotal: number;
  missingActualCount: number; actualRecordedCount: number };

export function buildBudgetVisualization(items: readonly BudgetVisualizationItem[], derived: readonly { key: string; name: string; amount: number }[]): BudgetVisualization {
  const byId = new Map(items.map((item) => [item.id, item]));
  const parents = new Set(items.flatMap((item) => item.parentId ? [item.parentId] : []));
  const grouped = new Map<string, { key: string; label: string; planned: bigint; actual: bigint }>();
  let missingActualCount = 0;
  let actualRecordedCount = 0;
  const add = (key: string, label: string, planned: number, actual: number) => {
    if (!Number.isSafeInteger(planned) || !Number.isSafeInteger(actual) || planned < 0 || actual < 0) return false;
    const current = grouped.get(key) ?? { key, label, planned: BigInt(0), actual: BigInt(0) };
    current.planned += BigInt(planned); current.actual += BigInt(actual); grouped.set(key, current);
    return true;
  };
  const unavailable = (): BudgetVisualization => ({ available: false, rows: [], plannedTotal: 0, actualTotal: 0, missingActualCount, actualRecordedCount });
  for (const item of items) {
    if (item.kind !== "EXPENSE" || (item.preparationStatus ?? "NEEDS_ACTION") !== "NEEDS_ACTION") continue;
    if (item.source === "NOTION" && parents.has(item.id) && item.plannedAmount === 0 && item.actualAmount === null &&
        item.depositAmount === null && item.balanceAmount === null && item.additionalAmount === null) continue;
    let cursor: BudgetVisualizationItem | undefined = item;
    let key = "uncategorized";
    let label = "未分類";
    for (let depth = 0; cursor && depth < 32; depth += 1) {
      if (isBudgetTaxonomyItemKey(cursor.systemTaxonomyKey)) {
        key = cursor.systemTaxonomyKey; label = BUDGET_TAXONOMY_ITEM_LABELS[cursor.systemTaxonomyKey]; break;
      }
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    if (item.actualAmount === null) missingActualCount += 1; else actualRecordedCount += 1;
    if (!add(key, label, item.plannedAmount, item.actualAmount ?? 0)) return unavailable();
  }
  for (const cost of derived) if (!add(`derived:${cost.key}`, cost.name, cost.amount, 0)) return unavailable();
  const planned = [...grouped.values()].reduce((total, row) => total + row.planned, BigInt(0));
  const actual = [...grouped.values()].reduce((total, row) => total + row.actual, BigInt(0));
  if (planned > BigInt(Number.MAX_SAFE_INTEGER) || actual > BigInt(Number.MAX_SAFE_INTEGER)) return unavailable();
  const rows = [...grouped.values()].filter((row) => row.planned > BigInt(0) || row.actual > BigInt(0)).map((row) => ({
    key: row.key, label: row.label, plannedAmount: Number(row.planned), actualAmount: Number(row.actual),
  })).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  return { available: true, rows, plannedTotal: Number(planned), actualTotal: Number(actual), missingActualCount, actualRecordedCount };
}
