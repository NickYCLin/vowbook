import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/wedding-timeline", async (original) => ({
  ...(await original<typeof import("@/lib/mobile/wedding-timeline")>()),
  mobileUpdateTimelineItem: mocks.update,
  mobileDeleteTimelineItem: mocks.remove,
}));

import { DELETE, PATCH } from "./route";
import { MobileRequestError } from "@/lib/mobile/protocol";

const context = { params: Promise.resolve({ workspaceId: "workspace_1", itemId: "item_1" }) };
const request = (method: string, value: unknown) =>
  new Request("https://example.test", {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
  });
const item = { startTime: "12:00", endTime: "12:20", phase: "進場", title: "第一次進場", expectedVersion: 2 };

describe("手機流程修改 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
  });

  it("認證失敗時不修改也不刪除", async () => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "重新登入"));
    expect((await PATCH(request("PATCH", item), context)).status).toBe(401);
    expect((await DELETE(request("DELETE", { expectedVersion: 2 }), context)).status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("工作區、項目與身分只取自路徑和工作階段", async () => {
    mocks.update.mockResolvedValue({ id: "item_1", title: "第一次進場", version: 3 });
    expect((await PATCH(request("PATCH", item), context)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith("workspace_1", "server-user", "item_1", item);
    mocks.remove.mockResolvedValue({ removed: true });
    expect((await DELETE(request("DELETE", { expectedVersion: 2 }), context)).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith("workspace_1", "server-user", "item_1", 2);
  });

  it("拒絕多餘欄位", async () => {
    for (const field of ["workspaceId", "staffIds", "id"]) {
      expect((await PATCH(request("PATCH", { ...item, [field]: "x" }), context)).status).toBe(400);
    }
    expect((await DELETE(request("DELETE", { expectedVersion: 2, title: "x" }), context)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
