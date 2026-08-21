import { createHash } from "node:crypto";

export const MAX_BUDGET_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_BUDGET_ATTACHMENT_FILENAME_CODE_POINTS = 200;
export const ALLOWED_BUDGET_ATTACHMENT_MEDIA_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type BudgetAttachmentMediaType =
  (typeof ALLOWED_BUDGET_ATTACHMENT_MEDIA_TYPES)[number];

export type BudgetAttachmentDisposition = "attachment" | "inline";

export type BudgetAttachmentMetadata = {
  id: string;
  originalName: string;
  mediaType: BudgetAttachmentMediaType;
  byteSize: number;
  createdAt: string;
};

export class BudgetAttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetAttachmentValidationError";
  }
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

function isWebp(data: Uint8Array): boolean {
  if (
    data.byteLength < 16 ||
    !asciiAt(data, 0, "RIFF") ||
    !asciiAt(data, 8, "WEBP")
  ) {
    return false;
  }

  const declaredRiffSize =
    data[4] |
    (data[5] << 8) |
    (data[6] << 16) |
    (data[7] << 24);
  const chunkType = String.fromCharCode(...data.slice(12, 16));

  return (
    declaredRiffSize >= 8 &&
    declaredRiffSize + 8 === data.byteLength &&
    (chunkType === "VP8 " || chunkType === "VP8L" || chunkType === "VP8X")
  );
}

function detectMediaType(
  data: Uint8Array,
): BudgetAttachmentMediaType | null {
  if (startsWith(data, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return "application/pdf";
  }
  if (startsWith(data, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    startsWith(data, [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ])
  ) {
    return "image/png";
  }
  if (isWebp(data)) {
    return "image/webp";
  }
  return null;
}

function normalizeMediaType(value: string): BudgetAttachmentMediaType | null {
  const normalized = value.trim().toLowerCase();
  const aliasNormalized =
    normalized === "image/jpg" ? "image/jpeg" : normalized;

  return (
    ALLOWED_BUDGET_ATTACHMENT_MEDIA_TYPES as readonly string[]
  ).includes(aliasNormalized)
    ? (aliasNormalized as BudgetAttachmentMediaType)
    : null;
}

function validateFilename(value: string): string {
  const normalized = value.normalize("NFC");
  if (
    normalized !== normalized.trim() ||
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    /[\u0000-\u001F\u007F-\u009F]/u.test(normalized) ||
    /[\u061C\u200E\u200F\u2028-\u202E\u2066-\u2069\uD800-\uDFFF]/u.test(
      normalized,
    ) ||
    normalized.endsWith(".") ||
    Array.from(normalized).length < 1 ||
    Array.from(normalized).length > MAX_BUDGET_ATTACHMENT_FILENAME_CODE_POINTS
  ) {
    throw new BudgetAttachmentValidationError(
      "附件檔名不安全或超過 200 個字元。",
    );
  }

  return normalized;
}

function acceptedAttachmentExtensions(
  mediaType: BudgetAttachmentMediaType,
): readonly string[] {
  return mediaType === "image/jpeg"
    ? ["jpg", "jpeg"]
    : [attachmentExtension(mediaType)];
}

function canonicalizeUploadFilename(
  originalName: string,
  mediaType: BudgetAttachmentMediaType,
): string {
  const safeOriginalName = validateFilename(originalName);
  const lastDot = safeOriginalName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === safeOriginalName.length - 1) {
    throw new BudgetAttachmentValidationError(
      "附件副檔名與內容格式不一致。",
    );
  }

  const stem = safeOriginalName.slice(0, lastDot);
  const extension = safeOriginalName.slice(lastDot + 1).toLowerCase();
  if (
    stem.endsWith(".") ||
    !acceptedAttachmentExtensions(mediaType).includes(extension)
  ) {
    throw new BudgetAttachmentValidationError(
      "附件副檔名與內容格式不一致。",
    );
  }

  return validateFilename(`${stem}.${attachmentExtension(mediaType)}`);
}

function canonicalizeDownloadFilename(
  originalName: string,
  mediaType: BudgetAttachmentMediaType,
): string {
  const extension = attachmentExtension(mediaType);
  try {
    const safeOriginalName = validateFilename(originalName);
    const lastDot = safeOriginalName.lastIndexOf(".");
    let stem =
      lastDot > 0 ? safeOriginalName.slice(0, lastDot) : safeOriginalName;
    const canonicalSuffix = `.${extension}`;
    if (stem.toLowerCase().endsWith(canonicalSuffix)) {
      stem = stem.slice(0, -canonicalSuffix.length);
    }
    stem = stem.replace(/[. ]+$/gu, "");
    if (stem.length < 1) return `attachment.${extension}`;
    return validateFilename(`${stem}.${extension}`);
  } catch {
    return `attachment.${extension}`;
  }
}

export function validateBudgetAttachmentFile({
  originalName,
  mediaType,
  data,
}: {
  originalName: string;
  mediaType: string;
  data: Uint8Array;
}) {
  validateFilename(originalName);
  if (data.byteLength < 1) {
    throw new BudgetAttachmentValidationError("附件不可為空檔。");
  }
  if (data.byteLength > MAX_BUDGET_ATTACHMENT_BYTES) {
    throw new BudgetAttachmentValidationError(
      "附件大小不可超過 10 MiB。",
    );
  }

  const normalizedMediaType = normalizeMediaType(mediaType);
  const detectedMediaType = detectMediaType(data);
  if (
    normalizedMediaType === null ||
    detectedMediaType === null ||
    normalizedMediaType !== detectedMediaType
  ) {
    throw new BudgetAttachmentValidationError(
      "附件格式與內容不符，僅接受 PDF、JPEG、PNG 或 WEBP。",
    );
  }

  const safeOriginalName = canonicalizeUploadFilename(
    originalName,
    detectedMediaType,
  );

  return {
    originalName: safeOriginalName,
    mediaType: detectedMediaType,
    byteSize: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
    data,
  };
}

function attachmentExtension(mediaType: BudgetAttachmentMediaType): string {
  if (mediaType === "application/pdf") return "pdf";
  if (mediaType === "image/jpeg") return "jpg";
  if (mediaType === "image/png") return "png";
  return "webp";
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/gu,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function buildAttachmentContentDisposition(
  originalName: string,
  mediaType: BudgetAttachmentMediaType,
  disposition: BudgetAttachmentDisposition = "attachment",
): string {
  const safeOriginalName = canonicalizeDownloadFilename(
    originalName,
    mediaType,
  );
  const safeDisposition =
    disposition === "inline" ? "inline" : "attachment";
  return `${safeDisposition}; filename="attachment.${attachmentExtension(
    mediaType,
  )}"; filename*=UTF-8''${encodeRfc5987(safeOriginalName)}`;
}

export function resolveBudgetAttachmentDisposition(
  url: URL,
): BudgetAttachmentDisposition {
  return url.search === "?disposition=inline"
    ? "inline"
    : "attachment";
}
