import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), assign: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/workspace-data", () => ({ mobileAssignGuestToTable: mocks.assign }));

import { PATCH } from "./route";
import { MobileRequestError } from "@/lib/mobile/protocol";

const context = {
  params: Promise.resolve({ workspaceId: "workspace_1", guestId: "guest_1" }),
};
const patch = (value: unknown) =>
  new Request("https://example.test", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
const seatBody = { tableId: "table_1", expectedVersion: 2, expectedTableId: null };

describe("手機桌次安排 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
    mocks.assign.mockResolvedValue({ id: "guest_1", tableId: "table_1", version: 3, changed: true });
  });

  it("認證失敗時不寫入任何資料", async () => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "重新登入"));
    expect((await PATCH(patch(seatBody), context)).status).toBe(401);
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it("身分與歸屬只取自路徑與已驗證的使用者", async () => {
    const response = await PATCH(patch(seatBody), context);
    expect(response.status).toBe(200);
    expect(mocks.assign).toHaveBeenCalledWith("workspace_1", "server-user", "guest_1", {
      tableId: "table_1",
      expectedVersion: 2,
      expectedTableId: null,
    });
  });

  it("tableId 傳 null 代表把賓客移出桌次", async () => {
    mocks.assign.mockResolvedValue({ id: "guest_1", tableId: null, version: 3, changed: true });
    const response = await PATCH(patch({ tableId: null, expectedVersion: 2, expectedTableId: "table_1" }), context);
    expect(response.status).toBe(200);
    expect(mocks.assign).toHaveBeenCalledWith("workspace_1", "server-user", "guest_1", {
      tableId: null,
      expectedVersion: 2,
      expectedTableId: "table_1",
    });
  });

  it("不接受 client 自帶身分或人數欄位", async () => {
    for (const field of ["userId", "workspaceId", "guestId", "role", "partySize"]) {
      const response = await PATCH(patch({ ...seatBody, [field]: "x" }), context);
      expect(response.status).toBe(400);
    }
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it("座位不足時把衝突狀態原樣回給手機", async () => {
    mocks.assign.mockRejectedValue(new MobileRequestError(409, "CONFLICT", "這桌剩下的位子不夠，請換一桌。"));
    const response = await PATCH(patch(seatBody), context);
    expect(response.status).toBe(409);
  });

  it("不外洩內部錯誤細節", async () => {
    mocks.assign.mockRejectedValue(new Error("private database details"));
    const response = await PATCH(patch(seatBody), context);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database details");
  });
});
