import { createHash } from "node:crypto";
import sharp from "sharp";

export const MAX_PROFILE_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_PROFILE_AVATAR_STORED_BYTES = 1024 * 1024;
const MAX_PROFILE_AVATAR_INPUT_PIXELS = 16_777_216;
const PROFILE_AVATAR_SIZE = 256;

const ACCEPTED_MEDIA_TYPES: ReadonlyMap<string, "jpeg" | "png" | "webp"> = new Map([
  ["image/jpeg", "jpeg"],
  ["image/jpg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export class ProfileAvatarValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileAvatarValidationError";
  }
}

export type NormalizedProfileAvatar = {
  data: Uint8Array;
  mediaType: "image/webp";
  byteSize: number;
  sha256: string;
};

export function safeGoogleAvatarUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      (hostname !== "googleusercontent.com" &&
        !hostname.endsWith(".googleusercontent.com"))
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export async function normalizeProfileAvatar(input: {
  data: Uint8Array;
  mediaType: string;
}): Promise<NormalizedProfileAvatar> {
  if (input.data.byteLength === 0) {
    throw new ProfileAvatarValidationError("頭像圖片不可為空檔。");
  }
  if (input.data.byteLength > MAX_PROFILE_AVATAR_UPLOAD_BYTES) {
    throw new ProfileAvatarValidationError("頭像圖片不可超過 5 MiB。");
  }

  const claimedFormat = ACCEPTED_MEDIA_TYPES.get(
    input.mediaType.trim().toLowerCase(),
  );
  if (!claimedFormat) {
    throw new ProfileAvatarValidationError(
      "頭像只支援 JPEG、PNG 或 WebP 圖片。",
    );
  }

  try {
    const image = sharp(Buffer.from(input.data), {
      failOn: "error",
      limitInputPixels: MAX_PROFILE_AVATAR_INPUT_PIXELS,
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== claimedFormat ||
      !metadata.width ||
      !metadata.height ||
      (metadata.pages ?? 1) !== 1
    ) {
      throw new ProfileAvatarValidationError("頭像圖片格式與內容不符。");
    }

    const normalized = await image
      .rotate()
      .resize(PROFILE_AVATAR_SIZE, PROFILE_AVATAR_SIZE, {
        fit: "cover",
        position: "centre",
      })
      .webp({ effort: 4, quality: 85 })
      .toBuffer();
    if (
      normalized.byteLength === 0 ||
      normalized.byteLength > MAX_PROFILE_AVATAR_STORED_BYTES
    ) {
      throw new ProfileAvatarValidationError("頭像圖片處理後仍然過大。");
    }

    return {
      data: new Uint8Array(normalized),
      mediaType: "image/webp",
      byteSize: normalized.byteLength,
      sha256: createHash("sha256").update(normalized).digest("hex"),
    };
  } catch (error) {
    if (error instanceof ProfileAvatarValidationError) throw error;
    throw new ProfileAvatarValidationError(
      "無法讀取頭像圖片，請改用有效的 JPEG、PNG 或 WebP 檔案。",
    );
  }
}
