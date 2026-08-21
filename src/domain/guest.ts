export const GUEST_SIDES = ["PARTNER_A", "PARTNER_B", "SHARED"] as const;
export const GUEST_CATEGORIES = ["GUEST", "COUPLE", "FAMILY"] as const;
export const GUEST_CATEGORY_LABELS = {
  GUEST: "一般賓客",
  COUPLE: "新人",
  FAMILY: "家人",
} as const satisfies Record<(typeof GUEST_CATEGORIES)[number], string>;
export const GUEST_SIDE_LABELS = {
  PARTNER_A: "男方親友",
  PARTNER_B: "女方親友",
  SHARED: "共同親友",
} as const satisfies Record<(typeof GUEST_SIDES)[number], string>;
/** 場地圖的圓桌只有幾十像素寬，「男方親友」四個字擠不下。 */
export const GUEST_SIDE_SHORT_LABELS = {
  PARTNER_A: "男方",
  PARTNER_B: "女方",
  SHARED: "共同",
} as const satisfies Record<(typeof GUEST_SIDES)[number], string>;
export const GUEST_ATTENDANCE_STATUSES = [
  "UNDECIDED",
  "ATTENDING",
  "DECLINED",
] as const;

export type GuestSideValue = (typeof GUEST_SIDES)[number];
export type GuestCategoryValue = (typeof GUEST_CATEGORIES)[number];

export function guestIdentityLabel(
  category: GuestCategoryValue,
  side: GuestSideValue,
): string {
  if (category === "GUEST") return GUEST_SIDE_LABELS[side];
  if (category === "COUPLE") {
    if (side === "PARTNER_A") return "新郎";
    if (side === "PARTNER_B") return "新娘";
    return "新人";
  }
  if (side === "PARTNER_A") return "新郎家人";
  if (side === "PARTNER_B") return "新娘家人";
  return "家人";
}
export type GuestAttendanceStatusValue =
  (typeof GUEST_ATTENDANCE_STATUSES)[number];

export type GuestInput = {
  name: unknown;
  category?: unknown;
  side: unknown;
  attendanceStatus: unknown;
  partySize: unknown;
  notes: unknown;
};

export type NormalizedGuestInput = {
  name: string;
  category: GuestCategoryValue;
  side: GuestSideValue;
  attendanceStatus: GuestAttendanceStatusValue;
  partySize: number;
  notes: string | null;
};

export class GuestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuestValidationError";
  }
}

export function normalizeGuestVersion(value: unknown): number {
  const version =
    typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value)
      ? Number(value)
      : value;

  if (
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 0
  ) {
    throw new GuestValidationError("賓客資料版本無效，請重新整理後再試。");
  }

  return version;
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function normalizeName(value: unknown): string {
  const normalized = typeof value === "string"
    ? value.trim().replace(/\s+/gu, " ")
    : "";

  if (characterCount(normalized) < 1 || characterCount(normalized) > 80) {
    throw new GuestValidationError("賓客姓名需為 1 到 80 個字元。");
  }

  return normalized;
}

function normalizePartySize(value: unknown): number {
  let parsed: number;

  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    parsed = Number(value.trim());
  } else {
    throw new GuestValidationError("邀請人數需為 1 到 20 的整數。");
  }

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    throw new GuestValidationError("邀請人數需為 1 到 20 的整數。");
  }

  return parsed;
}

function normalizeNotes(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (characterCount(normalized) > 500) {
    throw new GuestValidationError("備註最多 500 個字元。");
  }

  return normalized === "" ? null : normalized;
}

function isGuestCategory(value: unknown): value is GuestCategoryValue {
  return (
    typeof value === "string" &&
    (GUEST_CATEGORIES as readonly string[]).includes(value)
  );
}

function isGuestSide(value: unknown): value is GuestSideValue {
  return (
    typeof value === "string" &&
    (GUEST_SIDES as readonly string[]).includes(value)
  );
}

function isGuestAttendanceStatus(
  value: unknown,
): value is GuestAttendanceStatusValue {
  return (
    typeof value === "string" &&
    (GUEST_ATTENDANCE_STATUSES as readonly string[]).includes(value)
  );
}

export function normalizeGuestInput(input: GuestInput): NormalizedGuestInput {
  const category = input.category ?? "GUEST";
  if (!isGuestCategory(category)) {
    throw new GuestValidationError("請選擇有效的名單身份。");
  }

  if (!isGuestSide(input.side)) {
    throw new GuestValidationError("請選擇賓客與新人的關係。");
  }

  if (!isGuestAttendanceStatus(input.attendanceStatus)) {
    throw new GuestValidationError("請選擇有效的出席狀態。");
  }

  const partySize = normalizePartySize(input.partySize);
  if (category !== "GUEST" && input.side === "SHARED") {
    throw new GuestValidationError("新人與家人需選擇新郎或新娘一方。");
  }
  if (category !== "GUEST" && partySize !== 1) {
    throw new GuestValidationError("新人與家人請一人建立一筆名單。");
  }

  return {
    name: normalizeName(input.name),
    category,
    side: input.side,
    attendanceStatus: input.attendanceStatus,
    partySize,
    notes: normalizeNotes(input.notes),
  };
}
