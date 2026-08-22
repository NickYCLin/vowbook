export const WEDDING_TASK_STATUSES = [
  "TODO",
  "IN_PROGRESS",
  "DONE",
] as const;

export type WeddingTaskStatusValue = (typeof WEDDING_TASK_STATUSES)[number];

export const WEDDING_TASK_SIDES = [
  "SHARED",
  "PARTNER_A",
  "PARTNER_B",
] as const;

export type WeddingTaskSideValue = (typeof WEDDING_TASK_SIDES)[number];

export const WEDDING_TASK_SIDE_LABELS: Record<WeddingTaskSideValue, string> = {
  SHARED: "共同任務",
  PARTNER_A: "男方任務",
  PARTNER_B: "女方任務",
};

export type WeddingTaskDetailsInput = {
  title: unknown;
  description: unknown;
  dueDate: unknown;
};

export type NormalizedWeddingTaskDetails = {
  title: string;
  description: string | null;
  dueDate: Date | null;
};

export class WeddingTaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeddingTaskValidationError";
  }
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function normalizeTitle(value: unknown): string {
  const normalized =
    typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";

  if (characterCount(normalized) < 1 || characterCount(normalized) > 120) {
    throw new WeddingTaskValidationError("任務名稱需為 1 到 120 個字元。");
  }

  return normalized;
}

function normalizeDescription(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (characterCount(normalized) > 1000) {
    throw new WeddingTaskValidationError("任務說明最多 1000 個字元。");
  }

  return normalized === "" ? null : normalized;
}

function normalizeDueDate(value: unknown): Date | null {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    value.startsWith("0000-")
  ) {
    throw new WeddingTaskValidationError("請輸入有效的到期日。");
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new WeddingTaskValidationError("請輸入有效的到期日。");
  }

  return date;
}

export function normalizeWeddingTaskDetails(
  input: WeddingTaskDetailsInput,
): NormalizedWeddingTaskDetails {
  return {
    title: normalizeTitle(input.title),
    description: normalizeDescription(input.description),
    dueDate: normalizeDueDate(input.dueDate),
  };
}

export function normalizeWeddingTaskSide(
  value: unknown,
): WeddingTaskSideValue {
  if (
    typeof value !== "string" ||
    !(WEDDING_TASK_SIDES as readonly string[]).includes(value)
  ) {
    throw new WeddingTaskValidationError("請選擇有效的任務歸屬。");
  }

  return value as WeddingTaskSideValue;
}

export function normalizeWeddingTaskStatus(
  value: unknown,
): WeddingTaskStatusValue {
  if (
    typeof value !== "string" ||
    !(WEDDING_TASK_STATUSES as readonly string[]).includes(value)
  ) {
    throw new WeddingTaskValidationError("請選擇有效的任務狀態。");
  }

  return value as WeddingTaskStatusValue;
}
