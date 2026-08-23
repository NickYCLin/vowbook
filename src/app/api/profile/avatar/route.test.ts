import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PROFILE_AVATAR_UPLOAD_BYTES } from "@/domain/profile-avatar";

const getApiCurrentUser = vi.hoisted(() => vi.fn());
const readProfileAvatar = vi.hoisted(() => vi.fn());
const removeProfileAvatar = vi.hoisted(() => vi.fn());
const saveProfileAvatar = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-current-user", () => ({ getApiCurrentUser }));
vi.mock("@/lib/profile-avatar", async () => {
  const actual = await vi.importActual<typeof import("@/lib/profile-avatar")>(
    "@/lib/profile-avatar",
  );
  return {
    ...actual,
    readProfileAvatar,
    removeProfileAvatar,
    saveProfileAvatar,
  };
});

import { ProfileAvatarValidationError } from "@/domain/profile-avatar";
import { DELETE, GET, POST } from "./route";

function mutationRequest(
  method: "POST" | "DELETE",
  origin = "https://example.test",
  contentLength: string | null = "1024",
) {
  const headers: Record<string, string> = {
    host: "example.test",
    origin,
  };
  if (contentLength !== null) headers["content-length"] = contentLength;
  const request = new Request("https://example.test/VowBook/api/profile/avatar", {
    method,
    headers,
  });
  if (method === "POST") {
    const data = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    Object.defineProperty(request, "formData", {
      configurable: true,
      value: vi.fn(async () => ({
        get: () => ({
          name: "avatar.png",
          type: "image/png",
          arrayBuffer: async () => data.buffer,
        }),
      })),
    });
  }
  return request;
}

describe("profile avatar route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getApiCurrentUser.mockResolvedValue({ id: "user_1" });
    readProfileAvatar.mockResolvedValue({
      byteSize: 4,
      data: Uint8Array.from([1, 2, 3, 4]),
      mediaType: "image/webp",
      sha256: "a".repeat(64),
      updatedAt: new Date("2026-08-23T15:00:00.000Z"),
    });
    saveProfileAvatar.mockResolvedValue({
      updatedAt: "2026-08-23T15:00:00.000Z",
    });
    removeProfileAvatar.mockResolvedValue(true);
  });

  it("serves only the signed-in user's custom avatar with private safe headers", async () => {
    const response = await GET(
      new Request("https://example.test/VowBook/api/profile/avatar"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("etag")).toBe(`"${"a".repeat(64)}"`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      Uint8Array.from([1, 2, 3, 4]),
    );
    expect(readProfileAvatar).toHaveBeenCalledWith("user_1");
  });

  it("returns 401 without a session and 404 without a custom avatar", async () => {
    getApiCurrentUser.mockResolvedValueOnce(null);
    expect(
      (
        await GET(new Request("https://example.test/VowBook/api/profile/avatar"))
      ).status,
    ).toBe(401);

    readProfileAvatar.mockResolvedValueOnce(null);
    expect(
      (
        await GET(new Request("https://example.test/VowBook/api/profile/avatar"))
      ).status,
    ).toBe(404);
  });

  it("rejects cross-origin, unauthenticated, and oversized uploads before parsing", async () => {
    const crossOrigin = mutationRequest("POST", "https://evil.test");
    expect((await POST(crossOrigin)).status).toBe(403);
    expect(getApiCurrentUser).not.toHaveBeenCalled();

    getApiCurrentUser.mockResolvedValueOnce(null);
    expect((await POST(mutationRequest("POST"))).status).toBe(401);

    const oversized = mutationRequest(
      "POST",
      "https://example.test",
      String(MAX_PROFILE_AVATAR_UPLOAD_BYTES + 1024 * 1024 + 1),
    );
    const formData = vi.mocked(oversized.formData);
    expect((await POST(oversized)).status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
  });

  it("stores a validated upload and returns only cache-busting metadata", async () => {
    const response = await POST(mutationRequest("POST"));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      updatedAt: "2026-08-23T15:00:00.000Z",
    });
    expect(saveProfileAvatar).toHaveBeenCalledWith({
      currentUserId: "user_1",
      data: expect.any(Uint8Array),
      mediaType: "image/png",
    });
  });

  it("maps invalid image contents to a safe 400 response", async () => {
    saveProfileAvatar.mockRejectedValueOnce(
      new ProfileAvatarValidationError("頭像圖片格式與內容不符。"),
    );

    const response = await POST(mutationRequest("POST"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "頭像圖片格式與內容不符。",
    });
  });

  it("removes only the signed-in user's custom avatar with same-origin protection", async () => {
    expect(
      (await DELETE(mutationRequest("DELETE", "https://evil.test"))).status,
    ).toBe(403);
    expect(removeProfileAvatar).not.toHaveBeenCalled();

    const response = await DELETE(mutationRequest("DELETE"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: true });
    expect(removeProfileAvatar).toHaveBeenCalledWith("user_1");
  });
});
