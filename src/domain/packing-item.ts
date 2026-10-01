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
