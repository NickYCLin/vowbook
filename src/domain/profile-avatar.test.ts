import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  MAX_PROFILE_AVATAR_UPLOAD_BYTES,
  ProfileAvatarValidationError,
  normalizeProfileAvatar,
  safeGoogleAvatarUrl,
} from "@/domain/profile-avatar";

describe("profile avatar", () => {
  it("normalizes an uploaded raster image into a metadata-free square WEBP", async () => {
    const source = await sharp({
      create: {
        width: 800,
        height: 400,
        channels: 3,
        background: { r: 121, g: 149, b: 132 },
      },
    })
      .png()
      .toBuffer();

    const normalized = await normalizeProfileAvatar({
      data: new Uint8Array(source),
      mediaType: "image/png",
    });
    const metadata = await sharp(normalized.data).metadata();

    expect(normalized.mediaType).toBe("image/webp");
    expect(normalized.byteSize).toBe(normalized.data.byteLength);
    expect(normalized.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(metadata).toMatchObject({ format: "webp", width: 256, height: 256 });
    expect(metadata.exif).toBeUndefined();
  });

  it("rejects mismatched, unsupported, empty, and oversized uploads", async () => {
    await expect(
      normalizeProfileAvatar({
        data: Uint8Array.from([0xff, 0xd8, 0xff, 0x00]),
        mediaType: "image/png",
      }),
    ).rejects.toBeInstanceOf(ProfileAvatarValidationError);
    await expect(
      normalizeProfileAvatar({
        data: new Uint8Array(),
        mediaType: "image/png",
      }),
    ).rejects.toThrow("頭像圖片不可為空檔");
    await expect(
      normalizeProfileAvatar({
        data: new Uint8Array(MAX_PROFILE_AVATAR_UPLOAD_BYTES + 1),
        mediaType: "image/png",
      }),
    ).rejects.toThrow("頭像圖片不可超過 5 MiB");
  });

  it("only accepts HTTPS Google-hosted account pictures", () => {
    expect(
      safeGoogleAvatarUrl("https://lh3.googleusercontent.com/a/photo"),
    ).toBe("https://lh3.googleusercontent.com/a/photo");
    expect(safeGoogleAvatarUrl("http://lh3.googleusercontent.com/a/photo")).toBeNull();
    expect(safeGoogleAvatarUrl("https://example.test/avatar.png")).toBeNull();
    expect(safeGoogleAvatarUrl("not-a-url")).toBeNull();
  });
});
