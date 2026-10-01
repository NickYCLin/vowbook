import {
  WEDDING_TASK_SIDES,
  type WeddingTaskSideValue,
} from "@/domain/wedding-task";

export const PACKING_SIDES = WEDDING_TASK_SIDES;

export type PackingSideValue = WeddingTaskSideValue;

export const PACKING_SIDE_LABELS: Record<PackingSideValue, string> = {
  PARTNER_A: "新郎",
  PARTNER_B: "新娘",
  SHARED: "共用",
};

/** 打包清單依新郎、新娘、共用分欄。 */
export const PACKING_SIDE_ORDER: readonly PackingSideValue[] = [
  "PARTNER_A",
  "PARTNER_B",
  "SHARED",
];

export class PackingItemValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackingItemValidationError";
  }
}

export function normalizePackingItemTitle(value: unknown): string {
  const normalized =
    typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
  const length = Array.from(normalized).length;
  if (length < 1 || length > 80) {
    throw new PackingItemValidationError("物品名稱需為 1 到 80 個字元。");
  }
  return normalized;
}

export function normalizePackingSide(value: unknown): PackingSideValue {
  if (
    typeof value !== "string" ||
    !(PACKING_SIDES as readonly string[]).includes(value)
  ) {
    throw new PackingItemValidationError("請選擇新郎、新娘或共用。");
  }
  return value as PackingSideValue;
}

export const PACKING_CATEGORIES = ["PERSONAL", "WEDDING_SUPPLY"] as const;

export type PackingCategoryValue = (typeof PACKING_CATEGORIES)[number];

export const PACKING_CATEGORY_LABELS: Record<PackingCategoryValue, string> = {
  PERSONAL: "個人物品",
  WEDDING_SUPPLY: "宴客用品",
};

/** 表單未帶分類時視為個人物品，相容既有的新增表單。 */
export function normalizePackingCategory(value: unknown): PackingCategoryValue {
  if (value === null || value === undefined || value === "") return "PERSONAL";
  if (
    typeof value !== "string" ||
    !(PACKING_CATEGORIES as readonly string[]).includes(value)
  ) {
    throw new PackingItemValidationError("請選擇個人物品或宴客用品。");
  }
  return value as PackingCategoryValue;
}

export function normalizePackingNote(value: unknown): string | null {
  const normalized =
    typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
  if (normalized.length === 0) return null;
  if (Array.from(normalized).length > 60) {
    throw new PackingItemValidationError("數量／備註最多 60 個字元。");
  }
  return normalized;
}

/** 只有婚禮小物是自己要帶去會館的實物；互動、佈置多為廠商服務。 */
export const PACKING_SUPPLY_TAXONOMY_KEYS: readonly string[] = [
  "ITEM_WEDDING_FAVORS",
];

const PACKING_SKIPPED_NAME_PATTERN = /融化|損毀|作廢/u;
const PACKING_MATCH_PREFIX_LENGTH = 3;

function packingMatchCore(title: string): string {
  return title
    .replace(/[（(][^）)]*[）)]/gu, "")
    .replace(/\s+/gu, "")
    .toLowerCase();
}

function isCoveredByExisting(title: string, existingCores: readonly string[]) {
  const core = packingMatchCore(title);
  if (core.length === 0) return false;
  return existingCores.some((existing) => {
    if (existing.length === 0) return false;
    if (core.includes(existing) || existing.includes(core)) return true;
    const chars = Array.from(core);
    const other = Array.from(existing);
    let shared = 0;
    while (shared < chars.length && chars[shared] === other[shared]) shared += 1;
    return shared >= PACKING_MATCH_PREFIX_LENGTH;
  });
}

export type PackingSupplySource = {
  id: string;
  parentId: string | null;
  name: string;
  kind: string;
  systemTaxonomyKey: string | null;
  relatedTaxonomyItemKey: string | null;
  preparationStatus?: string | null;
  plannedAmount?: number | null;
  actualAmount?: number | null;
};

const PACKING_SKIPPED_PREPARATION = new Set(["NOT_PLANNED", "VENDOR_PROVIDED"]);

export function suggestPackingSupplies(
  budgetItems: readonly PackingSupplySource[],
  existingTitles: readonly string[],
): string[] {
  const byId = new Map(budgetItems.map((item) => [item.id, item]));
  const isSupplyNode = (item: PackingSupplySource) =>
    PACKING_SUPPLY_TAXONOMY_KEYS.includes(item.systemTaxonomyKey ?? "") ||
    PACKING_SUPPLY_TAXONOMY_KEYS.includes(item.relatedTaxonomyItemKey ?? "");
  const belongsToSupplies = (item: PackingSupplySource) => {
    const visited = new Set<string>();
    let current: PackingSupplySource | undefined = item;
    while (current && !visited.has(current.id)) {
      if (isSupplyNode(current)) return true;
      visited.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return false;
  };
  const existingCores = existingTitles.map(packingMatchCore);
  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const item of budgetItems) {
    if (item.kind !== "EXPENSE" || !belongsToSupplies(item)) continue;
    if (PACKING_SKIPPED_PREPARATION.has(item.preparationStatus ?? "")) continue;
    if (PACKING_SKIPPED_NAME_PATTERN.test(item.name)) continue;
    if (
      item.plannedAmount !== undefined &&
      (item.plannedAmount ?? 0) <= 0 &&
      (item.actualAmount ?? 0) <= 0
    ) {
      continue;
    }
    const title = item.name.trim().replace(/\s+/gu, " ");
    const length = Array.from(title).length;
    if (length < 1 || length > 80 || seen.has(title)) continue;
    if (isCoveredByExisting(title, existingCores)) continue;
    seen.add(title);
    suggestions.push(title);
  }
  return suggestions;
}
