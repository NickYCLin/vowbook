import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), checkIn: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/check-in", () => ({
  mobileCheckInGuest: mocks.checkIn,
  mobileCancelCheckIn: mocks.cancel,
}));

import { DELETE, POST } from "./route";
import { MobileRequestError } from "@/lib/mobile/protocol";

const context = {
  params: Promise.resolve({ workspaceId: "workspace_1", guestId: "guest_1" }),
};
const body = (value: unknown, method = "POST") =>
  new Request("https://example.test", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });

describe("手機報到寫入 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
  });

  it("認證失敗時不寫入任何資料", async () => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "重新登入"));
    expect((await POST(body({ headcount: 2 }), context)).status).toBe(401);
    expect(mocks.checkIn).not.toHaveBeenCalled();
  });

  it("workspace、賓客與身分只取自路徑與已驗證的使用者", async () => {
    mocks.checkIn.mockResolvedValue({ id: "check_1", headcount: 2, checkedInAt: "x", version: 0 });
    const response = await POST(body({ headcount: 2, notes: "同桌" }), context);
    expect(response.status).toBe(201);
    expect(mocks.checkIn).toHaveBeenCalledWith("workspace_1", "server-user", "guest_1", {
      headcount: 2,
      notes: "同桌",
    });
  });

  it("拒絕試圖覆寫擁有權或身分的欄位", async () => {
    for (const field of ["userId", "workspaceId", "guestId", "role"]) {
      const response = await POST(body({ headcount: 2, [field]: "other" }), context);
      expect(response.status).toBe(400);
    }
    expect(mocks.checkIn).not.toHaveBeenCalled();
  });

  it("取消報到必須帶合法的版本，避免蓋掉別人的更新", async () => {
    for (const invalid of [{ checkInId: "c" }, { checkInId: "c", expectedVersion: "0" }, { checkInId: "", expectedVersion: 0 }]) {
      expect((await DELETE(body(invalid, "DELETE"), context)).status).toBe(400);
    }
    expect(mocks.cancel).not.toHaveBeenCalled();

    const ok = await DELETE(body({ checkInId: "check_1", expectedVersion: 3 }, "DELETE"), context);
    expect(ok.status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith("workspace_1", "server-user", "check_1", 3);
  });

  it("不外洩內部錯誤細節", async () => {
    mocks.checkIn.mockRejectedValue(new Error("private database details"));
    const response = await POST(body({ headcount: 2 }), context);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database details");
  });
});
