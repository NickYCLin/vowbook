import "server-only";

import { createHash } from "node:crypto";
import readXlsxFile from "read-excel-file/node";
import {
  GuestXlsxImportValidationError,
  normalizeGuestXlsxMapping,
  normalizeGuestXlsxRows,
  suggestGuestXlsxMapping,
  type GuestXlsxCell,
  type GuestXlsxColumnMapping,
  type NormalizedGuestXlsxRow,
} from "@/domain/guest-xlsx-import";

export const MAX_GUEST_XLSX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_GUEST_XLSX_SHEETS = 20;
const MAX_GUEST_XLSX_COLUMNS = 100;
const MAX_GUEST_XLSX_HEADER_ROWS = 20;

export class GuestXlsxWorkbookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuestXlsxWorkbookError";
  }
}

export type GuestXlsxInspection = {
  sheetNames: string[];
  sheetName: string;
  headerRow: number;
  headers: string[];
  rowCount: number;
  suggestedMapping: Partial<GuestXlsxColumnMapping>;
};

export type ParsedGuestXlsxWorkbook = {
  sheetName: string;
  headerRow: number;
  headers: string[];
  rows: NormalizedGuestXlsxRow[];
  inputSha256: string;
};

type WorkbookOptions = {
  sheetName?: string;
  headerRow?: number;
};

function validateXlsxBytes(data: Uint8Array): void {
  if (
    !(data instanceof Uint8Array) ||
    data.byteLength < 4 ||
    data.byteLength > MAX_GUEST_XLSX_FILE_BYTES ||
    data[0] !== 0x50 ||
    data[1] !== 0x4b
  ) {
    throw new GuestXlsxWorkbookError("檔案不是有效的 .xlsx 活頁簿。");
  }
}

function normalizeHeaderRow(value: number | undefined): number {
  const headerRow = value ?? 1;
  if (
    !Number.isSafeInteger(headerRow) ||
    headerRow < 1 ||
    headerRow > MAX_GUEST_XLSX_HEADER_ROWS
  ) {
    throw new GuestXlsxWorkbookError("標題列必須介於第 1 到 20 列。");
  }
  return headerRow;
}

function headerText(value: GuestXlsxCell, columnNumber: number): string {
  let text = "";
  if (typeof value === "string") text = value.trim().replace(/\s+/gu, " ");
  else if (typeof value === "number" && Number.isFinite(value)) text = String(value);
  else if (typeof value === "boolean") text = value ? "TRUE" : "FALSE";
  else if (value instanceof Date && Number.isFinite(value.getTime())) {
    text = value.toISOString();
  }

  if (Array.from(text).length > 120 || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new GuestXlsxWorkbookError(
      `第 ${columnNumber} 欄的標題格式無效，請調整後重試。`,
    );
  }
  return text === "" ? `未命名欄 ${columnNumber}` : text;
}

function rowHasValue(row: readonly GuestXlsxCell[]): boolean {
  return row.some(
    (value) => value !== null && value !== undefined && value !== "",
  );
}

async function readWorkbookSheet(
  data: Uint8Array,
  options: WorkbookOptions = {},
): Promise<{
  sheetNames: string[];
  sheetName: string;
  headerRow: number;
  headers: string[];
  dataRows: GuestXlsxCell[][];
}> {
  validateXlsxBytes(data);
  const buffer = Buffer.from(data);
  let workbookSheets: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    workbookSheets = await readXlsxFile(buffer);
  } catch {
    throw new GuestXlsxWorkbookError(
      "目前無法讀取 Excel，請確認檔案未損毀或加密。",
    );
  }
  const sheetNames = workbookSheets.map((sheet) => sheet.sheet);
  if (
    sheetNames.length < 1 ||
    sheetNames.length > MAX_GUEST_XLSX_SHEETS ||
    sheetNames.some(
      (name) =>
        typeof name !== "string" ||
        name.trim() === "" ||
        Array.from(name).length > 120,
    )
  ) {
    throw new GuestXlsxWorkbookError("Excel 工作表數量或名稱格式無效。");
  }

  const sheetName = options.sheetName ?? sheetNames[0];
  if (!sheetNames.includes(sheetName)) {
    throw new GuestXlsxWorkbookError("指定的工作表不存在，請重新選擇。");
  }
  const headerRow = normalizeHeaderRow(options.headerRow);

  const selectedSheet = workbookSheets.find((sheet) => sheet.sheet === sheetName);
  if (!selectedSheet) {
    throw new GuestXlsxWorkbookError("指定的工作表不存在，請重新選擇。");
  }
  const rows = selectedSheet.data as unknown as GuestXlsxCell[][];
  const rawHeaders = rows[headerRow - 1];
  if (!rawHeaders || !rowHasValue(rawHeaders)) {
    throw new GuestXlsxWorkbookError("指定列沒有可用的欄位標題。");
  }
  if (rawHeaders.length > MAX_GUEST_XLSX_COLUMNS) {
    throw new GuestXlsxWorkbookError("Excel 最多可包含 100 個欄位。");
  }

  let lastHeaderIndex = rawHeaders.length - 1;
  while (
    lastHeaderIndex > 0 &&
    (rawHeaders[lastHeaderIndex] === null ||
      rawHeaders[lastHeaderIndex] === undefined ||
      rawHeaders[lastHeaderIndex] === "")
  ) {
    lastHeaderIndex -= 1;
  }
  const headers = rawHeaders
    .slice(0, lastHeaderIndex + 1)
    .map((value, index) => headerText(value, index + 1));
  const dataRows = rows.slice(headerRow).filter(rowHasValue);

  return { sheetNames, sheetName, headerRow, headers, dataRows };
}

export async function inspectGuestXlsxWorkbook(
  data: Uint8Array,
  options: WorkbookOptions = {},
): Promise<GuestXlsxInspection> {
  const workbook = await readWorkbookSheet(data, options);
  if (workbook.dataRows.length > 2_000) {
    throw new GuestXlsxImportValidationError(
      "Excel 最多可匯入 2,000 筆賓客資料。",
    );
  }
  return {
    sheetNames: workbook.sheetNames,
    sheetName: workbook.sheetName,
    headerRow: workbook.headerRow,
    headers: workbook.headers,
    rowCount: workbook.dataRows.length,
    suggestedMapping: suggestGuestXlsxMapping(workbook.headers),
  };
}

export async function parseGuestXlsxWorkbook(
  data: Uint8Array,
  options: WorkbookOptions & { mapping: GuestXlsxColumnMapping },
): Promise<ParsedGuestXlsxWorkbook> {
  const workbook = await readWorkbookSheet(data, options);
  const mapping = normalizeGuestXlsxMapping(
    options.mapping,
    workbook.headers.length,
  );
  return {
    sheetName: workbook.sheetName,
    headerRow: workbook.headerRow,
    headers: workbook.headers,
    rows: normalizeGuestXlsxRows(
      workbook.dataRows,
      mapping,
      workbook.headerRow + 1,
    ),
    inputSha256: createHash("sha256").update(data).digest("hex"),
  };
}
