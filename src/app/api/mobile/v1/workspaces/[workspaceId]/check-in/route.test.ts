import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), board: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/check-in", () => ({ mobileCheckInBoard: mocks.board }));

import { GET } from "./route";
import { MobileRequestError } from "@/lib/mobile/protocol";

const context = { params: Promise.resolve({ workspaceId: "workspace_1" }) };

describe("手機報到名單 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
  });

  it("認證失敗時不讀取任何報到資料", async () => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "重新登入"));
    const response = await GET(new Request("https://example.test"), context);
    expect(response.status).toBe(401);
    expect(mocks.board).not.toHaveBeenCalled();
  });

  it("使用者身分只取自已驗證的工作階段，且不快取", async () => {
    mocks.board.mockResolvedValue({ guests: [] });
    const response = await GET(
      new Request("https://example.test?userId=other"),
      { params: Promise.resolve({ workspaceId: "workspace_1" }) },
    );
    expect(mocks.board).toHaveBeenCalledWith("workspace_1", "server-user");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("沒有成員資格時回傳 403，不外洩內部錯誤", async () => {
    mocks.board.mockRejectedValue(new MobileRequestError(403, "FORBIDDEN", "沒有權限"));
    expect((await GET(new Request("https://example.test"), context)).status).toBe(403);

    mocks.board.mockRejectedValue(new Error("private database details"));
    const response = await GET(new Request("https://example.test"), context);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database details");
  });
});
