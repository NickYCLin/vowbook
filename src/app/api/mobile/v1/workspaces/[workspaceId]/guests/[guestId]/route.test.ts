import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), attendance: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/workspace-data", () => ({
  mobileSetGuestAttendance: mocks.attendance,
  mobileUpdateGuest: mocks.update,
}));

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

describe("手機出席狀態 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
  });

  it("認證失敗時不寫入任何資料", async () => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "重新登入"));
    expect((await PATCH(patch({ attendanceStatus: "ATTENDING", expectedVersion: 0 }), context)).status).toBe(401);
    expect(mocks.attendance).not.toHaveBeenCalled();
  });

  it("身分與歸屬只取自路徑與已驗證的使用者", async () => {
    mocks.attendance.mockResolvedValue({ id: "guest_1", attendanceStatus: "ATTENDING", version: 1 });
    const response = await PATCH(patch({ attendanceStatus: "ATTENDING", expectedVersion: 0 }), context);
    expect(response.status).toBe(200);
    expect(mocks.attendance).toHaveBeenCalledWith("workspace_1", "server-user", "guest_1", "ATTENDING", 0);
  });

  it("拒絕試圖覆寫身分或歸屬的欄位", async () => {
    for (const field of ["userId", "workspaceId", "guestId", "role", "partySize"]) {
      const response = await PATCH(patch({ attendanceStatus: "ATTENDING", expectedVersion: 0, [field]: "x" }), context);
      expect(response.status).toBe(400);
    }
    expect(mocks.attendance).not.toHaveBeenCalled();
  });

  it("把版本衝突原樣回報，不吞成成功", async () => {
    mocks.attendance.mockRejectedValue(new MobileRequestError(409, "STALE", "已被更新"));
    expect((await PATCH(patch({ attendanceStatus: "DECLINED", expectedVersion: 3 }), context)).status).toBe(409);
  });

  it("不外洩內部錯誤細節", async () => {
    mocks.attendance.mockRejectedValue(new Error("private database details"));
    const response = await PATCH(patch({ attendanceStatus: "ATTENDING", expectedVersion: 0 }), context);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database details");
  });

  it("帶姓名時改整筆，只交白名單欄位", async () => {
    mocks.update.mockResolvedValue({ id: "guest_1", name: "王小明", version: 1, removedFromTable: false });
    const body = { name: "王小明", side: "PARTNER_A", attendanceStatus: "ATTENDING", partySize: 2, notes: null, expectedVersion: 0 };
    expect((await PATCH(patch(body), context)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith("workspace_1", "server-user", "guest_1", body);
    expect(mocks.attendance).not.toHaveBeenCalled();
  });

  it("改整筆時也不能改名單身份、桌次或歸屬", async () => {
    for (const field of ["category", "seniority", "seatingTableId", "workspaceId", "userId"]) {
      const body = { name: "王小明", side: "PARTNER_A", attendanceStatus: "ATTENDING", partySize: 2, expectedVersion: 0, [field]: "x" };
      expect((await PATCH(patch(body), context)).status).toBe(400);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
