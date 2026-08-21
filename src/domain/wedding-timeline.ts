export type WeddingTimelineDetailsInput = {
  startTime: unknown;
  endTime: unknown;
  phase: unknown;
  title: unknown;
  location: unknown;
  details: unknown;
  mediaCue: unknown;
  notes: unknown;
};

export type NormalizedWeddingTimelineDetails = {
  startMinute: number;
  endMinute: number | null;
  phase: string;
  title: string;
  location: string | null;
  details: string | null;
  mediaCue: string | null;
  notes: string | null;
};

export class WeddingTimelineValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeddingTimelineValidationError";
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
    throw new WeddingTimelineValidationError(
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
    throw new WeddingTimelineValidationError(`${label}最多 ${maximum} 個字元。`);
  }
  return normalized === "" ? null : normalized;
}

export function parseWeddingTimelineTime(
  value: unknown,
  label: string,
): number {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)) {
    throw new WeddingTimelineValidationError(`請輸入有效的${label}。`);
  }
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function formatWeddingTimelineMinute(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 1439) {
    throw new WeddingTimelineValidationError("流程時間超出可用範圍。");
  }
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(
    value % 60,
  ).padStart(2, "0")}`;
}

export function normalizeWeddingTimelineDetails(
  input: WeddingTimelineDetailsInput,
): NormalizedWeddingTimelineDetails {
  const startMinute = parseWeddingTimelineTime(input.startTime, "開始時間");
  const normalizedEnd =
    typeof input.endTime === "string" ? input.endTime.trim() : "";
  const endMinute =
    normalizedEnd === ""
      ? null
      : parseWeddingTimelineTime(normalizedEnd, "結束時間");
  if (endMinute !== null && endMinute <= startMinute) {
    throw new WeddingTimelineValidationError(
      "結束時間必須晚於開始時間。",
    );
  }

  return {
    startMinute,
    endMinute,
    phase: requiredText(input.phase, "階段", 60),
    title: requiredText(input.title, "流程項目", 120),
    location: optionalText(input.location, "地點", 120),
    details: optionalText(input.details, "流程細節", 2000),
    mediaCue: optionalText(input.mediaCue, "音樂／影片", 500),
    notes: optionalText(input.notes, "備註", 1000),
  };
}

export function normalizeWeddingTimelineStaffIds(
  values: unknown[],
): string[] {
  if (values.length > 100) {
    throw new WeddingTimelineValidationError(
      "單一流程最多可指派 100 位工作人員。",
    );
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (
      typeof value !== "string" ||
      value.length < 1 ||
      value.length > 191 ||
      value.trim() !== value
    ) {
      throw new WeddingTimelineValidationError(
        "工作人員指派內容無效，請重新整理後再試。",
      );
    }
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}
