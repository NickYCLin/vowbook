import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), list: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/system-admin", async (original) => ({
  ...(await original<typeof import("@/lib/system-admin")>()),
  listSystemUsersForAdmin: mocks.list,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { SystemAdminAccessDeniedError } from "@/lib/system-admin";
import { GET } from "./route";

const send = () => new Request("https://example.test");

describe("手機使用者管理列表 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "admin", email: "a@b.c", accessStatus: "ACTIVE" });
  });

  it("管理者拿得到帳號清單", async () => {
    mocks.list.mockResolvedValue([{ id: "u1" }]);
    const response = await GET(send());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ users: [{ id: "u1" }] });
    expect(mocks.list).toHaveBeenCalledWith({ id: "admin", email: "a@b.c", accessStatus: "ACTIVE" });
  });

  it("不是管理者回 403", async () => {
    mocks.list.mockRejectedValue(new SystemAdminAccessDeniedError());
    expect((await GET(send())).status).toBe(403);
  });
});
