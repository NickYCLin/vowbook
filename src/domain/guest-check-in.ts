import type { GuestAttendanceStatusValue } from "@/domain/guest";

/**
 * 報到人數與邀請人數共用同一個上限：報到桌記錄的是「同一組實際到了幾位」，
 * 超過 20 位通常是打錯字，而不是真的有人帶了一整台遊覽車。
 */
export const MAX_GUEST_CHECK_IN_HEADCOUNT = 20;
const MAX_NOTES_CHARACTERS = 200;

export type GuestCheckInDetailsInput = {
  headcount: unknown;
  notes: unknown;
};

export type NormalizedGuestCheckInDetails = {
  headcount: number;
  notes: string | null;
};

export class GuestCheckInValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuestCheckInValidationError";
  }
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function normalizeHeadcount(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) {
    throw new GuestCheckInValidationError(
      `報到人數請輸入 1 到 ${MAX_GUEST_CHECK_IN_HEADCOUNT} 的整數。`,
    );
  }

  const headcount = Number(value);
  if (
    !Number.isSafeInteger(headcount) ||
    headcount > MAX_GUEST_CHECK_IN_HEADCOUNT
  ) {
    throw new GuestCheckInValidationError(
      `報到人數請輸入 1 到 ${MAX_GUEST_CHECK_IN_HEADCOUNT} 的整數。`,
    );
  }
  return headcount;
}

function normalizeNotes(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new GuestCheckInValidationError("報到備註格式無效。");
  }

  const normalized = value.trim();
  if (normalized === "") return null;
  if (characterCount(normalized) > MAX_NOTES_CHARACTERS) {
    throw new GuestCheckInValidationError(
      `報到備註最多 ${MAX_NOTES_CHARACTERS} 個字元。`,
    );
  }
  return normalized;
}

export function normalizeGuestCheckInDetails(
  input: GuestCheckInDetailsInput,
): NormalizedGuestCheckInDetails {
  return {
    headcount: normalizeHeadcount(input.headcount),
    notes: normalizeNotes(input.notes),
  };
}

export function normalizeGuestCheckInExpectedVersion(value: unknown): number {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new GuestCheckInValidationError(
      "報到版本資訊無效，請重新整理後再試。",
    );
  }

  const version = Number(value);
  if (!Number.isSafeInteger(version)) {
    throw new GuestCheckInValidationError(
      "報到版本資訊無效，請重新整理後再試。",
    );
  }
  return version;
}

export type GuestCheckInSummaryEntry = {
  attendanceStatus: GuestAttendanceStatusValue;
  partySize: number;
  checkedInHeadcount: number | null;
};

export type GuestCheckInSummary = {
  expectedGroups: number;
  expectedHeadcount: number;
  arrivedGroups: number;
  arrivedHeadcount: number;
  pendingGroups: number;
  pendingHeadcount: number;
  unexpectedGroups: number;
};

/**
 * 「預計」只看回覆出席的賓客，「實到」只看真的報到的那一列，兩邊各自累加。
 * 婚宴當天回覆不出席的人臨時出現是常態，這種人算進實到與 unexpectedGroups，
 * 但不會回頭改寫預計人數，免得報到桌看到的預計值一直跳動。
 */
export function summarizeGuestCheckIns(
  entries: readonly GuestCheckInSummaryEntry[],
): GuestCheckInSummary {
  const summary: GuestCheckInSummary = {
    expectedGroups: 0,
    expectedHeadcount: 0,
    arrivedGroups: 0,
    arrivedHeadcount: 0,
    pendingGroups: 0,
    pendingHeadcount: 0,
    unexpectedGroups: 0,
  };

  for (const entry of entries) {
    const attending = entry.attendanceStatus === "ATTENDING";
    const arrived = entry.checkedInHeadcount !== null;

    if (attending) {
      summary.expectedGroups += 1;
      summary.expectedHeadcount += entry.partySize;
    }
    if (arrived) {
      summary.arrivedGroups += 1;
      summary.arrivedHeadcount += entry.checkedInHeadcount ?? 0;
      if (!attending) summary.unexpectedGroups += 1;
    }
    if (attending && !arrived) {
      summary.pendingGroups += 1;
      summary.pendingHeadcount += entry.partySize;
    }
  }

  return summary;
}

export type GuestCheckInRecordSnapshot = {
  id: string;
  headcount: number;
  notes: string | null;
  version: number;
};

export type PendingGuestCheckInMutation =
  | { kind: "SAVE"; checkIn: GuestCheckInRecordSnapshot }
  | { kind: "CANCEL"; checkIn: GuestCheckInRecordSnapshot };

export type GuestCheckInReconciliation = {
  /** settled 代表本地快照的任務結束，之後一律以 server 為準。 */
  settled: boolean;
  checkIn: GuestCheckInRecordSnapshot | null;
};

export function sameGuestCheckIn(
  left: GuestCheckInRecordSnapshot | null,
  right: GuestCheckInRecordSnapshot | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.id === right.id &&
      left.headcount === right.headcount &&
      left.notes === right.notes &&
      left.version === right.version)
  );
}

/**
 * Server Action 成功後，RSC payload 還要一段時間才會帶著新資料回來。
 * 在那之前畫面要顯示自己剛剛存成功的結果，但也不能永遠蓋住 server：
 * 一旦 authoritative 版本追上、或協作者又改了同一筆，就必須立刻讓位。
 */
export function reconcileGuestCheckIn(
  pending: PendingGuestCheckInMutation | undefined,
  latest: GuestCheckInRecordSnapshot | null,
): GuestCheckInReconciliation {
  if (!pending) return { settled: true, checkIn: latest };

  if (pending.kind === "SAVE") {
    if (sameGuestCheckIn(pending.checkIn, latest)) {
      return { settled: true, checkIn: latest };
    }
    if (
      latest !== null &&
      (latest.id !== pending.checkIn.id ||
        latest.version > pending.checkIn.version)
    ) {
      return { settled: true, checkIn: latest };
    }
    if (latest === null) {
      // 這一輪 authoritative props 仍然沒有這筆報到，代表報到已被取消或
      // 從未寫入；不能讓本地快照變成永遠消不掉的幽靈人數。
      return { settled: true, checkIn: null };
    }
    return { settled: false, checkIn: pending.checkIn };
  }

  if (latest === null) return { settled: true, checkIn: null };
  if (
    latest.id === pending.checkIn.id &&
    latest.version <= pending.checkIn.version
  ) {
    // 這只是刪除前的舊 payload，繼續隱藏這筆報到。
    return { settled: false, checkIn: null };
  }
  return { settled: true, checkIn: latest };
}
