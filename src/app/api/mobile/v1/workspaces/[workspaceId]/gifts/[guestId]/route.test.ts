import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), record: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/workspace-data", () => ({
  mobileRecordGift: mocks.record,
  mobileUpdateGift: mocks.update,
}));

import { PATCH, POST } from "./route";
import { MobileRequestError } from "@/lib/mobile/protocol";

const context = {
  params: Promise.resolve({ workspaceId: "workspace_1", guestId: "guest_1" }),
};
const send = (value: unknown, method: string) =>
  new Request("https://example.test", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });

describe("手機禮金 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
  });

  it("認證失敗時不寫入任何資料", async () => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "重新登入"));
    expect((await POST(send({ amount: 3600 }, "POST"), context)).status).toBe(401);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("登記時身分與歸屬只取自路徑與已驗證的使用者", async () => {
    mocks.record.mockResolvedValue({ id: "gift_1", amount: 3600, version: 0 });
    const response = await POST(send({ amount: 3600, notes: "同事" }, "POST"), context);
    expect(response.status).toBe(201);
    expect(mocks.record).toHaveBeenCalledWith("workspace_1", "server-user", "guest_1", {
      amount: 3600,
      notes: "同事",
    });
  });

  it("拒絕試圖覆寫身分或歸屬的欄位", async () => {
    for (const field of ["userId", "workspaceId", "guestId", "role"]) {
      expect((await POST(send({ amount: 3600, [field]: "x" }, "POST"), context)).status).toBe(400);
    }
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("新人本人由服務層擋下並回傳原因", async () => {
    mocks.record.mockRejectedValue(new MobileRequestError(400, "VALIDATION", "新人本人不收禮金，無法登記。"));
    const response = await POST(send({ amount: 3600 }, "POST"), context);
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("不收禮金");
  });

  it("更新必須帶 giftId 與版本", async () => {
    expect((await PATCH(send({ amount: 3600, expectedVersion: 0 }, "PATCH"), context)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();

    mocks.update.mockResolvedValue({ id: "gift_1", amount: 6000, version: 2 });
    const ok = await PATCH(send({ giftId: "gift_1", amount: 6000, expectedVersion: 1 }, "PATCH"), context);
    expect(ok.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      "workspace_1", "server-user", "gift_1", { amount: 6000, notes: null }, 1,
    );
  });

  it("不外洩內部錯誤細節", async () => {
    mocks.record.mockRejectedValue(new Error("private database details"));
    const response = await POST(send({ amount: 3600 }, "POST"), context);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database details");
  });
});
