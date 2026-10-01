export const MAX_WORKSPACE_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_WORKSPACE_DOCUMENT_TOTAL_BYTES = 500 * 1024 * 1024;
export const MAX_WORKSPACE_DOCUMENT_COUNT = 200;
export const MAX_WORKSPACE_DOCUMENT_FILENAME_CODE_POINTS = 200;
export const MAX_WORKSPACE_DOCUMENT_TITLE_CODE_POINTS = 80;
export const MAX_WORKSPACE_DOCUMENT_NOTES_CODE_POINTS = 200;

export const WORKSPACE_DOCUMENT_CATEGORIES = [
  "INVITATION",
  "VENDOR_SCHEDULE",
  "VENDOR_CONTRACT",
  "OTHER",
] as const;

export type WorkspaceDocumentCategory =
  (typeof WORKSPACE_DOCUMENT_CATEGORIES)[number];

export const WORKSPACE_DOCUMENT_CATEGORY_LABELS: Record<
  WorkspaceDocumentCategory,
  string
> = {
  INVITATION: "電子喜帖",
  VENDOR_SCHEDULE: "廠商行程表",
  VENDOR_CONTRACT: "廠商合約",
  OTHER: "其他文件",
};

export const WORKSPACE_DOCUMENT_MEDIA_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type WorkspaceDocumentMediaType =
  (typeof WORKSPACE_DOCUMENT_MEDIA_TYPES)[number];

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const MEDIA_TYPE_INFO: Record<
  WorkspaceDocumentMediaType,
  { label: string; extensions: readonly string[]; inline: boolean }
> = {
  "application/pdf": { label: "PDF", extensions: ["pdf"], inline: true },
  "image/jpeg": { label: "JPEG", extensions: ["jpg", "jpeg"], inline: true },
  "image/png": { label: "PNG", extensions: ["png"], inline: true },
  "image/webp": { label: "WEBP", extensions: ["webp"], inline: true },
  "image/gif": { label: "GIF", extensions: ["gif"], inline: true },
  "video/mp4": { label: "MP4 影片", extensions: ["mp4", "m4v"], inline: true },
  [DOCX]: { label: "Word", extensions: ["docx"], inline: false },
  [XLSX]: { label: "Excel", extensions: ["xlsx"], inline: false },
};

export const WORKSPACE_DOCUMENT_ACCEPT = [
  ...WORKSPACE_DOCUMENT_MEDIA_TYPES,
  ...Object.values(MEDIA_TYPE_INFO).flatMap((info) =>
    info.extensions.map((extension) => `.${extension}`),
  ),
].join(",");

export type WorkspaceDocumentMetadata = {
  id: string;
  category: WorkspaceDocumentCategory;
  title: string;
  notes: string | null;
  originalName: string;
  mediaType: WorkspaceDocumentMediaType;
  byteSize: number;
  createdAt: string;
  uploadedByName: string | null;
};

export class WorkspaceDocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceDocumentValidationError";
  }
}

export function workspaceDocumentMediaTypeLabel(
  mediaType: WorkspaceDocumentMediaType,
): string {
  return MEDIA_TYPE_INFO[mediaType].label;
}

export function canViewWorkspaceDocumentInline(
  mediaType: WorkspaceDocumentMediaType,
): boolean {
  return MEDIA_TYPE_INFO[mediaType].inline;
}

export function isWorkspaceDocumentCategory(
  value: unknown,
): value is WorkspaceDocumentCategory {
  return (
    typeof value === "string" &&
    (WORKSPACE_DOCUMENT_CATEGORIES as readonly string[]).includes(value)
  );
}

export function isWorkspaceDocumentMediaType(
  value: unknown,
): value is WorkspaceDocumentMediaType {
  return (
    typeof value === "string" &&
    (WORKSPACE_DOCUMENT_MEDIA_TYPES as readonly string[]).includes(value)
  );
}

function startsWith(data: Uint8Array, signature: readonly number[]): boolean {
  return (
    data.byteLength >= signature.length &&
    signature.every((byte, index) => data[index] === byte)
  );
}

function asciiAt(data: Uint8Array, offset: number, value: string): boolean {
  if (data.byteLength < offset + value.length) return false;
  return Array.from(value).every(
    (character, index) => data[offset + index] === character.charCodeAt(0),
  );
}

type DetectedFamily = "pdf" | "jpeg" | "png" | "webp" | "gif" | "mp4" | "zip";

function detectFamily(data: Uint8Array): DetectedFamily | null {
  if (startsWith(data, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (startsWith(data, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  if (
    data.byteLength >= 16 &&
    asciiAt(data, 0, "RIFF") &&
    asciiAt(data, 8, "WEBP")
  ) {
    return "webp";
  }
  if (asciiAt(data, 0, "GIF87a") || asciiAt(data, 0, "GIF89a")) return "gif";
  if (data.byteLength >= 12 && asciiAt(data, 4, "ftyp")) return "mp4";
  if (startsWith(data, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  return null;
}

function familyOf(mediaType: WorkspaceDocumentMediaType): DetectedFamily {
  switch (mediaType) {
    case "application/pdf":
      return "pdf";
    case "image/jpeg":
      return "jpeg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "video/mp4":
      return "mp4";
    default:
      return "zip";
  }
}

function mediaTypeFromExtension(
  extension: string,
): WorkspaceDocumentMediaType | null {
  const match = WORKSPACE_DOCUMENT_MEDIA_TYPES.find((mediaType) =>
    MEDIA_TYPE_INFO[mediaType].extensions.includes(extension),
  );
  return match ?? null;
}

function hasUnsafeCharacters(value: string): boolean {
  return (
    /[\u0000-\u001F\u007F-\u009F]/u.test(value) ||
    /[\u061C\u200E\u200F\u2028-\u202E\u2066-\u2069\uD800-\uDFFF]/u.test(value)
  );
}

function validateFilename(value: string): string {
  const normalized = value.normalize("NFC");
  const length = Array.from(normalized).length;
  if (
    normalized !== normalized.trim() ||
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    hasUnsafeCharacters(normalized) ||
    normalized.endsWith(".") ||
    length < 1 ||
    length > MAX_WORKSPACE_DOCUMENT_FILENAME_CODE_POINTS
  ) {
    throw new WorkspaceDocumentValidationError(
      "檔名不安全或超過 200 個字元。",
    );
  }
  return normalized;
}

function fileExtension(filename: string): string | null {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === filename.length - 1) return null;
  return filename.slice(lastDot + 1).toLowerCase();
}

export function filenameStem(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot > 0 ? filename.slice(0, lastDot) : filename;
}

function normalizeSingleLine(
  value: unknown,
  maxCodePoints: number,
  fieldLabel: string,
): string {
  if (typeof value !== "string") {
    throw new WorkspaceDocumentValidationError(`請填寫${fieldLabel}。`);
  }
  const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (hasUnsafeCharacters(normalized)) {
    throw new WorkspaceDocumentValidationError(`${fieldLabel}含有不支援的字元。`);
  }
  if (Array.from(normalized).length > maxCodePoints) {
    throw new WorkspaceDocumentValidationError(
      `${fieldLabel}最多 ${maxCodePoints} 個字。`,
    );
  }
  return normalized;
}

export function normalizeWorkspaceDocumentDetails(input: {
  category: unknown;
  title: unknown;
  notes: unknown;
  fallbackTitle: string;
}): {
  category: WorkspaceDocumentCategory;
  title: string;
  notes: string | null;
} {
  if (!isWorkspaceDocumentCategory(input.category)) {
    throw new WorkspaceDocumentValidationError("請選擇文件分類。");
  }
  const typedTitle =
    input.title === undefined || input.title === null ? "" : input.title;
  let title = normalizeSingleLine(
    typedTitle,
    MAX_WORKSPACE_DOCUMENT_TITLE_CODE_POINTS,
    "文件名稱",
  );
  if (title.length === 0) {
    title = Array.from(
      normalizeSingleLine(
        input.fallbackTitle,
        Number.MAX_SAFE_INTEGER,
        "文件名稱",
      ),
    )
      .slice(0, MAX_WORKSPACE_DOCUMENT_TITLE_CODE_POINTS)
      .join("")
      .trim();
  }
  if (title.length === 0) {
    throw new WorkspaceDocumentValidationError("請填寫文件名稱。");
  }
  const typedNotes =
    input.notes === undefined || input.notes === null ? "" : input.notes;
  const notes = normalizeSingleLine(
    typedNotes,
    MAX_WORKSPACE_DOCUMENT_NOTES_CODE_POINTS,
    "備註",
  );
  return {
    category: input.category,
    title,
    notes: notes.length > 0 ? notes : null,
  };
}

export function validateWorkspaceDocumentFile({
  originalName,
  data,
}: {
  originalName: string;
  data: Uint8Array;
}) {
  const safeName = validateFilename(originalName);
  if (data.byteLength < 1) {
    throw new WorkspaceDocumentValidationError("檔案不可為空檔。");
  }
  if (data.byteLength > MAX_WORKSPACE_DOCUMENT_BYTES) {
    throw new WorkspaceDocumentValidationError("單一檔案不可超過 25 MiB。");
  }

  const extension = fileExtension(safeName);
  const mediaType = extension === null ? null : mediaTypeFromExtension(extension);
  const detected = detectFamily(data);
  if (mediaType === null || detected === null || familyOf(mediaType) !== detected) {
    throw new WorkspaceDocumentValidationError(
      "檔案格式與內容不符，僅接受 PDF、圖片（JPEG、PNG、WEBP、GIF）、MP4 影片、Word（.docx）或 Excel（.xlsx）。",
    );
  }

  return {
    originalName: safeName,
    mediaType,
    byteSize: data.byteLength,
    data,
  };
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function buildWorkspaceDocumentContentDisposition(
  originalName: string,
  mediaType: WorkspaceDocumentMediaType,
  disposition: "inline" | "attachment",
): string {
  const extension = MEDIA_TYPE_INFO[mediaType].extensions[0];
  let safeName = `document.${extension}`;
  try {
    safeName = validateFilename(originalName);
  } catch {
    // 舊資料或異常檔名一律退回固定檔名。
  }
  const safeDisposition =
    disposition === "inline" && canViewWorkspaceDocumentInline(mediaType)
      ? "inline"
      : "attachment";
  return `${safeDisposition}; filename="document.${extension}"; filename*=UTF-8''${encodeRfc5987(safeName)}`;
}

export type ParsedByteRange =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "unsatisfiable" }
  | { kind: "range"; start: number; end: number };

export function parseSingleByteRange(
  value: string | null,
  total: number,
): ParsedByteRange {
  if (value === null) return { kind: "none" };
  const match = /^bytes=(\d*)-(\d*)$/iu.exec(value.trim());
  if (!match || (match[1] === "" && match[2] === "")) return { kind: "invalid" };
  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength)) return { kind: "invalid" };
    if (suffixLength < 1) return { kind: "unsatisfiable" };
    return { kind: "range", start: Math.max(0, total - suffixLength), end: total - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] === "" ? total - 1 : Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)) {
    return { kind: "invalid" };
  }
  if (start >= total) return { kind: "unsatisfiable" };
  if (requestedEnd < start) return { kind: "invalid" };
  return { kind: "range", start, end: Math.min(requestedEnd, total - 1) };
}
