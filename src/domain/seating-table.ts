import type { GuestSideValue } from "./guest";

export type SeatingTableInput = {
  name: unknown;
  capacity: unknown;
  notes: unknown;
};

export type NormalizedSeatingTableInput = {
  name: string;
  capacity: number;
  notes: string | null;
};

export const MAX_SEATING_TABLE_COUNT = 200;

/**
 * 桌號：印在桌卡、也是賓客口中「我坐幾桌」的那個號碼。
 *
 * 規則有三條，都是婚宴現場的慣例而不是技術限制：
 * 1. 第一順位一定是 1 號，也就是主桌。
 * 2. 跳過所有含「4」的數字（4、14、24、40～49…）。台灣的建築樓層就是這樣
 *    編的，只跳單獨的 4 而留下 14 反而會被長輩挑。
 * 3. 跳過 13。
 *
 * 4 是逐位判斷、13 是整個號碼比對：4 不管出現在哪一位都諧音「死」，13 則是
 * 那個號碼本身不吉利，113、130 沒有人忌諱，跟著一起跳只會白白浪費號碼。
 *
 * 桌號是從順位推導的，不存進資料庫：中間那桌被刪掉時後面要自動遞補，存起來
 * 就會留下一個沒有人坐的缺號。
 */
const AVOIDED_TABLE_NUMBERS = new Set([13]);

function isAvoidedTableNumber(value: number): boolean {
  return String(value).includes("4") || AVOIDED_TABLE_NUMBERS.has(value);
}

/** 依序取得前 count 個桌號。count 為 0 時回傳空陣列。 */
export function seatingTableNumbers(count: number): number[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new SeatingTableValidationError("桌次數量需為 0 以上的整數。");
  }

  const numbers: number[] = [];
  let candidate = 0;
  while (numbers.length < count) {
    candidate += 1;
    if (isAvoidedTableNumber(candidate)) {
      continue;
    }
    numbers.push(candidate);
  }

  return numbers;
}

/** 第 rank 順位（1 起算）的桌號。 */
export function seatingTableNumber(rank: number): number {
  if (!Number.isInteger(rank) || rank < 1) {
    throw new SeatingTableValidationError("桌次順位需為 1 以上的整數。");
  }

  const numbers = seatingTableNumbers(rank);
  return numbers[rank - 1]!;
}

/**
 * 一桌屬於哪一邊，從實際入座的賓客推得——桌次本身沒有「關係」這個欄位。
 *
 * 全部同一邊就算那一邊；只要混坐、或有共同親友在座，就算共同親友：一桌坐了
 * 男方同事又坐了女方同學，標成任何一邊都是錯的。還沒安排賓客的桌回傳 null，
 * 空桌不該被貼上任何一邊的標籤。
 */
export function seatingTableSide(
  guests: ReadonlyArray<{ side: GuestSideValue }>,
): GuestSideValue | null {
  if (guests.length === 0) {
    return null;
  }
  const first = guests[0]!.side;
  if (first === "SHARED") {
    return "SHARED";
  }
  return guests.every((guest) => guest.side === first) ? first : "SHARED";
}

/**
 * 指名某一桌的說法。桌名可以重複，凡是要講「哪一桌」的文字都得帶上桌號，
 * 否則畫面上會出現三個一模一樣的「同事桌」。
 */
export function seatingTableLabel(table: {
  number: number;
  name: string;
}): string {
  return `${table.number} 號桌 ${table.name}`;
}

/**
 * 把桌號掛到已經照順位排好的桌次上。呼叫端必須先排序——桌號完全由順序決定，
 * 傳一份沒排過的清單進來會編出一組看起來對、其實跟畫面對不起來的號碼。
 */
export function withSeatingTableNumbers<Table>(
  orderedTables: readonly Table[],
): Array<Table & { number: number }> {
  const numbers = seatingTableNumbers(orderedTables.length);
  return orderedTables.map((table, index) => ({
    ...table,
    number: numbers[index]!,
  }));
}

export type SeatingTableAdjustmentInput = {
  totalTableCount: unknown;
  defaultCapacity: unknown;
};

export type NormalizedSeatingTableAdjustmentInput = {
  totalTableCount: number;
  defaultCapacity: number;
};

export type SeatingTableLayoutInput = {
  layoutX: unknown;
  layoutY: unknown;
};

export type NormalizedSeatingTableLayoutInput = {
  layoutX: number | null;
  layoutY: number | null;
};

export class SeatingTableValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeatingTableValidationError";
  }
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function normalizeName(value: unknown): string {
  const normalized =
    typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";

  if (characterCount(normalized) < 1 || characterCount(normalized) > 80) {
    throw new SeatingTableValidationError("桌名需為 1 到 80 個字元。");
  }

  return normalized;
}

function normalizeCapacity(value: unknown): number {
  let parsed: number;

  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    parsed = Number(value.trim());
  } else {
    throw new SeatingTableValidationError("桌次容量需為 1 到 100 的整數。");
  }

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new SeatingTableValidationError("桌次容量需為 1 到 100 的整數。");
  }

  return parsed;
}

function normalizeNotes(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (characterCount(normalized) > 500) {
    throw new SeatingTableValidationError("備註最多 500 個字元。");
  }

  return normalized === "" ? null : normalized;
}

export function normalizeSeatingTableInput(
  input: SeatingTableInput,
): NormalizedSeatingTableInput {
  return {
    name: normalizeName(input.name),
    capacity: normalizeCapacity(input.capacity),
    notes: normalizeNotes(input.notes),
  };
}

export function normalizeSeatingTableAdjustmentInput(
  input: SeatingTableAdjustmentInput,
): NormalizedSeatingTableAdjustmentInput {
  const rawCount = input.totalTableCount;
  const totalTableCount =
    typeof rawCount === "number"
      ? rawCount
      : typeof rawCount === "string" && /^\d+$/u.test(rawCount.trim())
        ? Number(rawCount.trim())
        : Number.NaN;

  if (
    !Number.isInteger(totalTableCount) ||
    totalTableCount < 0 ||
    totalTableCount > MAX_SEATING_TABLE_COUNT
  ) {
    throw new SeatingTableValidationError(
      `總桌數需為 0 到 ${MAX_SEATING_TABLE_COUNT} 的整數。`,
    );
  }

  return {
    totalTableCount,
    defaultCapacity: normalizeCapacity(input.defaultCapacity),
  };
}

export function normalizeSeatingTableVersion(value: unknown): number {
  const version =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/u.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isSafeInteger(version) || version < 0) {
    throw new SeatingTableValidationError(
      "桌次版本無效，請重新整理後再試。",
    );
  }

  return version;
}

function isBlankLayoutCoordinate(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

function normalizeLayoutCoordinate(value: unknown): number {
  const coordinate =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/u.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isInteger(coordinate) || coordinate < 0 || coordinate > 1000) {
    throw new SeatingTableValidationError(
      "場地座標需為 0 到 1000 的整數。",
    );
  }

  return coordinate;
}

export function normalizeSeatingTableLayoutInput(
  input: SeatingTableLayoutInput,
): NormalizedSeatingTableLayoutInput {
  const xIsBlank = isBlankLayoutCoordinate(input.layoutX);
  const yIsBlank = isBlankLayoutCoordinate(input.layoutY);

  if (xIsBlank !== yIsBlank) {
    throw new SeatingTableValidationError("場地座標必須成對設定。");
  }
  if (xIsBlank && yIsBlank) {
    return { layoutX: null, layoutY: null };
  }

  return {
    layoutX: normalizeLayoutCoordinate(input.layoutX),
    layoutY: normalizeLayoutCoordinate(input.layoutY),
  };
}
