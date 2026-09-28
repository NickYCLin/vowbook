import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/wedding-games", () => ({
  mobileUpdateGameParticipant: mocks.update,
  mobileDeleteGameParticipant: mocks.remove,
}));

import { DELETE, PATCH } from "./route";
import { MobileRequestError } from "@/lib/mobile/protocol";

const context = {
  params: Promise.resolve({ workspaceId: "workspace_1", participantId: "participant_1" }),
};
const request = (method: string, value: unknown) =>
  new Request("https://example.test", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });

describe("手機遊戲名單修改 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
  });

  it("認證失敗時不修改也不移除", async () => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "重新登入"));
    expect((await PATCH(request("PATCH", { name: "小美", expectedVersion: 0 }), context)).status).toBe(401);
    expect((await DELETE(request("DELETE", { expectedVersion: 0 }), context)).status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("修改與移除都帶路徑上的 id 和伺服器端使用者", async () => {
    mocks.update.mockResolvedValue({ id: "participant_1", version: 1 });
    mocks.remove.mockResolvedValue({ removed: true });
    await PATCH(request("PATCH", { name: "小美", note: "伴娘", expectedVersion: 0 }), context);
    expect(mocks.update).toHaveBeenCalledWith("workspace_1", "server-user", "participant_1", {
      name: "小美",
      note: "伴娘",
      expectedVersion: 0,
    });
    expect((await DELETE(request("DELETE", { expectedVersion: 3 }), context)).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith("workspace_1", "server-user", "participant_1", 3);
  });

  it("拒絕多餘欄位", async () => {
    expect((await PATCH(request("PATCH", { name: "小美", expectedVersion: 0, game: "BROCCOLI" }), context)).status).toBe(400);
    expect((await DELETE(request("DELETE", { expectedVersion: 0, workspaceId: "x" }), context)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
