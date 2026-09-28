import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), sent: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/workspace-data", () => ({ mobileSetRedEnvelopeSent: mocks.sent }));

import { PATCH } from "./route";
import { MobileRequestError } from "@/lib/mobile/protocol";

const context = {
  params: Promise.resolve({ workspaceId: "workspace_1", staffId: "staff_1" }),
};
const patch = (value: unknown) =>
  new Request("https://example.test", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });

describe("手機紅包發放 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
  });

  it("認證失敗時不寫入任何資料", async () => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "重新登入"));
    expect((await PATCH(patch({ redEnvelopeSent: true, expectedVersion: 0 }), context)).status).toBe(401);
    expect(mocks.sent).not.toHaveBeenCalled();
  });

  it("身分與歸屬只取自路徑與已驗證的使用者", async () => {
    mocks.sent.mockResolvedValue({ id: "staff_1", redEnvelopeSent: true, version: 1 });
    const response = await PATCH(patch({ redEnvelopeSent: true, expectedVersion: 0 }), context);
    expect(response.status).toBe(200);
    expect(mocks.sent).toHaveBeenCalledWith("workspace_1", "server-user", "staff_1", true, 0);
  });

  it("不接受 client 自帶發放時間或身分欄位", async () => {
    for (const field of ["redEnvelopeSentAt", "userId", "workspaceId", "staffId", "role"]) {
      const response = await PATCH(patch({ redEnvelopeSent: true, expectedVersion: 0, [field]: "x" }), context);
      expect(response.status).toBe(400);
    }
    expect(mocks.sent).not.toHaveBeenCalled();
  });

  it("不外洩內部錯誤細節", async () => {
    mocks.sent.mockRejectedValue(new Error("private database details"));
    const response = await PATCH(patch({ redEnvelopeSent: true, expectedVersion: 0 }), context);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database details");
  });
});
