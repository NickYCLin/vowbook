import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), status: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/workspace-data", () => ({
  mobileSetTaskStatus: mocks.status,
  mobileUpdateTask: mocks.update,
  mobileDeleteTask: mocks.remove,
}));

import { DELETE, PATCH } from "./route";
import { MobileRequestError } from "@/lib/mobile/protocol";

const context = { params: Promise.resolve({ workspaceId: "workspace_1", taskId: "task_1" }) };
const send = (method: string, value: unknown) =>
  new Request("https://example.test", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });

describe("手機任務單筆 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
    mocks.status.mockResolvedValue({ id: "task_1", status: "DONE", version: 1 });
    mocks.update.mockResolvedValue({ id: "task_1", title: "試菜", version: 1 });
    mocks.remove.mockResolvedValue({ id: "task_1", removed: true });
  });

  it("只帶狀態時照舊勾完成", async () => {
    expect((await PATCH(send("PATCH", { status: "DONE", expectedVersion: 0 }), context)).status).toBe(200);
    expect(mocks.status).toHaveBeenCalledWith("workspace_1", "server-user", "task_1", "DONE", 0);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("勾完成時也拒絕試圖覆寫身分或歸屬的欄位", async () => {
    for (const field of ["userId", "workspaceId", "taskId", "role"]) {
      expect((await PATCH(send("PATCH", { status: "DONE", expectedVersion: 0, [field]: "x" }), context)).status).toBe(400);
    }
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it("改內容時只把白名單欄位交下去", async () => {
    const body = { title: "試菜", description: null, dueDate: "2026-10-01", side: "SHARED", expectedVersion: 0 };
    expect((await PATCH(send("PATCH", body), context)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith("workspace_1", "server-user", "task_1", body);
  });

  it("狀態和內容不能混在同一次送出，也不接受歸屬欄位", async () => {
    expect((await PATCH(send("PATCH", { status: "DONE", title: "x", expectedVersion: 0 }), context)).status).toBe(400);
    for (const field of ["userId", "workspaceId", "taskId", "role", "completedAt"]) {
      const body = { title: "試菜", side: "SHARED", expectedVersion: 0, [field]: "x" };
      expect((await PATCH(send("PATCH", body), context)).status).toBe(400);
    }
    expect((await DELETE(send("DELETE", { expectedVersion: 0, workspaceId: "x" }), context)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("刪除帶版本", async () => {
    expect((await DELETE(send("DELETE", { expectedVersion: 2 }), context)).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith("workspace_1", "server-user", "task_1", 2);
  });

  it("認證失敗不寫入，內部錯誤不外洩", async () => {
    mocks.user.mockRejectedValueOnce(new MobileRequestError(401, "UNAUTHORIZED", "重新登入"));
    expect((await DELETE(send("DELETE", { expectedVersion: 0 }), context)).status).toBe(401);
    expect(mocks.remove).not.toHaveBeenCalled();
    mocks.update.mockRejectedValue(new Error("private database details"));
    const response = await PATCH(send("PATCH", { title: "試菜", side: "SHARED", expectedVersion: 0 }), context);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
