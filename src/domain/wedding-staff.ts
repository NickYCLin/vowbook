export const MAX_WEDDING_STAFF_MEAL_COUNT = 99;
export const MAX_WEDDING_STAFF_RED_ENVELOPE_AMOUNT = 2_147_483_647;

export type WeddingStaffDetailsInput = {
  roleName: unknown;
  personName: unknown;
  contactPhone: unknown;
  notes: unknown;
  needsMeal?: unknown;
  mealCount?: unknown;
  vegetarianMealCount?: unknown;
  redEnvelopeAmount?: unknown;
};

export type NormalizedWeddingStaffDetails = {
  roleName: string;
  personName: string;
  contactPhone: string | null;
  notes: string | null;
  mealCount: number | null;
  vegetarianMealCount: number | null;
  redEnvelopeAmount: number | null;
};

export type WeddingStaffRedEnvelopeSummary = {
  plannedCount: number;
  plannedAmount: number;
  sentCount: number;
  sentAmount: number;
  pendingCount: number;
  pendingAmount: number;
};

export type WeddingStaffMealSummary = {
  entryCount: number;
  mealCount: number;
  vegetarianMealCount: number;
  nonVegetarianMealCount: number;
};

export class WeddingStaffValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeddingStaffValidationError";
  }
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function requiredText(
  value: unknown,
  label: string,
  maximum: number,
): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  const count = characterCount(normalized);
  if (count < 1 || count > maximum) {
    throw new WeddingStaffValidationError(
      `${label}需為 1 到 ${maximum} 個字元。`,
    );
  }
  return normalized;
}

function optionalText(
  value: unknown,
  label: string,
  maximum: number,
): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (characterCount(normalized) > maximum) {
    throw new WeddingStaffValidationError(`${label}最多 ${maximum} 個字元。`);
  }
  return normalized === "" ? null : normalized;
}

function mealHeadcount(value: unknown, label: string, minimum: number): number {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value.trim())) {
    throw new WeddingStaffValidationError(
      `${label}需為 ${minimum} 到 ${MAX_WEDDING_STAFF_MEAL_COUNT} 的整數。`,
    );
  }
  const parsed = Number(value.trim());
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > MAX_WEDDING_STAFF_MEAL_COUNT
  ) {
    throw new WeddingStaffValidationError(
      `${label}需為 ${minimum} 到 ${MAX_WEDDING_STAFF_MEAL_COUNT} 的整數。`,
    );
  }
  return parsed;
}

/**
 * 不需要便當時兩個欄位一起留白；需要便當時份數至少 1 份，素食份數是其中
 * 的一部分，葷食一律由「份數 − 素食」推得，避免兩邊各記一次而互相矛盾。
 */
function normalizeMeal(input: WeddingStaffDetailsInput): {
  mealCount: number | null;
  vegetarianMealCount: number | null;
} {
  const needsMeal =
    input.needsMeal === "on" ||
    input.needsMeal === "true" ||
    input.needsMeal === true;
  if (!needsMeal) return { mealCount: null, vegetarianMealCount: null };

  const rawMealCount =
    input.mealCount === undefined || input.mealCount === null
      ? "1"
      : input.mealCount;
  const mealCount = mealHeadcount(rawMealCount, "便當份數", 1);

  const rawVegetarian =
    input.vegetarianMealCount === undefined ||
    input.vegetarianMealCount === null ||
    input.vegetarianMealCount === ""
      ? "0"
      : input.vegetarianMealCount;
  const vegetarianMealCount = mealHeadcount(rawVegetarian, "素食份數", 0);
  if (vegetarianMealCount > mealCount) {
    throw new WeddingStaffValidationError(
      "素食份數不能超過便當份數。",
    );
  }
  return { mealCount, vegetarianMealCount };
}

export function summarizeWeddingStaffMeals(
  entries: ReadonlyArray<{
    mealCount: number | null;
    vegetarianMealCount: number | null;
  }>,
): WeddingStaffMealSummary {
  const summary: WeddingStaffMealSummary = {
    entryCount: 0,
    mealCount: 0,
    vegetarianMealCount: 0,
    nonVegetarianMealCount: 0,
  };
  for (const entry of entries) {
    if (entry.mealCount === null) continue;
    summary.entryCount += 1;
    summary.mealCount += entry.mealCount;
    const vegetarian = entry.vegetarianMealCount ?? 0;
    summary.vegetarianMealCount += vegetarian;
    summary.nonVegetarianMealCount += entry.mealCount - vegetarian;
  }
  return summary;
}

function normalizeRedEnvelopeAmount(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value.trim())) {
    throw new WeddingStaffValidationError(
      `紅包金額請輸入 1 到 ${MAX_WEDDING_STAFF_RED_ENVELOPE_AMOUNT} 的整數，不包紅包請留空。`,
    );
  }
  const amount = Number(value.trim());
  if (
    !Number.isSafeInteger(amount) ||
    amount > MAX_WEDDING_STAFF_RED_ENVELOPE_AMOUNT
  ) {
    throw new WeddingStaffValidationError(
      `紅包金額請輸入 1 到 ${MAX_WEDDING_STAFF_RED_ENVELOPE_AMOUNT} 的整數，不包紅包請留空。`,
    );
  }
  return amount;
}

/**
 * 紅包在婚宴結束時一個一個發出去，所以「打算包多少」與「已經發了多少」
 * 必須分開統計：只看總額看不出還有誰在等。
 */
export function summarizeWeddingStaffRedEnvelopes(
  entries: ReadonlyArray<{
    redEnvelopeAmount: number | null;
    redEnvelopeSentAt: Date | string | null;
  }>,
): WeddingStaffRedEnvelopeSummary {
  const summary: WeddingStaffRedEnvelopeSummary = {
    plannedCount: 0,
    plannedAmount: 0,
    sentCount: 0,
    sentAmount: 0,
    pendingCount: 0,
    pendingAmount: 0,
  };
  for (const entry of entries) {
    if (entry.redEnvelopeAmount === null) continue;
    summary.plannedCount += 1;
    summary.plannedAmount += entry.redEnvelopeAmount;
    if (entry.redEnvelopeSentAt) {
      summary.sentCount += 1;
      summary.sentAmount += entry.redEnvelopeAmount;
    } else {
      summary.pendingCount += 1;
      summary.pendingAmount += entry.redEnvelopeAmount;
    }
  }
  return summary;
}

export function normalizeWeddingStaffDetails(
  input: WeddingStaffDetailsInput,
): NormalizedWeddingStaffDetails {
  return {
    roleName: requiredText(input.roleName, "職務", 60),
    personName: requiredText(input.personName, "姓名", 120),
    contactPhone: optionalText(input.contactPhone, "聯絡電話", 40),
    notes: optionalText(input.notes, "備註", 500),
    ...normalizeMeal(input),
    redEnvelopeAmount: normalizeRedEnvelopeAmount(input.redEnvelopeAmount),
  };
}
