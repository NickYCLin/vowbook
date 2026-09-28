import {
  GuestValidationError,
  normalizeGuestInput,
  type GuestAttendanceStatusValue,
  type GuestSideValue,
} from "./guest";

export const GUEST_XLSX_REQUIRED_FIELDS = [
  "externalId",
  "name",
  "side",
  "attendanceStatus",
  "partySize",
] as const;

export type GuestXlsxRequiredField =
  (typeof GUEST_XLSX_REQUIRED_FIELDS)[number];

export type GuestXlsxColumnMapping = Record<GuestXlsxRequiredField, number>;

export type GuestXlsxCell = string | number | boolean | Date | null | undefined;

export type NormalizedGuestXlsxRow = {
  rowNumber: number;
  externalId: string;
  name: string;
  side: GuestSideValue;
  attendanceStatus: GuestAttendanceStatusValue;
  partySize: number;
};

export class GuestXlsxImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuestXlsxImportValidationError";
  }
}

const HEADER_ALIASES: Record<GuestXlsxRequiredField, readonly string[]> = {
  externalId: [
    "externalid",
    "externaluserid",
    "userid",
    "回覆識別碼",
    "回覆id",
    "來源識別碼",
    "受訪者識別碼",
    "賓客識別碼",
  ],
  name: ["name", "姓名", "賓客姓名", "您的姓名", "填寫人姓名"],
  side: [
    "side",
    "關係",
    "與新人的關係",
    "您與新人的關係",
    "新人關係",
  ],
  attendanceStatus: [
    "attendancestatus",
    "attendance",
    "是否出席",
    "出席狀態",
    "是否參加",
    "是否參加婚宴",
  ],
  partySize: [
    "partysize",
    "人數",
    "出席人數",
    "參加人數",
    "邀請人數",
    "出席人數含本人",
    "邀請人數含本人",
    "包含本人共幾位",
  ],
};

function normalizeHeader(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-TW")
    .replace(/[\s（）()：:／/、，,。._-]+/gu, "");
}

export function suggestGuestXlsxMapping(
  headers: readonly string[],
): Partial<GuestXlsxColumnMapping> {
  const normalizedHeaders = headers.map(normalizeHeader);
  const suggestion: Partial<GuestXlsxColumnMapping> = {};

  for (const field of GUEST_XLSX_REQUIRED_FIELDS) {
    const aliases = new Set(HEADER_ALIASES[field].map(normalizeHeader));
    const index = normalizedHeaders.findIndex((header) => aliases.has(header));
    if (index >= 0) suggestion[field] = index;
  }

  return suggestion;
}

export function normalizeGuestXlsxMapping(
  value: unknown,
  headerCount: number,
): GuestXlsxColumnMapping {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !Number.isSafeInteger(headerCount) ||
    headerCount < 1
  ) {
    throw new GuestXlsxImportValidationError("Excel 欄位對應格式無效。");
  }

  const mapping = {} as GuestXlsxColumnMapping;
  for (const field of GUEST_XLSX_REQUIRED_FIELDS) {
    const index = (value as Record<string, unknown>)[field];
    if (
      typeof index !== "number" ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= headerCount
    ) {
      throw new GuestXlsxImportValidationError(
        "Excel 欄位對應已失效，請重新讀取檔案。",
      );
    }
    mapping[field] = index;
  }

  if (new Set(Object.values(mapping)).size !== GUEST_XLSX_REQUIRED_FIELDS.length) {
    throw new GuestXlsxImportValidationError(
      "每個必要欄位必須對應不同的 Excel 欄位。",
    );
  }

  return mapping;
}

function isBlankCell(value: GuestXlsxCell): boolean {
  return value === null || value === undefined || value === "";
}

function normalizedCellText(value: GuestXlsxCell): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized === "" ? null : normalized;
}

function normalizeExternalId(value: GuestXlsxCell, rowNumber: number): string {
  let normalized: string | null = null;
  if (typeof value === "string") {
    normalized = value.trim();
  } else if (typeof value === "number" && Number.isSafeInteger(value)) {
    normalized = String(value);
  } else if (typeof value === "number") {
    throw new GuestXlsxImportValidationError(
      `第 ${rowNumber} 列的來源識別碼必須是文字或安全整數。`,
    );
  }

  if (
    !normalized ||
    Array.from(normalized).length > 191 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new GuestXlsxImportValidationError(
      `第 ${rowNumber} 列的來源識別碼格式無效。`,
    );
  }
  return normalized;
}

function normalizeSide(value: GuestXlsxCell, rowNumber: number): GuestSideValue {
  const text = normalizedCellText(value);
  if (!text) {
    throw new GuestXlsxImportValidationError(`第 ${rowNumber} 列的關係無法辨識。`);
  }
  const normalized = normalizeHeader(text).toUpperCase();
  if (
    normalized === "PARTNERA" ||
    /(?:男方|新郎|新人一方|甲方)/u.test(text)
  ) {
    return "PARTNER_A";
  }
  if (
    normalized === "PARTNERB" ||
    /(?:女方|新娘|新人另一方|乙方)/u.test(text)
  ) {
    return "PARTNER_B";
  }
  if (
    normalized === "SHARED" ||
    /(?:共同|雙方|兩人)/u.test(text)
  ) {
    return "SHARED";
  }
  throw new GuestXlsxImportValidationError(`第 ${rowNumber} 列的關係無法辨識。`);
}

function normalizeAttendance(
  value: GuestXlsxCell,
  rowNumber: number,
): GuestAttendanceStatusValue {
  const text = normalizedCellText(value);
  if (!text) {
    throw new GuestXlsxImportValidationError(
      `第 ${rowNumber} 列的出席狀態無法辨識。`,
    );
  }
  const normalized = normalizeHeader(text).toUpperCase();
  if (
    normalized === "DECLINED" ||
    /(?:不出席|不克|無法|不能|不參加|不會參加|婉拒)/u.test(text)
  ) {
    return "DECLINED";
  }
  if (
    normalized === "UNDECIDED" ||
    /(?:尚未確認|未決定|未定|再確認)/u.test(text)
  ) {
    return "UNDECIDED";
  }
  if (
    normalized === "ATTENDING" ||
    /(?:會出席|可出席|出席|會參加|可參加|參加)/u.test(text)
  ) {
    return "ATTENDING";
  }
  throw new GuestXlsxImportValidationError(
    `第 ${rowNumber} 列的出席狀態無法辨識。`,
  );
}

function normalizePartySize(value: GuestXlsxCell, rowNumber: number): number {
  const candidate =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(/^\s*(\d{1,2})\s*(?:位|人)?\s*$/u.exec(value)?.[1])
        : Number.NaN;
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > 20) {
    throw new GuestXlsxImportValidationError(
      `第 ${rowNumber} 列的邀請人數必須是 1 到 20 的整數。`,
    );
  }
  return candidate;
}

function normalizeName(value: GuestXlsxCell, rowNumber: number): string {
  const text = normalizedCellText(value);
  try {
    return normalizeGuestInput({
      name: text,
      side: "SHARED",
      attendanceStatus: "UNDECIDED",
      partySize: 1,
      notes: null,
    }).name;
  } catch (error) {
    if (error instanceof GuestValidationError) {
      throw new GuestXlsxImportValidationError(
        `第 ${rowNumber} 列的賓客姓名格式無效。`,
      );
    }
    throw error;
  }
}

export function normalizeGuestXlsxRows(
  rows: readonly (readonly GuestXlsxCell[])[],
  mapping: GuestXlsxColumnMapping,
  firstRowNumber: number,
): NormalizedGuestXlsxRow[] {
  if (rows.length > 2_000) {
    throw new GuestXlsxImportValidationError("Excel 最多可匯入 2,000 筆賓客資料。");
  }
  if (!Number.isSafeInteger(firstRowNumber) || firstRowNumber < 1) {
    throw new GuestXlsxImportValidationError("Excel 標題列設定無效。");
  }

  const seenExternalIds = new Set<string>();
  const normalizedRows: NormalizedGuestXlsxRow[] = [];
  rows.forEach((row, index) => {
    if (row.every(isBlankCell)) return;
    const rowNumber = firstRowNumber + index;
    const externalId = normalizeExternalId(row[mapping.externalId], rowNumber);
    if (seenExternalIds.has(externalId)) {
      throw new GuestXlsxImportValidationError(
        `第 ${rowNumber} 列的來源識別碼與檔案內其他列重複。`,
      );
    }
    seenExternalIds.add(externalId);
    normalizedRows.push({
      rowNumber,
      externalId,
      name: normalizeName(row[mapping.name], rowNumber),
      side: normalizeSide(row[mapping.side], rowNumber),
      attendanceStatus: normalizeAttendance(
        row[mapping.attendanceStatus],
        rowNumber,
      ),
      partySize: normalizePartySize(row[mapping.partySize], rowNumber),
    });
  });

  if (normalizedRows.length === 0) {
    throw new GuestXlsxImportValidationError("Excel 沒有可匯入的賓客資料。");
  }
  return normalizedRows;
}
