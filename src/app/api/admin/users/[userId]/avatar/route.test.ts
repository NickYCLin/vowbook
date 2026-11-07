import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), admin: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/api-current-user", () => ({ getApiCurrentUser: mocks.currentUser }));
vi.mock("@/lib/profile-avatar", () => ({ readProfileAvatar: mocks.read }));
vi.mock("@/lib/system-admin", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/system-admin")>(),
  requireSystemAdmin: mocks.admin,
}));

import { SystemAdminAccessDeniedError } from "@/lib/system-admin";
import { GET } from "./route";

const request = new Request("https://example.test/api/admin/users/user_test/avatar");
const context = { params: Promise.resolve({ userId: "user_test" }) };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "admin_test" });
});

describe("管理者頭貼讀取", () => {
  it("未登入不得讀取或查詢其他使用者的圖片", async () => {
    mocks.currentUser.mockResolvedValue(null);
    expect((await GET(request, context)).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("一般使用者即使知道使用者編號也無法讀取圖片", async () => {
    mocks.admin.mockRejectedValue(new SystemAdminAccessDeniedError());
    expect((await GET(request, context)).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("管理者可讀取指定圖片，且圖片不進入共用快取", async () => {
    mocks.read.mockResolvedValue({ data: new Uint8Array([1, 2, 3]), mediaType: "image/webp", byteSize: 3 });
    const response = await GET(request, context);
    expect(response.status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith("user_test");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("沒有自訂圖片時回傳 404，讓畫面使用帳號圖片或縮寫", async () => {
    mocks.read.mockResolvedValue(null);
    expect((await GET(request, context)).status).toBe(404);
  });

  it("讀取失敗時不輸出資料庫錯誤", async () => {
    mocks.read.mockRejectedValue(new Error("private database detail"));
    const response = await GET(request, context);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
  });
});
