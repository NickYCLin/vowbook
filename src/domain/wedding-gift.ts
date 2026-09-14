const MAX_TWD_AMOUNT = 2_147_483_647;
const MAX_NOTES_CHARACTERS = 500;

export type WeddingGiftDetailsInput = {
  amount: unknown;
  notes: unknown;
};

export type NormalizedWeddingGiftDetails = {
  amount: number;
  notes: string | null;
};

export class WeddingGiftValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeddingGiftValidationError";
  }
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function normalizeAmount(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) {
    throw new WeddingGiftValidationError(
      `禮金金額請輸入 1 到 ${MAX_TWD_AMOUNT} 的整數。`,
    );
  }

  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount > MAX_TWD_AMOUNT) {
    throw new WeddingGiftValidationError(
      `禮金金額請輸入 1 到 ${MAX_TWD_AMOUNT} 的整數。`,
    );
  }
  return amount;
}

function normalizeNotes(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new WeddingGiftValidationError("禮金備註格式無效。");
  }

  const normalized = value.trim();
  if (normalized === "") return null;
  if (characterCount(normalized) > MAX_NOTES_CHARACTERS) {
    throw new WeddingGiftValidationError(
      `禮金備註最多 ${MAX_NOTES_CHARACTERS} 個字元。`,
    );
  }
  return normalized;
}

export function normalizeWeddingGiftDetails(
  input: WeddingGiftDetailsInput,
): NormalizedWeddingGiftDetails {
  return {
    amount: normalizeAmount(input.amount),
    notes: normalizeNotes(input.notes),
  };
}

export function normalizeWeddingGiftExpectedVersion(value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)$/u.test(value)
  ) {
    throw new WeddingGiftValidationError(
      "禮金版本資訊無效，請重新整理後再試。",
    );
  }

  const version = Number(value);
  if (!Number.isSafeInteger(version) || version > MAX_TWD_AMOUNT) {
    throw new WeddingGiftValidationError(
      "禮金版本資訊無效，請重新整理後再試。",
    );
  }
  return version;
}

const MAX_RETURN_NOTE_CHARACTERS = 200;

export function normalizeWeddingGiftReturnNote(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new WeddingGiftValidationError("回禮備註格式無效。");
  }
  const normalized = value.trim();
  if (normalized === "") return null;
  if (characterCount(normalized) > MAX_RETURN_NOTE_CHARACTERS) {
    throw new WeddingGiftValidationError(
      `回禮備註最多 ${MAX_RETURN_NOTE_CHARACTERS} 個字元。`,
    );
  }
  return normalized;
}

export const WEDDING_GIFT_SORTS = [
  "ROSTER",
  "AMOUNT_DESC",
  "AMOUNT_ASC",
  "NAME",
  "RECENT",
] as const;

export type WeddingGiftSort = (typeof WEDDING_GIFT_SORTS)[number];

export const WEDDING_GIFT_SORT_LABELS = {
  ROSTER: "名單順序",
  AMOUNT_DESC: "金額由高到低",
  AMOUNT_ASC: "金額由低到高",
  NAME: "姓名",
  RECENT: "最近登記",
} as const satisfies Record<WeddingGiftSort, string>;

export function isWeddingGiftSort(value: unknown): value is WeddingGiftSort {
  return (WEDDING_GIFT_SORTS as readonly unknown[]).includes(value);
}

export type WeddingGiftSortEntry = {
  name: string;
  weddingGift: {
    amount: number;
    createdAt?: Date | string | null;
  } | null;
};

function createdAtValue(entry: WeddingGiftSortEntry): number {
  const createdAt = entry.weddingGift?.createdAt;
  if (!createdAt) return Number.NEGATIVE_INFINITY;
  const time = new Date(createdAt).getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/**
 * 排序一律以名單順序為最終 tie-break，讓相同金額或同名的兩列不會在每次
 * 重繪時互換位置。沒有禮金的邀請群組在金額與登記時間排序中一律排最後：
 * 「還沒收到」不是一個可以跟金額比大小的數值。
 */
export function sortWeddingGiftEntries<Entry extends WeddingGiftSortEntry>(
  entries: readonly Entry[],
  sort: WeddingGiftSort,
): Entry[] {
  const withRosterIndex = entries.map((entry, rosterIndex) => ({
    entry,
    rosterIndex,
  }));

  withRosterIndex.sort((left, right) => {
    if (sort === "ROSTER") return left.rosterIndex - right.rosterIndex;

    if (sort === "NAME") {
      const byName = left.entry.name.localeCompare(right.entry.name, "zh-Hant");
      if (byName !== 0) return byName;
      return left.rosterIndex - right.rosterIndex;
    }

    const leftRecorded = left.entry.weddingGift !== null;
    const rightRecorded = right.entry.weddingGift !== null;
    if (leftRecorded !== rightRecorded) return leftRecorded ? -1 : 1;
    if (!leftRecorded) return left.rosterIndex - right.rosterIndex;

    if (sort === "RECENT") {
      const byRecent = createdAtValue(right.entry) - createdAtValue(left.entry);
      if (byRecent !== 0) return byRecent;
      return left.rosterIndex - right.rosterIndex;
    }

    const leftAmount = left.entry.weddingGift?.amount ?? 0;
    const rightAmount = right.entry.weddingGift?.amount ?? 0;
    const byAmount =
      sort === "AMOUNT_DESC"
        ? rightAmount - leftAmount
        : leftAmount - rightAmount;
    if (byAmount !== 0) return byAmount;
    return left.rosterIndex - right.rosterIndex;
  });

  return withRosterIndex.map(({ entry }) => entry);
}

export type WeddingGiftReturnEntry = {
  attendanceStatus: "UNDECIDED" | "ATTENDING" | "DECLINED";
  weddingGift: { returnGiftSentAt?: Date | string | null } | null;
  checkIn: unknown | null;
};

/**
 * 禮到人不到：已收到禮金、明確回覆不出席，且沒有實際報到紀錄。
 * 未報到不代表缺席，尤其婚宴尚未開始時；已報到則優先於先前的不出席回覆。
 */
export function isWeddingGiftWithoutAttendance(
  entry: WeddingGiftReturnEntry,
): boolean {
  if (entry.weddingGift === null) return false;
  return entry.attendanceStatus === "DECLINED" && entry.checkIn === null;
}

export function isWeddingGiftReturnPending(
  entry: WeddingGiftReturnEntry,
): boolean {
  return (
    isWeddingGiftWithoutAttendance(entry) &&
    !entry.weddingGift?.returnGiftSentAt
  );
}
